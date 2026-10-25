// ==UserScript==
// @name         Wiki-MasterBetter
// @namespace    http://tampermonkey.net
// @version      0.30.22
// @description  WMB: A collection of features and tweaks to improve the user experience on wiki-masters.com
// @author       https://github.com/QuentindiMeo
// @match        https://www.wiki-masters.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_openInTab
// ==/UserScript==
//! Regarde Naïm, c'est comme ça qu'on vibe-claude.
//* Merci @Petipoirou67 pour ses feedbacks et son support (pour son courage et sa persévérance, wébé !)

(function () {
  "use strict";

  // ============================================================
  // Feature LOG: WMB's internal logger, same pattern as BC-Plume's: logger(CPL.LEVEL, ...toPrint) prints to the
  // matching console method, prefixed with the script's version, a padded level tag and a millisecond timestamp,
  // e.g. "[WMB_0.26.8 INFO. | 14:02:11.042] message". The version is read from the user script manager (GM_info), so
  // the docblock stays the only place it is written.
  //
  // Level policy — what makes an action traceable without flooding the console (hand-written calls stay out of
  // render loops and MutationObserver callbacks, which fire constantly; the feature tracer below covers those):
  //   ERROR  something broke: a feature that throws, a failed storage write, an unreadable import file.
  //   WARN   a recoverable anomaly: corrupted stored data reset, an expected DOM element missing, a bulk-run step
  //          retried, an auto-reload triggered by a site failure, an import row or file refused.
  //   INFO   a deliberate state change or lifecycle step, by the user or by an automatic mechanism: initialization,
  //          settings saved, follow/unfollow, description saved, cache export/import/clear, sent notifications,
  //          bulk-run start/end (EBC, Rule 25), automatic and manual reloads.
  //   LOG    routine, high-frequency traces: a price, estimate or best trade recorded, a UI toggle flipped, a
  //          per-card step of a bulk run, a legacy key migrated.
  //   DEBUG  development detail: features skipped at startup because they are disabled.
  //
  // Feature LOG (cont'd): feature tracer. Most rules/features are a MutationObserver (or a timer) that re-applies an
  // idempotent tweak, so no hand-written call could tell "triggered" from "actually changed something" without
  // flooding the console. Instead, main() runs each feature through trackFeature(), and the MutationObserver /
  // setInterval / setTimeout seen by the code of this script (shadowed below) tag every callback created while a
  // feature is starting — or while one of its callbacks runs — with that feature's id. Each tagged callback is then
  // timed, and the DOM mutations it made synchronously are counted (a private observer's takeRecords() before and
  // after the call). Per feature this feeds:
  //   - one LOG line the first time it changes the DOM on a given page ("[rule-4] observer changed the DOM: ..."),
  //   - a LOG digest of every feature that ran (runs, DOM changes, time) when the page's path changes, next to an
  //     INFO "Navigation" line.
  // A callback that throws is reported as an error instead of surfacing as an uncaught exception.
  // traceOnce() is the hand-written counterpart for calculations: it logs a given message once per page.
  // ============================================================
  // Console printing levels for WMB's internal logger
  const CPL = Object.freeze({
    DEBUG: "debug",
    INFO: "info",
    LOG: "log",
    WARN: "warn",
    ERROR: "error",
  });

  const CONSOLE_PRINTING_PREFIX = {
    [CPL.DEBUG]: "DEBUG",
    [CPL.INFO]: "INFO.",
    [CPL.LOG]: "LOG..",
    [CPL.WARN]: "WARN?",
    [CPL.ERROR]: "ERR?!",
  };

  const WMB_VERSION =
    typeof GM_info !== "undefined" ? GM_info.script.version : "?";

  function createLogger(prefix) {
    return (method, ...toPrint) => {
      const now = new Date();
      const nowTime = now.toLocaleTimeString();
      const nowMilliseconds = now.getMilliseconds().toString().padStart(3, "0");
      console[method](
        `[${prefix} ${CONSOLE_PRINTING_PREFIX[method]} | ${nowTime}.${nowMilliseconds}]`,
        ...toPrint,
      );
    };
  }

  const logger = createLogger(`WMB_${WMB_VERSION}`);

  const NativeMutationObserver = window.MutationObserver;
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);

  let currentFeatureId = null;
  let tracedPath = window.location.pathname;
  const featureStats = new Map(); // id -> { runs, changes, ms }
  const tracedOnceKeys = new Set();
  const tracedFeaturePaths = new Set();
  const TRACED_ONCE_MAX = 500;

  // Observes the whole page only to be drained synchronously with takeRecords(): its callback is never needed
  const domEffectTracer = new NativeMutationObserver(() => {});
  domEffectTracer.observe(document.documentElement, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
  });

  function describeNode(node) {
    const element =
      node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return "#text";
    const firstClass = element.classList?.[0];
    return `${element.tagName.toLowerCase()}${firstClass ? `.${firstClass}` : ""}`;
  }

  function summarizeRecords(records) {
    let added = 0;
    let removed = 0;
    const attributes = new Set();
    const targets = new Set();
    records.forEach((record) => {
      added += record.addedNodes.length;
      removed += record.removedNodes.length;
      if (record.attributeName) attributes.add(record.attributeName);
      if (targets.size < 3) targets.add(describeNode(record.target));
    });
    const parts = [];
    if (added) parts.push(`+${added} node(s)`);
    if (removed) parts.push(`-${removed} node(s)`);
    if (attributes.size) parts.push(`attr ${[...attributes].join("/")}`);
    return `${parts.join(", ") || "text"} on ${[...targets].join(", ")}`;
  }

  function flushPageDigest(previousPath) {
    const ran = [...featureStats]
      .filter(([, stat]) => stat.runs > 0)
      .sort((a, b) => b[1].ms - a[1].ms);
    featureStats.clear();
    if (ran.length === 0) return;

    logger(
      CPL.LOG,
      `Digest of ${previousPath}:`,
      ran
        .slice(0, 12)
        .map(
          ([id, stat]) =>
            `${id} x${stat.runs} (${stat.changes} change(s), ${stat.ms.toFixed(1)} ms)`,
        )
        .join(" | "),
    );
  }

  // Paths where WMB must leave the page alone (they used to be @exclude-d in the header). The site is an SPA, so
  // this can't be decided once at load: styles added by the features are switched off while on such a path (and back
  // on elsewhere), the callbacks of observers and intervals are skipped (see the shadowed functions below), and the
  // initialization itself waits for the first allowed path (see the end of the script)
  const EXCLUDED_PATH_PREFIXES = ["/battle", "/settings"];
  const isExcludedPath = () =>
    EXCLUDED_PATH_PREFIXES.some((prefix) =>
      window.location.pathname.startsWith(prefix),
    );

  const featureStyles = [];

  // True while the navbar buttons start (see startWhenAllowed): what they create is exempt from the exclusion, as
  // the buttons must stay available on every path
  let exemptFromExclusion = false;

  function syncFeatureStyles() {
    const excluded = isExcludedPath();
    featureStyles.forEach((style) => {
      style.disabled = excluded;
    });
  }

  // Same as GM_addStyle, but the stylesheet follows the excluded paths
  function addStyle(css) {
    const style = GM_addStyle(css);
    if (style instanceof HTMLStyleElement && !exemptFromExclusion) {
      featureStyles.push(style);
      style.disabled = isExcludedPath();
    }
    return style;
  }

  function checkNavigation() {
    const path = window.location.pathname;
    if (path === tracedPath) return;

    const previousPath = tracedPath;
    tracedPath = path;
    tracedOnceKeys.clear();
    tracedFeaturePaths.clear();
    logger(CPL.INFO, `Navigation: ${previousPath} -> ${path}`);
    syncFeatureStyles();
    flushPageDigest(previousPath);
  }

  function recordFeatureRun(id, kind, elapsed, records) {
    checkNavigation();

    const stat = featureStats.get(id) ?? { runs: 0, changes: 0, ms: 0 };
    stat.runs++;
    stat.changes += records.length;
    stat.ms += elapsed;
    featureStats.set(id, stat);

    const pathKey = `${id}|${tracedPath}`;
    if (records.length === 0 || tracedFeaturePaths.has(pathKey)) return;
    tracedFeaturePaths.add(pathKey);
    logger(
      CPL.LOG,
      `[${id}] ${kind} changed the DOM: ${summarizeRecords(records)}`,
    );
  }

  // Runs fn as feature `id`: anything it creates with the shadowed observer/timer functions below is attributed to
  // it. The callback's own mutations are the records that appear between the two takeRecords().
  function trackFeature(id, fn, kind) {
    return function (...args) {
      const previousId = currentFeatureId;
      currentFeatureId = id;
      domEffectTracer.takeRecords();
      const start = performance.now();
      try {
        return fn.apply(this, args);
      } catch (error) {
        logger(CPL.ERROR, `[${id}] ${kind} failed`, error);
      } finally {
        const elapsed = performance.now() - start;
        const records = domEffectTracer.takeRecords();
        currentFeatureId = previousId;
        recordFeatureRun(id, kind, elapsed, records);
      }
    };
  }

  // Wraps an observer/interval callback so it does nothing on an excluded path (checkNavigation runs first, which is
  // what notices the path change and switches the styles). Timeouts are left alone: they are mostly the delays of
  // async flows, which would never resume if skipped.
  function skipOnExcludedPath(callback) {
    if (exemptFromExclusion) return callback;
    return function (...args) {
      checkNavigation();
      if (isExcludedPath()) return undefined;
      return callback.apply(this, args);
    };
  }

  // Shadow the globals for the rest of this script only
  const MutationObserver = class extends NativeMutationObserver {
    constructor(callback, ...rest) {
      super(
        skipOnExcludedPath(
          currentFeatureId
            ? trackFeature(currentFeatureId, callback, "observer")
            : callback,
        ),
        ...rest,
      );
    }
  };

  const setInterval = (callback, delay, ...rest) =>
    nativeSetInterval(
      typeof callback === "function"
        ? skipOnExcludedPath(
            currentFeatureId
              ? trackFeature(currentFeatureId, callback, "interval")
              : callback,
          )
        : callback,
      delay,
      ...rest,
    );

  const setTimeout = (callback, delay, ...rest) =>
    nativeSetTimeout(
      currentFeatureId && typeof callback === "function"
        ? trackFeature(currentFeatureId, callback, "timer")
        : callback,
      delay,
      ...rest,
    );

  // Lower-cases and strips the accents, for the text filters
  function foldAccents(value) {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  // Logs a calculation's outcome once per page (the same message is not repeated until the path changes)
  function traceOnce(message, ...extra) {
    checkNavigation();
    if (tracedOnceKeys.has(message)) return;
    if (tracedOnceKeys.size >= TRACED_ONCE_MAX) tracedOnceKeys.clear();
    tracedOnceKeys.add(message);
    logger(CPL.LOG, message, ...extra);
  }

  // ============================================================
  // Rule 1a: give div.overflow-hidden.card-frame.shadow-xl a max-height of 80vh and a width of 50vw
  // ============================================================
  function applyCardFrameMaxHeight() {
    addStyle(`
      div.overflow-hidden.card-frame.shadow-xl {
        max-height: 75vh !important;
        width: 42vw !important;
      }
    `);
  }

  // ============================================================
  // Rule 1b: On auction pages (/marketplace/{UUID}), hide every icon-only button.shrink-0 (wishlist button, market button)
  // ============================================================
  // Re-evaluated on every DOM mutation: the site is an SPA, so the page (and its buttons) may only be there once the
  // initial render is done, and the path changes without a reload.
  function hideShrinkButton() {
    if (!/^\/marketplace\/[^/]+/.test(window.location.pathname)) return;

    document.querySelectorAll("button.shrink-0").forEach((btn) => {
      // Only the icon-only round buttons: a button with a label (e.g. the seller's "Appliquer") must stay
      if (btn.textContent.trim() !== "") return;
      if (btn.style.display !== "none") btn.style.display = "none";
    });
  }

  function watchShrinkButtons() {
    hideShrinkButton();

    const observer = new MutationObserver(() => hideShrinkButton());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 2: if a notification item (.w-full.items-start) has no
  // bg-[var(--color-accent)]/5 styling:
  //   - strip that class from all of its NEXT siblings (previous siblings are untouched)
  //   - hide (display: none) every div.w-2.h-2 found inside those next siblings
  //
  // Rule 2 (cont'd) — the site now renders each notification as an <a href> link instead of a <button>, so the
  // item selector has to accept both tags (it matched nothing once the markup changed, silently disabling the rule).
  //
  // Rule 2 (cont'd) — perf: originally walked every qualifying button's own full suffix of siblings
  // (O(buttons) × O(siblings), quadratic on a long notification list — the prime suspect behind reported
  // page hangs/crashes on opening a big notification board). Since "next siblings" are cumulative in document
  // order, the union of every qualifying button's suffix is just the single suffix starting at the FIRST
  // unaccented button: once that one is found, every sibling after it needs the same treatment regardless of
  // which button originally triggered it. So each distinct parent (buttons can, in theory, live under more than
  // one container) is now walked exactly once, flipping a "past the first unaccented button" flag forward —
  // same end result, O(siblings) instead of O(buttons × siblings).
  // ============================================================
  const ACCENT_CLASS = "bg-[var(--color-accent)]/5";
  const NOTIFICATION_ITEM_SELECTOR = ":is(a, button).w-full.items-start";
  function stripAccentFromFollowingSiblings() {
    const parents = new Set();
    document.querySelectorAll(NOTIFICATION_ITEM_SELECTOR).forEach((btn) => {
      if (btn.parentElement) parents.add(btn.parentElement);
    });

    parents.forEach((parent) => {
      let pastUnaccented = false;

      Array.from(parent.children).forEach((child) => {
        if (
          !pastUnaccented &&
          child.matches(NOTIFICATION_ITEM_SELECTOR) &&
          !child.classList.contains(ACCENT_CLASS)
        ) {
          pastUnaccented = true;
          return;
        }

        if (!pastUnaccented) return;

        if (child.classList.contains(ACCENT_CLASS)) {
          child.classList.remove(ACCENT_CLASS);
        }

        child.querySelectorAll("div.w-2.h-2").forEach((dot) => {
          dot.style.display = "none";
        });
      });
    });
  }

  function watchAccentSiblings() {
    stripAccentFromFollowingSiblings();

    const observer = new MutationObserver(() =>
      stripAccentFromFollowingSiblings(),
    );
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 3: append a suffix to the page title based on the nav's active tab (the <a> with
  // class bg-[var(--color-accent)]/10 inside <nav>), and keep it in sync as that tab changes. On another user's
  // profile (/profile/{username}, as opposed to the own user's /profile), replace the suffix with "👤 {username}"
  // ============================================================
  const MARKETPLACE_BID_PATH_REGEX = /^\/marketplace\/([0-9a-f-]+)/i;
  const OTHER_PROFILE_PATH_REGEX = /^\/profile\/([^/]+)/i;
  let lastAppliedTitleSuffix = null;
  const MAX_ITEM_LABEL_LENGTH = 25;

  function updateTitleForActiveNavTab() {
    if (!document.title) return;

    let title = "WM";
    if (lastAppliedTitleSuffix && title.endsWith(lastAppliedTitleSuffix)) {
      title = title.slice(0, -lastAppliedTitleSuffix.length);
    }

    const activeTab = document.querySelector(
      "nav a.bg-\\[var\\(--color-accent\\)\\]\\/10",
    );
    let tabText = activeTab?.textContent.trim();

    if (tabText === "Marché") {
      const bidMatch = window.location.pathname.match(
        MARKETPLACE_BID_PATH_REGEX,
      );
      if (bidMatch) {
        // Read h1.flex-1's own text node directly (rather than its full textContent) since Feature CNC prepends
        // a 📋 button inside that same element — including it here would leak a stray emoji into the page title.
        const nameEl = document.querySelector("h1.flex-1");
        let itemLabel = nameEl
          ? Array.from(nameEl.childNodes)
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent)
              .join("")
              .trim()
          : undefined;
        if (itemLabel) {
          if (itemLabel.length > MAX_ITEM_LABEL_LENGTH) {
            itemLabel = itemLabel.slice(0, MAX_ITEM_LABEL_LENGTH) + "...";
          }
          tabText = `💸 ${itemLabel}`;
        }
      }
    }

    const profileMatch = window.location.pathname.match(
      OTHER_PROFILE_PATH_REGEX,
    );
    if (profileMatch) {
      tabText = `👤 ${decodeURIComponent(profileMatch[1])}`;
    }

    const suffix = tabText ? ` | ${tabText}` : "";

    title += suffix;
    lastAppliedTitleSuffix = suffix || null;

    if (document.title !== title) {
      document.title = title;
    }
  }

  function watchNavForTitleChanges() {
    updateTitleForActiveNavTab();

    const observer = new MutationObserver(() => updateTitleForActiveNavTab());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
      characterData: true,
    });
  }

  // ============================================================
  // Rule 4: on the /friends page, rearrange the friend list (everything after the search box) into a 3-column grid
  // ============================================================
  // Rule 4 (cont'd): the grid is applied in place — container itself becomes the grid, and the search box plus
  // every H2 section header get a "span full row" class — rather than re-parenting friend cards into a separate
  // wrapper div like the original implementation did. Accepting a friend request while on this page re-renders
  // the list, and React's reconciler crashes (insertBefore/removeChild "not a child of this node") if a card it
  // still thinks is a direct child of container was actually moved under our wrapper. Only adding classes never
  // changes anyone's parent, so React's own re-render stays consistent with the real DOM no matter what we did to it.
  // ============================================================
  function rearrangeFriendsGrid() {
    if (!window.location.pathname.startsWith("/friends")) return;

    const searchWrapper = document
      .querySelector("#friend-list-search")
      ?.closest(".relative");
    if (!searchWrapper) return;

    const container = searchWrapper.parentElement;
    if (!container) return;

    container.classList.add("friend-list-grid");
    searchWrapper.classList.add("friend-list-grid-full");
    Array.from(container.children).forEach((el) => {
      if (el.tagName === "H2") el.classList.add("friend-list-grid-full");
    });
  }

  function watchFriendsGrid() {
    addStyle(`
      .friend-list-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0 0.75rem;
      }
      .friend-list-grid-full {
        grid-column: 1 / -1;
      }
    `);

    rearrangeFriendsGrid();

    const observer = new MutationObserver(() => rearrangeFriendsGrid());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 5: reduce the "Message" and "Échanger" buttons to just their icon by hiding the text label span
  // ============================================================
  function hideActionButtonLabels() {
    document
      .querySelectorAll(
        'button[title="Envoyer un message"] span.hidden, button[title="Proposer un échange"] span.hidden',
      )
      .forEach((label) => {
        label.style.display = "none";
      });

    hideTradesMessageButtonLabels();
  }

  // Rule 5 (cont'd): on /trades (the "Envoyées" and "Historique" tabs show a "Message" button per trade), the same
  // shortening is applied to every button that reads "Message" or is titled/labelled as a message button. Its markup
  // there isn't known for sure, so the label is hidden whichever way it is rendered: a span carrying the text is
  // hidden; when the text is a bare text node of the button (which the site's framework owns, so it can't be
  // removed), the button's font-size is zeroed instead, the icon keeping its own size.
  function hideTradesMessageButtonLabels() {
    if (!window.location.pathname.startsWith("/trades")) return;

    document.querySelectorAll("button").forEach((btn) => {
      if (btn.dataset.wmLabelHidden === "true") return;

      const hint = `${btn.title} ${btn.getAttribute("aria-label") ?? ""}`;
      const isMessageBtn =
        /^message$/i.test(btn.textContent.trim()) || /message/i.test(hint);
      if (!isMessageBtn || !btn.querySelector("svg")) return;

      btn.dataset.wmLabelHidden = "true";

      const labelSpans = Array.from(btn.querySelectorAll("span")).filter(
        (span) => span.textContent.trim(),
      );
      if (labelSpans.length > 0) {
        labelSpans.forEach((span) => {
          span.style.display = "none";
          span.parentElement.style.margin = "0";
        });
      } else {
        btn.style.fontSize = "0";
      }
    });
  }

  function watchActionButtonLabels() {
    hideActionButtonLabels();

    const observer = new MutationObserver(() => hideActionButtonLabels());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 6: fold the left navbar by default; on hover, smoothly expand it. Folded: only each anchor's icon is visible,
  // and the site logo is squashed horizontally instead of hidden
  // ============================================================
  function foldSidebarNav() {
    const logo = document.querySelector("nav h1");
    const nav = logo?.closest("nav");
    if (!nav) return;

    nav.classList.add("wm-sidebar");
    logo.classList.add("wm-logo");

    nav.querySelectorAll(":scope > a[href]").forEach((link) => {
      Array.from(link.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          const label = document.createElement("span");
          label.className = "wm-nav-label";
          label.textContent = node.textContent.trim();
          node.replaceWith(label);
        }
      });
    });
  }

  function watchSidebarFold() {
    addStyle(`
      .wm-sidebar {
        width: 4.5rem !important;
        padding-left: 0.75rem !important;
        padding-right: 0.75rem !important;
        overflow-x: hidden;
        transition: width 0.25s ease, padding 0.25s ease;
      }
      .wm-sidebar:hover,
      .wm-sidebar.wm-sidebar-pinned {
        width: 16rem !important;
        padding-left: 1.5rem !important;
        padding-right: 1.5rem !important;
      }
      .wm-sidebar > a {
        gap: 0 !important;
        padding-left: 0.75rem !important;
        padding-right: 0.75rem !important;
        transition: gap 0.25s ease, padding 0.25s ease;
      }
      .wm-sidebar:hover > a,
      .wm-sidebar.wm-sidebar-pinned > a {
        gap: 0.75rem !important;
        padding-left: 1rem !important;
        padding-right: 1rem !important;
      }
      .wm-sidebar > a > *:not(:first-child) {
        opacity: 0;
        max-width: 0;
        overflow: hidden;
        white-space: nowrap;
        transition: opacity 0.15s ease, max-width 0.25s ease;
      }
      .wm-sidebar:hover > a > *:not(:first-child),
      .wm-sidebar.wm-sidebar-pinned > a > *:not(:first-child) {
        opacity: 1;
        max-width: 12rem;
        transition: opacity 0.2s ease 0.1s, max-width 0.25s ease;
      }
      .wm-logo {
        display: inline-block;
        transform-origin: left center;
        transform: scale(0.35);
        transition: transform 0.25s ease;
      }
      .wm-sidebar:hover .wm-logo,
      .wm-sidebar.wm-sidebar-pinned .wm-logo {
        transform: scale(1);
      }
      .wm-fold-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
        padding: 0.75rem;
        border-radius: 0.75rem;
        border: 1px solid var(--color-border);
        background: transparent;
        color: var(--color-foreground);
        opacity: 0.6;
        cursor: pointer;
        font-size: 1.1rem;
        line-height: 1;
        transition: background-color 0.2s ease, opacity 0.2s ease;
      }
      .wm-fold-toggle:hover {
        opacity: 1;
        background-color: var(--color-surface-light);
      }
      .wm-fold-toggle[aria-pressed="true"] {
        opacity: 1;
        color: var(--color-accent);
        border-color: var(--color-accent);
      }
      .wm-fold-toggle-icon {
        display: inline-block;
        transition: transform 0.25s ease;
      }
      .wm-fold-toggle[aria-pressed="true"] .wm-fold-toggle-icon {
        transform: rotate(45deg);
      }
    `);

    foldSidebarNav();

    const observer = new MutationObserver(() => foldSidebarNav());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature NPN: pin toggle to switch the navbar between "foldable on hover" (Rule 6's default) and "always expanded".
  // The choice persists across page loads via GM_setValue.
  // ============================================================
  function applyNavPinState(nav, pinned) {
    nav.classList.toggle("wm-sidebar-pinned", pinned);
  }

  // Shared by the pin toggle (feature NPN) and the settings toggle
  // (feature FCP): both sit, in that order, inside this single
  // horizontal flex row, always the sidebar's first child.
  function ensureToggleRow(nav) {
    let row = nav.querySelector(":scope > .wm-toggle-row");
    if (!row) {
      row = document.createElement("div");
      row.className = "wm-toggle-row";
      nav.insertBefore(row, nav.firstChild);
    }
    return row;
  }

  function setupNavFoldToggle() {
    const nav = document.querySelector("nav h1")?.closest("nav");
    if (!nav) return;

    const row = ensureToggleRow(nav);
    if (row.querySelector(":scope > .wm-fold-toggle:not(.wm-settings-toggle)"))
      return;

    const pinned = GM_getValue("wm-sidebar-pinned", false);
    applyNavPinState(nav, pinned);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "wm-fold-toggle";
    toggle.setAttribute("aria-pressed", String(pinned));
    toggle.title = pinned
      ? "Barre latérale toujours dépliée (cliquer pour la rendre repliable)"
      : "Barre latérale repliable (cliquer pour toujours la déplier)";

    const icon = document.createElement("span");
    icon.className = "wm-fold-toggle-icon";
    icon.textContent = "📌";
    toggle.appendChild(icon);

    toggle.addEventListener("click", () => {
      const next = !nav.classList.contains("wm-sidebar-pinned");
      applyNavPinState(nav, next);
      toggle.setAttribute("aria-pressed", String(next));
      toggle.title = next
        ? "Barre latérale toujours dépliée (cliquer pour la rendre repliable)"
        : "Barre latérale repliable (cliquer pour toujours la déplier)";
      GM_setValue("wm-sidebar-pinned", next);
      logger(CPL.LOG, `Sidebar pinned: ${next}`);
    });

    row.appendChild(toggle);
  }

  function watchNavFoldToggle() {
    setupNavFoldToggle();

    const observer = new MutationObserver(() => setupNavFoldToggle());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 6 (cont'd): while the sidebar's fold/unfold width transition is running, keep the notification card frame
  // (div.card-frame.shadow-xl.overflow-hidden) docked — position: fixed, right under button.relative.p-2 — by
  // tracking its position every animation frame for the transition's duration; otherwise it would drift out of
  // place as the sidebar (and the button it's anchored to) resizes underneath it.
  // ============================================================
  function dockCardFrameToButton() {
    const button = document.querySelector("button.relative.p-2");
    const card = document.querySelector(
      "div.card-frame.shadow-xl.overflow-hidden",
    );
    if (!button || !card) return;

    const rect = button.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    card.style.position = "fixed";
    card.style.top = `${rect.bottom}px`;
    card.style.left = `${rect.left}px`;
  }

  function bindNavTransitionTracking() {
    const nav = document.querySelector("nav");
    if (!nav || nav.dataset.cardDockBound === "true") return;
    nav.dataset.cardDockBound = "true";

    let rafId = null;
    const trackFrame = () => {
      dockCardFrameToButton();
      rafId = requestAnimationFrame(trackFrame);
    };
    const stopTracking = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      dockCardFrameToButton();
    };

    nav.addEventListener("transitionrun", (event) => {
      if (event.propertyName !== "width") return;
      if (rafId) cancelAnimationFrame(rafId);
      trackFrame();
    });
    nav.addEventListener("transitionend", (event) => {
      if (event.propertyName === "width") stopTracking();
    });
    nav.addEventListener("transitioncancel", (event) => {
      if (event.propertyName === "width") stopTracking();
    });
  }

  function watchCardFrameDocking() {
    dockCardFrameToButton();
    bindNavTransitionTracking();

    const observer = new MutationObserver(() => {
      dockCardFrameToButton();
      bindNavTransitionTracking();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 7: clicking the first notification item (.w-full.items-start) inside div.min-h-0.flex-1 also clicks the
  // button labelled "Tout marquer lu"
  //
  // Rule 7 (cont'd) — the site now renders notification items as <a href> links instead of <button>s, so "first
  // button" matched nothing and the rule never fired: the first item is now looked up with
  // NOTIFICATION_ITEM_SELECTOR (declared with Rule 2). The listener also runs in the capture phase, so "Tout marquer
  // lu" is clicked the instant the newest notification is clicked, before the link's own navigation can start.
  //
  // Rule 7 (cont'd) — Rule 31 compatibility: "first" here means the first button not hidden by Rule 31's type
  // filter (display: none), not simply the first in DOM order — otherwise, while a filter is active, clicking the
  // visually-first (but DOM-later) notification wouldn't match the DOM-first (but hidden) one and this would
  // silently do nothing.
  //
  // Rule 7 (hotfix) — perf: findMarkAllReadButton used to scan every <button> in the entire document. Its style
  // variant below runs from a MutationObserver on document.body with no page/container guard at all, so that full
  // scan re-ran on every single DOM mutation anywhere on the site — one of the prime suspects behind reported
  // page hangs/crashes when the notifications board (which can hold hundreds of <button> notification items)
  // opens. The "Tout marquer lu" button only ever lives inside the notifications panel itself
  // (div.card-frame.shadow-xl.overflow-hidden — see Rule 17, which targets that same container's first child), so
  // the search is now scoped to it: bounded by the panel's own size instead of the whole page, and skipped
  // entirely (no scan at all) whenever the panel isn't even open.
  // ============================================================
  function findMarkAllReadButton() {
    const container = document.querySelector(
      "div.card-frame.shadow-xl.overflow-hidden",
    );
    if (!container) return undefined;

    return Array.from(container.querySelectorAll("button")).find(
      (btn) =>
        btn.textContent.trim() === "Tout marquer lu" ||
        btn.getAttribute("aria-label") === "Tout marquer lu",
    );
  }

  function watchMarkAllReadTrigger() {
    document.addEventListener(
      "click",
      (event) => {
        const container = document.querySelector("div.min-h-0.flex-1");
        if (!container) return;

        const firstButton = Array.from(
          container.querySelectorAll(NOTIFICATION_ITEM_SELECTOR),
        ).find((btn) => btn.style.display !== "none");
        if (!firstButton) return;
        if (event.target !== firstButton && !firstButton.contains(event.target))
          return;

        const markAllReadBtn = findMarkAllReadButton();
        if (markAllReadBtn && markAllReadBtn !== firstButton) {
          markAllReadBtn.click();
        }
      },
      true,
    );
  }

  // ============================================================
  // Rule 7 (cont'd): give the "Tout marquer lu" button a "text-box: alphabetic" style (trims its box to the
  // font's alphabetic edge)
  // ============================================================
  function styleMarkAllReadButton() {
    findMarkAllReadButton()?.classList.add("wm-mark-all-read-btn");
  }

  function watchMarkAllReadButtonStyle() {
    addStyle(`
      .wm-mark-all-read-btn {
        text-box: alphabetic;
      }
    `);

    styleMarkAllReadButton();

    const observer = new MutationObserver(() => styleMarkAllReadButton());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature TBC: on /collection, insert a button as the second child of each div.justify-between.pt-1 (inside
  // a div.relative.isolate). This button clicks the img.scale-\\[1\\.8\\] overlay inside the parent
  // div.relative.isolate, then (requestAnimationFrame later) clicks button.flex-1.font-semibold
  // ============================================================
  // Feature TBC (cont'd): the quick action reports how it went in the button's data-wm-quick-action-result:
  // "pending" while it runs, then "clicked" (the sell button was found and clicked), "no-image" (the card's art
  // overlay isn't there, so its modal can't be opened) or "no-sell-button" (the modal opened but offers no
  // "Mettre aux enchères" button: a favorite card, one already on auction or in a trade...). The sell button is
  // looked for in the card modal (div.card-frame.p-6) rather than in the whole document, so an unrelated
  // button.flex-1.font-semibold can't be clicked instead, and for up to QUICK_ACTION_SELL_BUTTON_WAIT_MS, as the
  // modal may not be rendered on the very next frame. Feature EBC reads that result to skip such cards.
  const QUICK_ACTION_SELL_BUTTON_WAIT_MS = 600;

  function findQuickActionSellButton() {
    const modal = document.querySelector("div.card-frame.p-6");
    return (modal ?? document).querySelector("button.flex-1.font-semibold");
  }

  function runQuickAction(isolateDiv, btn) {
    const image = isolateDiv.querySelector("img.scale-\\[1\\.8\\]");
    if (!image) {
      btn.dataset.wmQuickActionResult = "no-image";
      logger(CPL.WARN, "Quick action: the card's image overlay is missing");
      return;
    }

    btn.dataset.wmQuickActionResult = "pending";
    image.click();

    const start = performance.now();
    const lookForSellButton = () => {
      const sellButton = findQuickActionSellButton();
      if (sellButton) {
        sellButton.click();
        btn.dataset.wmQuickActionResult = "clicked";
        return;
      }
      if (performance.now() - start >= QUICK_ACTION_SELL_BUTTON_WAIT_MS) {
        btn.dataset.wmQuickActionResult = "no-sell-button";
        logger(CPL.WARN, "Quick action: no sell button in the card modal");
        return;
      }
      requestAnimationFrame(lookForSellButton);
    };
    requestAnimationFrame(lookForSellButton);
  }

  function insertCollectionQuickActionButtons() {
    if (!window.location.pathname.startsWith("/collection")) return;

    document.querySelectorAll("div.relative.isolate").forEach((isolateDiv) => {
      if (isolateDiv.querySelector(":scope .wm-quick-action")) return;

      const justifyBetween = isolateDiv.querySelector(
        "div.justify-between.pt-1",
      );
      if (!justifyBetween) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wm-quick-action";
      btn.setAttribute("aria-label", "Action rapide");
      btn.textContent = "📈";

      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        runQuickAction(isolateDiv, btn);
      });

      justifyBetween.insertBefore(btn, justifyBetween.children[1] ?? null);
    });
  }

  function watchCollectionQuickActionButtons() {
    addStyle(`
      .wm-quick-action {
        display: block;
        font-size: 0.75rem;
        border: none;
        margin: 0;
        padding: 0 0.5rem;
        border-radius: 0.5rem;
        background: #ffffff67;
        color: var(--color-foreground);
        opacity: 0.6;
        cursor: pointer;
        transition: background-color 0.2s ease, opacity 0.2s ease;
      }
      .wm-quick-action:hover {
        opacity: 1;
        background-color: var(--color-surface-light);
      }
    `);

    insertCollectionQuickActionButtons();

    const observer = new MutationObserver(() =>
      insertCollectionQuickActionButtons(),
    );
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature SAT: on /collection, once the button labelled "Tout sélectionner (page)" is in the DOM, add a button
  // right after it that clicks img.scale-[1.8] of every div.hover:scale-105 that doesn't contain
  // a div.flex-wrap.shrink-0 (i.e. untagged cards)
  // ============================================================
  function insertSelectUntaggedButton() {
    if (!window.location.pathname.startsWith("/collection")) return;

    const selectAllBtn = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent.trim() === "Tout sélectionner (page)",
    );
    if (!selectAllBtn) return;
    if (
      selectAllBtn.nextElementSibling?.classList.contains("wm-select-untagged")
    )
      return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${selectAllBtn.className} wm-select-untagged`;
    btn.textContent = "... sauf étiquetées";

    btn.addEventListener("click", () => {
      document.querySelectorAll("div.hover\\:scale-105").forEach((card) => {
        if (card.querySelector("div.flex-wrap.shrink-0")) return;
        card.querySelector("img.scale-\\[1\\.8\\]")?.click();
      });
    });

    selectAllBtn.insertAdjacentElement("afterend", btn);
  }

  function watchSelectUntaggedButton() {
    insertSelectUntaggedButton();

    const observer = new MutationObserver(() => insertSelectUntaggedButton());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // ============================================================
  // Feature LBD: while the card sell modal is open, pressing Enter with focus inside any <input> of that modal clicks
  // its button labelled "Lancer l'enchère" (button inside div.mt-6). The sell modal is the div.card-frame holding
  // that button, so this works on any page and for any of its fields, not only the starting bid (input
  // [aria-label="Mise de départ"]) — an input of another modal has no such button in its card frame and is left alone.
  // ============================================================
  function findSellModalLaunchButton(input) {
    const scope = input.closest("div.card-frame") ?? document;
    return Array.from(scope.querySelectorAll("div.mt-6 button")).find(
      (btn) => btn.textContent.trim() === "Lancer l'enchère",
    );
  }

  function watchStartingBidEnterKey() {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;

      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;

      const launchBtn = findSellModalLaunchButton(input);
      if (!launchBtn) return;

      event.preventDefault();
      logger(
        CPL.INFO,
        "Enter pressed in the sell modal: launching the auction",
      );
      launchBtn.click();
    });
  }

  // ============================================================
  // Feature DAD: when the card sell modal opens (it is recognized by its input[aria-label="Mise de départ"], on any
  // page), click the duration button (button.py-1\.5 inside div.gap-2, searched in the modal's div.card-frame) whose
  // text is the "Durée par défaut d'enchère" chosen in the settings' Config tab (Feature CFG; default "1 h"). Texts
  // are compared ignoring spaces and case, so "1 h" matches "1h". It acts once per input element: while no duration
  // button is rendered yet nothing is flagged and the next mutation retries; once they are there, the input is
  // flagged whether or not one matched (none matching is logged as a warning).
  // ============================================================
  function normalizeDurationText(text) {
    return text.replace(/[\s\u00a0\u202f]/g, "").toLowerCase();
  }

  function applyDefaultAuctionDuration() {
    const input = document.querySelector('input[aria-label="Mise de départ"]');
    if (!input || input.dataset.wmDurationApplied === "true") return;

    const scope = input.closest("div.card-frame") ?? document;
    const buttons = Array.from(
      scope.querySelectorAll("div.gap-2 button.py-1\\.5"),
    );
    if (buttons.length === 0) return;

    input.dataset.wmDurationApplied = "true";

    const wanted = readConfig()[AUCTION_DURATION_CONFIG_ID];
    const target = buttons.find(
      (btn) =>
        normalizeDurationText(btn.textContent) ===
        normalizeDurationText(wanted),
    );
    if (!target) {
      logger(
        CPL.WARN,
        `Default auction duration "${wanted}" not offered`,
        buttons.map((btn) => btn.textContent.trim()),
      );
      return;
    }

    target.click();
    logger(CPL.INFO, `Default auction duration applied: ${wanted}`);
  }

  function watchDefaultAuctionDuration() {
    applyDefaultAuctionDuration();

    const observer = new MutationObserver(() => applyDefaultAuctionDuration());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 9: on /marketplace, click the configured tab ("Mes enchères" by default; Config tab, "Onglet du marché ouvert
  // par défaut": "Parcourir", "Mes enchères", "Historique", "Gagnées" or "Aucun" for none) as soon as it appears in the DOM
  // Rule 9 (cont'd): the "Parcourir" tab's sort selector (currently "Récemment listées") is switched to "Fin imminente"
  // once the user has started typing in the search input (once per appearance of the selector, so a later manual
  // choice sticks). The switch makes the page re-render, which can disrupt what is being typed or pasted into the
  // field if it happens in the middle of it, so it is not done on the keystroke itself: it waits for BROWSE_SORT_DELAY_MS
  // of silence in the field (every new input event restarts the wait). Only the search field (input[type="search"])
  // triggers it.
  // ============================================================
  // The selector only exists while the Parcourir tab is displayed, so every time the user reaches the tab a fresh
  // element appears and is switched once (dataset.wmSortApplied); a later manual choice is left alone. Handles both a
  // native <select> (value set through the native setter, then a bubbling "change", which React listens to) and a
  // custom dropdown (button[role="combobox"], click it, then click the matching option).
  const BROWSE_SORT_TARGET_LABEL = "Fin imminente";
  const BROWSE_SORT_CURRENT_LABEL = "Récemment listées";
  const BROWSE_SORT_DELAY_MS = 400;

  function findBrowseSortSelect() {
    return Array.from(document.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some(
        (option) => option.textContent.trim() === BROWSE_SORT_TARGET_LABEL,
      ),
    );
  }

  function findBrowseSortCombobox() {
    return Array.from(
      document.querySelectorAll(
        'button[role="combobox"], button[aria-haspopup]',
      ),
    ).find((btn) => btn.textContent.trim() === BROWSE_SORT_CURRENT_LABEL);
  }

  function applyBrowseSortEndingSoon() {
    if (!window.location.pathname.startsWith("/marketplace")) return;

    const select = findBrowseSortSelect();
    if (select) {
      if (select.dataset.wmSortApplied === "true") return;
      select.dataset.wmSortApplied = "true";
      const option = Array.from(select.options).find(
        (o) => o.textContent.trim() === BROWSE_SORT_TARGET_LABEL,
      );
      if (select.value === option.value) return;
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      ).set.call(select, option.value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      logger(CPL.INFO, `Browse sort switched to "${BROWSE_SORT_TARGET_LABEL}"`);
      return;
    }

    const combobox = findBrowseSortCombobox();
    if (!combobox || combobox.dataset.wmSortApplied === "true") return;
    combobox.dataset.wmSortApplied = "true";
    combobox.click();
    // The options render after the click
    setTimeout(() => {
      const option = Array.from(
        document.querySelectorAll(
          '[role="option"], [role="menuitem"], li, button',
        ),
      ).find(
        (el) =>
          el.children.length === 0 &&
          el.textContent.trim() === BROWSE_SORT_TARGET_LABEL,
      );
      if (!option) {
        logger(
          CPL.WARN,
          `Browse sort: option "${BROWSE_SORT_TARGET_LABEL}" not found`,
        );
        document.body.click();
        return;
      }
      option.click();
      logger(CPL.INFO, `Browse sort switched to "${BROWSE_SORT_TARGET_LABEL}"`);
    }, 100);
  }

  // The tabs the setting can pick (the labels the site is known to use), the configured one being the only one ever
  // clicked. Every tab button seen is marked (dataset.wmAutoClicked: "true" when clicked, "seen" otherwise), so that
  // changing the setting later never clicks anything on an already open page: it applies on the next arrival.
  function clickAuctionsTabOnArrival() {
    if (!window.location.pathname.startsWith("/marketplace")) return;

    const fresh = DEFAULT_MARKETPLACE_TAB_LABELS.map((label) =>
      findMarketplaceTabButton(label),
    ).filter((btn) => btn && !btn.dataset.wmAutoClicked);
    if (fresh.length === 0) return;
    fresh.forEach((btn) => (btn.dataset.wmAutoClicked = "seen"));

    const label = getConfigValue(DEFAULT_MARKETPLACE_TAB_CONFIG_ID);
    if (!label) return;
    const btn = findMarketplaceTabButton(label);
    if (!btn || !fresh.includes(btn)) return;

    btn.dataset.wmAutoClicked = "true";
    logger(CPL.INFO, `Marketplace tab "${label}" opened by default`);
    btn.click();
  }

  function watchAuctionsTabArrival() {
    clickAuctionsTabOnArrival();

    // Debounced: switching the sort re-renders the page, which must not land in the middle of a paste or a keystroke
    let sortTimerId = null;
    document.addEventListener("input", (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      if (event.target.type !== "search") return;

      clearTimeout(sortTimerId);
      sortTimerId = setTimeout(applyBrowseSortEndingSoon, BROWSE_SORT_DELAY_MS);
    });

    const observer = new MutationObserver(() => clickAuctionsTabOnArrival());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 10: clicking a notification item (.w-full.items-start) updates the notification badge
  // (div.shrink-0 span.-top-0.5) with the number of notification items that are PREVIOUS siblings of it
  //
  // Rule 10 (cont'd): notification items are now <a href> links instead of <button>s, so both the click target and the
  // sibling count use NOTIFICATION_ITEM_SELECTOR (declared with Rule 2) to accept either tag.
  // ============================================================
  function countPreviousSiblingsMatching(el, selector) {
    let count = 0;
    let sibling = el.previousElementSibling;
    while (sibling) {
      if (sibling.matches(selector)) count++;
      sibling = sibling.previousElementSibling;
    }
    return count;
  }

  function watchItemButtonIndexDisplay() {
    document.addEventListener("click", (event) => {
      const btn = event.target.closest(NOTIFICATION_ITEM_SELECTOR);
      if (!btn) return;

      const span = document.querySelector("div.shrink-0 span.-top-0\\.5");
      if (!span) return;

      span.textContent = String(
        countPreviousSiblingsMatching(btn, NOTIFICATION_ITEM_SELECTOR),
      );
    });
  }

  // ============================================================
  // Rule 11: on /pulls, give div.px-5 and button.px-6 a 0.2 opacity
  // ============================================================
  function updatePullsOpacity() {
    const onPulls = window.location.pathname.startsWith("/pulls");
    document.querySelectorAll("div.px-5, button.px-6").forEach((el) => {
      el.style.opacity = onPulls ? "0.2" : "";
    });
  }

  function watchPullsOpacity() {
    updatePullsOpacity();

    const observer = new MutationObserver(() => updatePullsOpacity());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 12: on /profile/*, give buttons inside div.-mt-0\.5 a color of #ccc, but only while they're not hovered; while
  // hovered, they get a muted green (background and text) instead of the site's red hover.
  //
  // Rule 12 (cont'd): on /profile (the user's own profile page), give div.mt-2 a max-width of 50rem, and keep its
  // tags' text from being clipped at the bottom (span.truncate inherits the pill's leading-none line-height).
  // ============================================================
  function updateProfileButtonColor() {
    const onProfile = window.location.pathname.startsWith("/profile/");
    document.querySelectorAll("div.-mt-0\\.5 button").forEach((btn) => {
      btn.classList.toggle("wm-profile-btn", onProfile);
    });
  }

  function updateOwnProfileTagListWidth() {
    const onOwnProfile = window.location.pathname === "/profile";
    document.querySelectorAll("div.mt-2").forEach((div) => {
      div.classList.toggle("wm-own-profile-tag-list", onOwnProfile);
    });
  }

  function watchProfileButtonColor() {
    addStyle(`
      .wm-profile-btn:not(:hover) {
        color: #ccc;
      }

      /* The site's own red hover (made for "Signaler") is too aggressive: every button of the row goes a muted
         green instead. A followed player's "Suivi" button keeps its red (Feature FOL). */
      .wm-profile-btn:not([aria-pressed="true"]):hover {
        background-color: rgba(52, 211, 153, 0.1) !important;
        color: rgba(52, 211, 153, 0.85) !important;
      }

      .wm-own-profile-tag-list {
        max-width: 50rem;
      }

      /* Each tag's text span is overflow-hidden (truncate) with the pill's leading-none line-height, which clips
         descenders (Q, G, g, y...). Padding gives the glyphs room; the negative margin keeps the pill's size. */
      .wm-own-profile-tag-list span.truncate {
        padding-block: 0.2em;
        margin-block: -0.2em;
      }
    `);

    updateProfileButtonColor();
    updateOwnProfileTagListWidth();

    const observer = new MutationObserver(() => {
      updateProfileButtonColor();
      updateOwnProfileTagListWidth();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Shared by Feature PNP and Rule 29: the max pile size (10) that div.text-lg > span.text-[var(--color-accent)]'s
  // count caps out at, and a helper to read that count.
  // ============================================================
  const MAX_PILE_SIZE = 10;

  function getCurrentPacksToOpen() {
    const span = document.querySelector(
      "div.text-lg > span.text-\\[var\\(--color-accent\\)\\]",
    );
    if (!span) return null;

    const value = parseInt(span.textContent.trim(), 10);
    return Number.isNaN(value) ? null : value;
  }

  // ============================================================
  // Feature PNP: on /pulls, once div.text-lg > span.text-[var(--color-accent)]'s count reaches the threshold
  // chosen in Feature CFG (50, 70, 90 by default, or 100 % of the max pile size, 10; the stored proportion is lowered by 1
  // point to absorb floating point uncertainty), send a push notification on every further increase; once it hits the
  // max, re-send every 10 minutes for as long as it stays full instead of only once. Dropping below the threshold
  // resets tracking (so changing the setting never replays old notifications).
  //
  // Feature PNP (cont'd): a 🔔/🔕 toggle appended into div.gap-1.flex-col mutes this notification — off
  // (muted) by default. Unlike Feature PNB's own toggle, the choice is stored in localStorage rather than
  // sessionStorage: it applies across every tab and persists after they're closed, same reach as GM_setValue's
  // other cross-tab settings elsewhere in the script. Re-appended on every checkPullsCounter tick rather than
  // guarded by a one-time flag, since that container can be re-rendered independently of our button; the
  // :scope > check keeps this a no-op once it's already there. A muted check still updates
  // lastNotifiedValue/lastNotifiedAt, so unmuting later doesn't immediately fire for a pile size that was
  // already tracked.
  // ============================================================
  const PNP_MUTE_KEY = "wm-pnp-muted";

  function isPullsNotificationMuted() {
    return localStorage.getItem(PNP_MUTE_KEY) !== "false";
  }

  function ensurePullsMuteToggle(container) {
    if (container.querySelector(":scope > .wm-pnp-mute-toggle")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wm-pnp-mute-toggle";

    const applyState = (muted) => {
      btn.textContent = muted ? "🔕" : "🔔";
      btn.setAttribute("aria-pressed", String(muted));
      btn.title = muted
        ? "Notifications de paquets accumulés désactivées (cliquer pour les réactiver)"
        : "Notifications de paquets accumulés activées (cliquer pour les désactiver)";
    };
    applyState(isPullsNotificationMuted());

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const next = !isPullsNotificationMuted();
      localStorage.setItem(PNP_MUTE_KEY, String(next));
      logger(CPL.LOG, `Pulls notification muted: ${next}`);
      applyState(next);
    });

    container.appendChild(btn);
  }

  function watchPullsCounterNotification() {
    addStyle(`
      .wm-pnp-mute-toggle {
        align-self: flex-start;
        margin-inline: auto;
        background: none;
        border: none;
        cursor: pointer;
        font-size: 0.9rem;
        line-height: 1;
        opacity: 0.5;
        transition: opacity 0.15s ease;
      }
      .wm-pnp-mute-toggle:hover {
        opacity: 1;
      }
    `);

    const TIME_TO_RELOAD__MIN = 10;
    const RESEND_INTERVAL_MS = 10 * 60 * 1000;
    let lastNotifiedValue = null;
    let lastNotifiedAt = 0;

    // The "Seuil d'alerte de la pile de paquets" setting of Feature CFG (90 % by default), read at each check so a
    // change applies right away; logged only when it differs from the previous check
    let lastLoggedPileThreshold = null;
    function getPileNotificationThreshold() {
      const proportion = getConfigValue(PILE_NOTIFICATION_THRESHOLD_CONFIG_ID);
      if (proportion !== lastLoggedPileThreshold) {
        lastLoggedPileThreshold = proportion;
        logger(
          CPL.INFO,
          `[PNP] Notification threshold: ${proportion} of ${MAX_PILE_SIZE} packs (from ${Math.ceil(MAX_PILE_SIZE * proportion)})`,
        );
      }
      return proportion;
    }

    function sendPullsNotification(newPackageCount) {
      lastNotifiedValue = newPackageCount;
      lastNotifiedAt = Date.now();

      if (isPullsNotificationMuted()) return;

      const TIME_UNTIL_FULL__MIN =
        (MAX_PILE_SIZE - newPackageCount) * TIME_TO_RELOAD__MIN;
      const fullPileText = `\nVotre pile sera pleine dans ${TIME_UNTIL_FULL__MIN} minutes.`;
      const notificationText =
        `Vous avez ${newPackageCount} paquets à ouvrir !` +
        (newPackageCount !== MAX_PILE_SIZE ? fullPileText : "");
      logger(CPL.INFO, "Notification: pulls", newPackageCount);
      GM_notification({
        title: "Wiki-Masters",
        text: notificationText,
        timeout: 595000, //? 9 minutes 55 seconds
      });
    }

    function checkPullsCounter() {
      if (!window.location.pathname.startsWith("/pulls")) return;

      const toggleContainer = document.querySelector("div.px-6.gap-1");
      if (toggleContainer) ensurePullsMuteToggle(toggleContainer);

      const currentPacksToOpen = getCurrentPacksToOpen();
      if (
        currentPacksToOpen === null ||
        currentPacksToOpen < MAX_PILE_SIZE * getPileNotificationThreshold()
      ) {
        lastNotifiedValue = null;
        lastNotifiedAt = 0;
        return;
      }

      if (currentPacksToOpen === MAX_PILE_SIZE) {
        // Notify immediately on the n-1 -> n transition, not just on resend.
        if (
          lastNotifiedValue !== MAX_PILE_SIZE ||
          Date.now() - lastNotifiedAt >= RESEND_INTERVAL_MS
        ) {
          sendPullsNotification(currentPacksToOpen);
        }
        return;
      }

      if (lastNotifiedValue !== currentPacksToOpen) {
        sendPullsNotification(currentPacksToOpen);
      }
    }

    checkPullsCounter();

    const observer = new MutationObserver(() => checkPullsCounter());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    setInterval(checkPullsCounter, 60000); //? 1 minute
  }

  // ============================================================
  // Rule 29: on /pulls, once div.text-lg > span.text-[var(--color-accent)]'s count has reached the max pile size
  // (10, see Feature PNP), reload the page every 10 minutes for as long as it stays at that count. Dropping below
  // the max (e.g. the player opens packs) cancels the timer instead of letting it reload mid-session.
  //
  // Rule 29 (cont'd): on a bid page (/marketplace/{UUID}), Rule 22 already detects the "Enchère introuvable"
  // scenario (centerSpinnerAndAuctionNotFoundInMain, which locates that div via findInnermostDivContainingText)
  // and hints the player to wait or refresh. This automates that hint: once that div is showing, reload once
  // after 5 seconds — a one-shot timeout rather than a repeating interval, since a reload either fixes the page
  // (nothing left to reload for) or shows the same message again, which simply re-arms the timeout from scratch.
  // The div disappearing (auction loads, or navigating away) before the 5 seconds are up cancels it.
  //
  // Rule 29 (cont'd): on /collection, the same one-shot reload fires once a p.text-red-400/90 whose text contains
  // "a échoué" (the site's own failure message) is showing, after COLLECTION_FAILURE_RELOAD_DELAY_MS. It disappearing
  // before then cancels it; if it's still there after the reload, the timeout simply re-arms.
  //
  // Rule 29 (cont'd): on any page, the same one-shot reload fires once an h1 reading "This page couldn't load" (the
  // framework's error page, whichever apostrophe it uses) shows up, after PAGE_LOAD_FAILURE_RELOAD_DELAY_MS. Unlike
  // the others, this one could loop forever on a page that stays broken, so reloads are counted in sessionStorage:
  // after PAGE_LOAD_FAILURE_MAX_RELOADS of them within PAGE_LOAD_FAILURE_WINDOW_MS it stops (and says so) until
  // the window has passed.
  // ============================================================
  const PULLS_RELOAD_INTERVAL_MS = 600000; // 10 minutes
  const AUCTION_NOT_FOUND_RELOAD_DELAY_MS = 750;
  let pullsReloadTimerId = null;
  const COLLECTION_FAILURE_RELOAD_DELAY_MS = 2000; // 2 seconds
  const COLLECTION_FAILURE_PHRASE = "a échoué";
  let auctionNotFoundReloadTimerId = null;
  let collectionFailureReloadTimerId = null;
  const PAGE_LOAD_FAILURE_PHRASE = "this page couldn't load";
  const PAGE_LOAD_FAILURE_RELOAD_DELAY_MS = 2000;
  const PAGE_LOAD_FAILURE_MAX_RELOADS = 3;
  const PAGE_LOAD_FAILURE_WINDOW_MS = 60000;
  const PAGE_LOAD_FAILURE_RELOADS_KEY = "wm-page-load-failure-reloads";
  let pageLoadFailureReloadTimerId = null;

  function isPullsPileFull() {
    return (
      window.location.pathname.startsWith("/pulls") &&
      getCurrentPacksToOpen() === MAX_PILE_SIZE
    );
  }

  function isAuctionNotFoundShowing() {
    return (
      MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname) &&
      findInnermostDivContainingText(AUCTION_NOT_FOUND_PHRASE) !== undefined
    );
  }

  function isCollectionFailureShowing() {
    return (
      window.location.pathname.startsWith("/collection") &&
      Array.from(document.querySelectorAll("p.text-red-400\\/90")).some((p) =>
        p.textContent.includes(COLLECTION_FAILURE_PHRASE),
      )
    );
  }

  function isPageLoadFailureShowing() {
    return Array.from(document.querySelectorAll("h1")).some((h1) =>
      h1.textContent
        .replace(/[\u2018\u2019]/g, "'")
        .toLowerCase()
        .includes(PAGE_LOAD_FAILURE_PHRASE),
    );
  }

  // Reload timestamps of the last window, kept for the browser session; returns them with the new one when allowed
  function registerPageLoadFailureReload() {
    let recent = [];
    try {
      recent = JSON.parse(
        sessionStorage.getItem(PAGE_LOAD_FAILURE_RELOADS_KEY) ?? "[]",
      ).filter((at) => Date.now() - at < PAGE_LOAD_FAILURE_WINDOW_MS);
    } catch {
      recent = [];
    }
    if (recent.length >= PAGE_LOAD_FAILURE_MAX_RELOADS) return false;

    try {
      sessionStorage.setItem(
        PAGE_LOAD_FAILURE_RELOADS_KEY,
        JSON.stringify([...recent, Date.now()]),
      );
    } catch {
      // Storage blocked: reload anyway, the page just can't be capped
    }
    return true;
  }

  function updatePullsReloadTimer() {
    if (!isPullsPileFull()) {
      if (pullsReloadTimerId !== null) {
        clearInterval(pullsReloadTimerId);
        pullsReloadTimerId = null;
      }
      return;
    }

    if (pullsReloadTimerId !== null) return;

    pullsReloadTimerId = setInterval(() => {
      if (isPullsPileFull()) {
        logger(CPL.INFO, "Auto-reload: pack pile still full");
        window.location.reload();
      }
    }, PULLS_RELOAD_INTERVAL_MS);
  }

  function updateAuctionNotFoundReloadTimer() {
    if (!window.location.pathname.startsWith("/marketplace")) {
      return;
    }

    if (!isAuctionNotFoundShowing()) {
      if (auctionNotFoundReloadTimerId !== null) {
        clearTimeout(auctionNotFoundReloadTimerId);
        auctionNotFoundReloadTimerId = null;
      }
      return;
    }

    if (auctionNotFoundReloadTimerId !== null) return;

    auctionNotFoundReloadTimerId = setTimeout(() => {
      auctionNotFoundReloadTimerId = null;
      if (isAuctionNotFoundShowing()) {
        logger(CPL.WARN, "Auto-reload: auction not found");
        window.location.reload();
      }
    }, AUCTION_NOT_FOUND_RELOAD_DELAY_MS);
  }

  function updateCollectionFailureReloadTimer() {
    if (!isCollectionFailureShowing()) {
      if (collectionFailureReloadTimerId !== null) {
        clearTimeout(collectionFailureReloadTimerId);
        collectionFailureReloadTimerId = null;
      }
      return;
    }

    if (collectionFailureReloadTimerId !== null) return;

    collectionFailureReloadTimerId = setTimeout(() => {
      collectionFailureReloadTimerId = null;
      if (isCollectionFailureShowing()) {
        logger(CPL.WARN, "Auto-reload: collection failed to load");
        window.location.reload();
      }
    }, COLLECTION_FAILURE_RELOAD_DELAY_MS);
  }

  function updatePageLoadFailureReloadTimer() {
    if (!isPageLoadFailureShowing()) {
      if (pageLoadFailureReloadTimerId !== null) {
        clearTimeout(pageLoadFailureReloadTimerId);
        pageLoadFailureReloadTimerId = null;
      }
      return;
    }

    if (pageLoadFailureReloadTimerId !== null) return;

    pageLoadFailureReloadTimerId = setTimeout(() => {
      pageLoadFailureReloadTimerId = null;
      if (!isPageLoadFailureShowing()) return;

      if (!registerPageLoadFailureReload()) {
        logger(
          CPL.ERROR,
          `Page still fails to load after ${PAGE_LOAD_FAILURE_MAX_RELOADS} reloads, giving up for now`,
        );
        return;
      }
      logger(CPL.WARN, "Auto-reload: page couldn't load");
      window.location.reload();
    }, PAGE_LOAD_FAILURE_RELOAD_DELAY_MS);
  }

  function watchPullsReloadTimer() {
    updatePullsReloadTimer();
    updateAuctionNotFoundReloadTimer();
    updateCollectionFailureReloadTimer();
    updatePageLoadFailureReloadTimer();

    const observer = new MutationObserver(() => {
      updatePullsReloadTimer();
      updateAuctionNotFoundReloadTimer();
      updateCollectionFailureReloadTimer();
      updatePageLoadFailureReloadTimer();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ============================================================
  // Rule 13: when div.card-frame.shadow-xl.overflow-hidden enters the DOM and there's no span.absolute anywhere in the
  // document, keep only the first N children of div.min-h-0.flex-1; scrolling that container to the bottom restores
  // the remaining children
  // ============================================================

  // Holds the trimmed-off children so they can be reinserted later.
  const MAX_TRIMMED_NOTIFICATIONS = 10;
  const flexOneHiddenChildren = new WeakMap();

  function trimNotifications() {
    if (document.querySelector("span.absolute")) return;

    const container = document.querySelector("div.min-h-0.flex-1");
    if (!container || flexOneHiddenChildren.has(container)) return;

    const hidden = Array.from(container.children).slice(
      MAX_TRIMMED_NOTIFICATIONS,
    );
    if (hidden.length === 0) return;

    hidden.forEach((child) => child.remove());
    flexOneHiddenChildren.set(container, hidden);
    bindNotificationScrollRestore(container);
  }

  function bindNotificationScrollRestore(container) {
    if (container.dataset.wmScrollRestoreBound === "true") return;
    container.dataset.wmScrollRestoreBound = "true";

    container.addEventListener("scroll", () => {
      const hidden = flexOneHiddenChildren.get(container);
      if (!hidden) return;

      const atBottom =
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 1;
      if (!atBottom) return;

      hidden.forEach((child) => container.appendChild(child));
      flexOneHiddenChildren.delete(container);
    });
  }

  function watchNotificationBoardArrival() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const isCardFrame = node.matches?.(
            "div.card-frame.shadow-xl.overflow-hidden",
          );
          const containsCardFrame = node.querySelector?.(
            "div.card-frame.shadow-xl.overflow-hidden",
          );
          if (isCardFrame || containsCardFrame) {
            trimNotifications();
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 16: when div.card-frame.shadow-xl.overflow-hidden enters the DOM, smoothly scroll the last unread
  // notification (an element carrying ACCENT_CLASS) into view
  // ============================================================
  function scrollToLastUnreadNotification() {
    const unread = document.querySelectorAll(`.${CSS.escape(ACCENT_CLASS)}`);
    if (unread.length === 0) return;
    const last = unread[unread.length - 1];

    last.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function watchUnreadNotificationScrollOnCardFrameArrival() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const isCardFrame = node.matches?.(
            "div.card-frame.shadow-xl.overflow-hidden",
          );
          const containsCardFrame = node.querySelector?.(
            "div.card-frame.shadow-xl.overflow-hidden",
          );
          if (isCardFrame || containsCardFrame) {
            scrollToLastUnreadNotification();
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature TMB: on /marketplace, when the "Mes enchères" tab is active, add a toggle next to h1.text-2xl.gap-2 that
  // groups div.flex-wrap's children into "Surenchéri" (first) and "Vous menez" (second), separated by an hr. Any
  // child whose span.rounded-lg label matches neither text (an edge case, not expected in practice) is folded into
  // the "Vous menez" group rather than dropped or given a group of its own.
  // ============================================================

  // Remembers each flex-wrap's original child order for un-grouping.
  const auctionWrapOriginalOrder = new WeakMap();

  // The marketplace tab button whose text starts with the label (Rule 9 and this feature both rely on it)
  function findMarketplaceTabButton(label) {
    return Array.from(document.querySelectorAll("button.px-4")).find((btn) =>
      btn.textContent.trim().startsWith(label),
    );
  }

  function findAuctionsTabButton() {
    return findMarketplaceTabButton("Mes enchères");
  }

  // Hides leftover ungrouped nodes React inserted before the group headings
  // arrived (only relevant when grouping is auto-applied from stored state).
  function hideAuctionLeftoversBeforeGrouping(wrap) {
    const firstHeading = wrap.querySelector(":scope > h2.wm-group-heading");
    if (!firstHeading) return;

    let sibling = firstHeading.previousElementSibling;
    while (sibling) {
      sibling.style.display = "none";
      sibling = sibling.previousElementSibling;
    }
  }

  function applyAuctionGrouping(wrap, grouped) {
    wrap
      .querySelectorAll(
        ":scope > .wm-group-list, :scope > .wm-group-separator, :scope > .wm-group-heading",
      )
      .forEach((el) => el.remove());

    if (!grouped) {
      const original = auctionWrapOriginalOrder.get(wrap);
      original?.forEach((child) => wrap.appendChild(child));
      return;
    }

    const children =
      auctionWrapOriginalOrder.get(wrap) ?? Array.from(wrap.children);
    if (!auctionWrapOriginalOrder.has(wrap)) {
      auctionWrapOriginalOrder.set(wrap, children.slice());
    }

    const surenchéri = [];
    const vousMenez = [];
    const others = [];

    children.forEach((child) => {
      const label = child.querySelector("span.rounded-lg")?.textContent ?? "";
      if (label.includes("Surenchéri")) surenchéri.push(child);
      else if (label.includes("Vous menez")) vousMenez.push(child);
      else others.push(child);
    });

    const makeGroupList = (heading, items) => {
      const h2 = document.createElement("h2");
      h2.className = "wm-group-heading";
      h2.textContent = heading;

      const labelSpan = items[0]?.querySelector("span.rounded-lg");
      labelSpan?.classList.forEach((cls) => {
        if (cls.startsWith("text-") || cls.startsWith("dark:text-"))
          h2.classList.add(cls);
      });

      const ol = document.createElement("ol");
      ol.className = "wm-group-list";
      items.forEach((child) => ol.appendChild(child));

      const fragment = document.createDocumentFragment();
      fragment.appendChild(h2);
      fragment.appendChild(ol);
      return fragment;
    };

    const separator = document.createElement("hr");
    separator.className = "wm-group-separator";

    wrap.appendChild(makeGroupList("Surenchéri", surenchéri));
    wrap.appendChild(separator);
    wrap.appendChild(makeGroupList("Vous menez", [...vousMenez, ...others]));
  }

  function setupAuctionGroupToggle() {
    if (!window.location.pathname.startsWith("/marketplace")) return;

    const h1 = document.querySelector("h1.text-2xl.gap-2");
    if (!h1) return;

    const tabActive = findAuctionsTabButton()?.classList.contains("border-b-2");
    if (!tabActive) {
      h1.querySelector(":scope > .wm-group-toggle")?.remove();
      return;
    }

    if (h1.querySelector(":scope > .wm-group-toggle")) return;

    const grouped = GM_getValue("wm-auction-grouped", false);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "wm-group-toggle";
    toggle.setAttribute("aria-pressed", String(grouped));
    toggle.title = "Grouper par Surenchéri / Vous menez";
    toggle.textContent = "Prioriser les surenchéris 🗂️";

    toggle.addEventListener("click", () => {
      const wrap = document.querySelector("div.flex-wrap");
      if (!wrap) return;

      const next = toggle.getAttribute("aria-pressed") !== "true";
      toggle.setAttribute("aria-pressed", String(next));
      GM_setValue("wm-auction-grouped", next);
      logger(CPL.LOG, `Auctions grouped: ${next}`);
      applyAuctionGrouping(wrap, next);
    });

    h1.appendChild(toggle);

    if (grouped) {
      const wrap = document.querySelector("div.flex-wrap");
      if (wrap) applyAuctionGrouping(wrap, true);
    }
  }

  function watchAuctionGroupToggle() {
    addStyle(`
      .wm-group-toggle {
        font-size: 0.9rem;
        margin-left: 0.75rem;
        padding: 0.5rem 0.75rem;
        border-radius: 0.5rem;
        line-height: 1;
        border: none;
        background: #ffffff0f;
        cursor: pointer;
        transition: background 0.2s ease, color 0.2s ease;
      }
      .wm-group-toggle:hover {
        background: #ffffff3f;
      }
      .wm-group-toggle[aria-pressed="true"] {
        opacity: 1;
        color: var(--color-accent);
      }
      .wm-group-list {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 1rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .wm-group-heading {
        width: 100%;
        font-size: 1.2rem;
        font-weight: 600;
        margin-inline: 1.25rem;
      }
      .wm-group-separator {
        width: 100%;
        color: transparent;
        margin-block: 2rem 1rem;
      }
    `);

    setupAuctionGroupToggle();

    const observer = new MutationObserver(() => setupAuctionGroupToggle());
    observer.observe(document.body, { childList: true, subtree: true });

    // Capture phase runs before React's own bubble-phase tab click handler,
    // so the wrap must be restored here — a MutationObserver reacts too
    // late, after React already tried to removeChild a relocated node.
    document.addEventListener(
      "click",
      (event) => {
        if (!event.target.closest("button.px-4")) return;

        const wrap = document.querySelector("div.flex-wrap");
        if (!wrap || !auctionWrapOriginalOrder.has(wrap)) return;
        if (
          !wrap.querySelector(
            ":scope > .wm-group-list, :scope > .wm-group-separator, :scope > .wm-group-heading",
          )
        )
          return;

        applyAuctionGrouping(wrap, false);
      },
      true,
    );
  }

  // ============================================================
  // Feature CME: on /pulls and /collection, while div.fixed.inset-0 (a modal) is in the DOM, pressing Escape clicks
  // the button labelled "Fermer"
  // ============================================================
  function watchPullsModalEscape() {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (
        !window.location.pathname.startsWith("/pulls") &&
        !window.location.pathname.startsWith("/collection")
      )
        return;

      const modal = document.querySelector("div.fixed.inset-0");
      if (!modal) return;

      modal.querySelector('[aria-label="Fermer"]')?.click();
    });
  }

  // ============================================================
  // Feature PNB: on a bid page (/marketplace/{UUID}), send a push notification when
  // span.tabular-nums.font-medium's text ends with "dans 30s"
  //
  // Feature PNB (cont'd): a 🔔/🔕 toggle inserted right before that same span mutes this notification for the
  // current tab only — off (muted) by default, since a per-tab affordance this easy to miss shouldn't opt
  // anyone into pushes they didn't ask for. The choice lives in sessionStorage rather than GM_setValue (used
  // elsewhere for cross-tab settings) precisely because it's per-tab: sessionStorage is isolated per tab and
  // cleared when it closes, so unmuting in one tab never affects another. Re-inserted on every checkBidTimer
  // tick rather than guarded by a one-time flag — same reasoning as Feature CNC's copy button — since the
  // countdown re-rendering can replace the span (and drop our button along with it); the previousElementSibling
  // check keeps this a no-op once it's already there. A muted timer still marks notifiedForPath as handled —
  // unmuting mid-countdown shouldn't fire a notification for a moment that's already passed.
  // ============================================================
  const BID_PAGE_REGEX = /^\/marketplace\/[0-9a-f]+/i;
  const PNB_TAB_MUTE_KEY = "wm-pnb-tab-muted";

  function isBidTimerNotificationMuted() {
    return sessionStorage.getItem(PNB_TAB_MUTE_KEY) !== "false";
  }

  function ensureBidTimerMuteToggle(span) {
    if (span.previousElementSibling?.classList.contains("wm-pnb-mute-toggle"))
      return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wm-pnb-mute-toggle";

    const applyState = (muted) => {
      btn.textContent = muted ? "🔕" : "🔔";
      btn.setAttribute("aria-pressed", String(muted));
      btn.title = muted
        ? "Notifications de fin d'enchère désactivées pour cet onglet (cliquer pour les réactiver)"
        : "Notifications de fin d'enchère activées (cliquer pour les désactiver sur cet onglet)";
    };
    applyState(isBidTimerNotificationMuted());

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const next = !isBidTimerNotificationMuted();
      sessionStorage.setItem(PNB_TAB_MUTE_KEY, String(next));
      applyState(next);
    });

    span.before(btn);
  }

  function watchBidTimerNotification() {
    addStyle(`
      .wm-pnb-mute-toggle {
        margin-inline: 0.25rem auto;
        background: none;
        border: none;
        cursor: pointer;
        font-size: 0.9rem;
        line-height: 1;
        opacity: 0.5;
        vertical-align: middle;
        transition: opacity 0.15s ease;
      }
      .wm-pnb-mute-toggle:hover {
        opacity: 1;
      }
    `);

    let notifiedForPath = null;

    function checkBidTimer() {
      if (!BID_PAGE_REGEX.test(window.location.pathname)) {
        notifiedForPath = null;
        return;
      }

      const span = document.querySelector("span.tabular-nums.font-medium");
      if (!span) return;

      ensureBidTimerMuteToggle(span);

      if (!span.textContent.trim().endsWith("dans 30s")) return;

      if (notifiedForPath === window.location.pathname) return;
      notifiedForPath = window.location.pathname;

      logger(
        CPL.INFO,
        `Bid timer reached 30s (notification ${isBidTimerNotificationMuted() ? "muted" : "enabled"})`,
      );
      if (isBidTimerNotificationMuted()) return;

      const cardNameEl = document.querySelector("h1.min-w-0");
      // Feature CNC's 📋 button lives inside the heading, so strip it from the text
      const cardName = cardNameEl
        ? cardNameEl.textContent.replace("📋", "").trim()
        : null;
      const notificationText = cardName
        ? `Il reste 30 secondes pour enchérir sur la carte « ${cardName} » !`
        : "Il reste 30 secondes pour enchérir sur cette carte !";

      logger(CPL.INFO, "Notification: bid timer", cardName);
      GM_notification({
        title: "Wiki-Masters",
        text: notificationText,
        timeout: 25000, //? 25 seconds
      });
    }

    checkBidTimer();

    const observer = new MutationObserver(() => checkBidTimer());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    setInterval(checkBidTimer, 1000);
  }

  // ============================================================
  // Rule 32: on a bid page (/marketplace/{UUID}, same BID_PAGE_REGEX as Feature PNB), give span.tabular-nums.font-
  // medium ("Se termine dans {time left}", the same span Feature PNB watches) a red glow — the same pulsing
  // box-shadow/text-shadow treatment Feature BSP's wm-legendary badge gets, just in red instead of gold — once the
  // time remaining drops to the "Seuil de la lueur rouge de fin d'enchère" setting of Feature CFG or below (5, 10,
  // 15 by default, or 30 seconds). The countdown's own text is parsed rather than assumed to always carry
  // a "30s"-style suffix like Feature PNB checks for, since any number of seconds left is also possible. The setting
  // is read at each tick (every second), and the glow is toggled both ways, so a change applies without a reload.
  // ============================================================
  const BID_TIMER_REMAINING_REGEX = /dans\s+(?:(\d+)h\s*)?(?:(\d+)m\s*)?(\d+)s/;

  function getBidTimerRemainingSeconds(text) {
    const match = text.match(BID_TIMER_REMAINING_REGEX);
    if (!match) return null;

    const hours = parseInt(match[1] ?? "0", 10);
    const minutes = parseInt(match[2] ?? "0", 10);
    const seconds = parseInt(match[3], 10);
    return hours * 3600 + minutes * 60 + seconds;
  }

  // Seconds left from which the countdown glows, from the setting of Feature CFG (15 by default)
  function getBidTimerUrgentThreshold() {
    const threshold = getConfigValue(BID_TIMER_URGENT_THRESHOLD_CONFIG_ID);
    traceOnce(`[BTU] Red glow threshold: ${threshold} s left`);
    return threshold;
  }

  function updateBidTimerUrgency() {
    if (!BID_PAGE_REGEX.test(window.location.pathname)) return;

    const span = document.querySelector("span.tabular-nums.font-medium");
    if (!span) return;

    const remaining = getBidTimerRemainingSeconds(span.textContent.trim());
    const isUrgent =
      remaining !== null && remaining <= getBidTimerUrgentThreshold();

    span.classList.toggle("wm-bid-timer-urgent", isUrgent);
  }

  function watchBidTimerUrgency() {
    addStyle(`
      .wm-bid-timer-urgent {
        color: #ef4444;
        animation: wm-bid-timer-urgent-glow 2s ease-in-out infinite;
      }
      @keyframes wm-bid-timer-urgent-glow {
        0%, 100% {
          text-shadow: 0 0 3px rgba(220, 38, 38, 0.6), 0 0 6px rgba(220, 38, 38, 0.3);
        }
        50% {
          text-shadow: 0 0 6px rgba(255, 60, 60, 1), 0 0 14px rgba(220, 38, 38, 0.9),
            0 0 22px rgba(220, 38, 38, 0.6);
        }
      }
    `);

    updateBidTimerUrgency();

    const observer = new MutationObserver(() => updateBidTimerUrgency());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    setInterval(updateBidTimerUrgency, 1000);
  }

  // ============================================================
  // Feature CAR: on /achievements, when div.grid contains "Réclamer" buttons, add a button before the grid that sums
  // up the reward amounts (from the <p> just before each button) and claims all
  // ============================================================
  function updateClaimAllButton() {
    if (!window.location.pathname.startsWith("/achievements")) return;

    const grid = document.querySelector("div.grid");
    if (!grid || !grid.parentElement) return;

    const claimButtons = Array.from(grid.querySelectorAll("button")).filter(
      (btn) => btn.textContent.trim() === "Réclamer",
    );

    const existing = grid.parentElement.querySelector(":scope > .wm-claim-all");
    if (claimButtons.length === 0) {
      existing?.remove();
      return;
    }

    const count = claimButtons.length;
    const total = claimButtons.reduce((sum, btn) => {
      const amountText = btn.previousElementSibling?.textContent ?? "";
      const match = amountText.match(/(\d+)/);
      return sum + (match ? parseInt(match[1], 10) : 0);
    }, 0);

    traceOnce(`[CAR] ${count} reward(s) to claim, +${total} wb in total`);
    const claimAllBtn = existing ?? document.createElement("button");
    if (!existing) {
      claimAllBtn.type = "button";
      claimAllBtn.className = "wm-claim-all";
      claimAllBtn.addEventListener("click", () => {
        grid.querySelectorAll("button").forEach((btn) => {
          if (btn.textContent.trim() === "Réclamer") btn.click();
        });
      });
      grid.before(claimAllBtn);
    }
    claimAllBtn.textContent = `Tout réclamer (+${total} wb grâce à ${count} récompense${count > 1 ? "s" : ""})`;
  }

  function watchClaimAllButton() {
    addStyle(`
      .wm-claim-all {
        display: block;
        margin: 0 auto 0.5rem auto;
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        border: 1px solid var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        color: var(--color-accent);
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s ease;
      }
      .wm-claim-all:hover {
        background: color-mix(in srgb, var(--color-accent) 20%, transparent);
      }
    `);

    // Debounce: only act once the grid stops mutating, so we don't
    // insert/remove mid-render while achievement cards are still streaming in.
    let debounceId = null;
    const scheduleUpdate = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(updateClaimAllButton, 500);
    };

    scheduleUpdate();

    const observer = new MutationObserver(() => scheduleUpdate());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ============================================================
  // Feature AKP: on /pulls, once div.gap-4:not(.flex-col) is in the DOM, pressing ArrowLeft/ArrowRight clicks its
  // first/second button; ArrowUp/ArrowDown do the same but 4 times in a row (each click re-reads the container/buttons,
  // waiting 50ms between clicks for React to re-render). Pressing Space, only while no modal (div.fixed.inset-0)
  // is open, clicks the "Continuer" button inside main, or button.relative.gap-4 if that's what's present in the
  // DOM instead. Pressing E, while a span reading "Carte" is inside main, clicks main img.scale-[1.8]. Pressing V
  // does the same as E, then (50ms later, to let React re-render the sell button after the card click) also
  // clicks button.py-2.5.font-semibold. E and V are ignored while focus is inside an <input>. ArrowLeft/ArrowRight and
  // ArrowUp/ArrowDown are ignored while a modal (div.fixed.inset-0, e.g. the card modal) is open.
  // ============================================================
  function clickPullsNavButton(direction) {
    const container = document.querySelector("div.gap-4:not(.flex-col)");
    if (!container) return false;

    const buttons = container.querySelectorAll(":scope > button");
    if (buttons.length < 2) return false;

    const navTarget = direction === "left" ? buttons[0] : buttons[1];
    navTarget.click();
    return true;
  }

  function clickPullsNavButtonRepeatedly(direction, times) {
    if (times <= 0) return;
    if (!clickPullsNavButton(direction)) return;

    if (times > 1) {
      setTimeout(() => clickPullsNavButtonRepeatedly(direction, times - 1), 50);
    }
  }

  function watchPullsArrowNavigation() {
    document.addEventListener("keydown", (event) => {
      if (!window.location.pathname.startsWith("/pulls")) return;

      const isE = event.key === "e" || event.key === "E";
      const isV = event.key === "v" || event.key === "V";

      if (isE || isV) {
        if (event.target instanceof HTMLInputElement) return;

        const hasCardSpan = Array.from(
          document.querySelectorAll("main span"),
        ).some((span) => span.textContent.trim() === "Carte");
        if (!hasCardSpan) return;

        const cardImg = document.querySelector("main img.scale-\\[1\\.8\\]");
        if (!cardImg) return;

        event.preventDefault();
        cardImg.click();

        if (isV) {
          setTimeout(() => {
            document.querySelector("button.py-2\\.5.font-semibold")?.click();
          }, 50); //? 50ms delay to let React re-render the button after the card image click
        }
        return;
      }

      const noOpenModal = !document.querySelector("div.fixed.inset-0");

      if (noOpenModal && (event.key === " " || event.code === "Space")) {
        const continueButton = Array.from(
          document.querySelectorAll("main button"),
        ).find((btn) => btn.textContent.trim() === "Continuer");
        const spaceTarget =
          continueButton || document.querySelector("button.relative.gap-4");
        if (!spaceTarget) return;

        event.preventDefault();
        spaceTarget.click();
        return;
      }

      // Navigation keys are left to the modal (scrolling, text caret...) while one is open
      if (!noOpenModal) return;

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        clickPullsNavButtonRepeatedly(
          event.key === "ArrowUp" ? "left" : "right",
          4,
        );
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      clickPullsNavButton(event.key === "ArrowLeft" ? "left" : "right");
    });
  }

  // ============================================================
  // Feature AKP (cont'd): on /pulls, while a pulled card is shown large (same guard as the E/V shortcuts above:
  // main div.relative.inline-flex is present), dock a small legend in the space to the left of the card listing
  // its keyboard shortcuts — ←/→ for Précédent/Suivant, ↑/↓ for Début/Fin. Précédent/Suivant already mirror
  // the on-screen chevron buttons, but ↑/↓ have no visual hint otherwise. Positioned from
  // main div.relative.inline-flex's own getBoundingClientRect(), same anchor and same self-healing pattern
  // (mutation observer + 200ms fallback timer, since navigating between cards doesn't reliably fire a mutation
  // these are watching for) as Feature OWL's own button, which it sits directly above so the two read as one
  // continuous list. Purely informational — pointer-events: none — so it never intercepts clicks.
  // ============================================================
  let pullsTutorialPanel = null;

  function ensurePullsTutorialPanel() {
    if (pullsTutorialPanel && document.body.contains(pullsTutorialPanel))
      return pullsTutorialPanel;

    const panel = document.createElement("div");
    panel.className = "wm-akp-tutorial";

    [
      ["←", "Carte précédente"],
      ["→", "Carte suivante"],
      ["↑", "Première carte"],
      ["↓", "Dernière carte"],
      ["E", "Ouvrir la carte"],
      ["V", "Ouvrir la vente"],
      ["W", "Ouvrir la page Wikipédia"],
      ["Space", "Ouvrir/Fermer le paquet"],
    ].forEach(([key, label]) => {
      const row = document.createElement("div");
      row.className = "wm-akp-tutorial-row";

      const keyEl = document.createElement("span");
      keyEl.className = "wm-akp-tutorial-key";
      keyEl.textContent = key;

      row.append(keyEl, document.createTextNode(label));
      panel.appendChild(row);
    });

    document.body.appendChild(panel);
    pullsTutorialPanel = panel;
    return panel;
  }

  function updatePullsTutorialPanel() {
    if (!window.location.pathname.startsWith("/pulls")) {
      if (pullsTutorialPanel) pullsTutorialPanel.style.display = "none";
      return;
    }

    const hasCardSpan = Array.from(document.querySelectorAll("main span")).some(
      (span) => span.textContent.trim() === "Carte",
    );
    const cardEl = hasCardSpan
      ? document.querySelector("main div.relative.inline-flex")
      : null;
    const rect = cardEl?.getBoundingClientRect();

    if (!rect || (rect.width === 0 && rect.height === 0)) {
      if (pullsTutorialPanel) pullsTutorialPanel.style.display = "none";
      return;
    }

    const panel = ensurePullsTutorialPanel();
    panel.style.display = "";
    panel.style.top = `${rect.top * 2 + rect.height / 2}px`;
    panel.style.left = `${rect.left}px`;
  }

  function watchPullsTutorialPanel() {
    addStyle(`
      .wm-akp-tutorial {
        position: fixed;
        transform: translate(-100%, calc(-100% - 1.5rem));
        margin-left: -0.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        padding: 0.4rem 0.55rem;
        background: rgba(0, 0, 0, 0.5);
        border-radius: 0.5rem;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        opacity: 0.25;
        pointer-events: none;
        transition: top 0.15s ease, left 0.15s ease;
      }
      .wm-akp-tutorial:hover {
        opacity: 1;
      }
      .wm-akp-tutorial-row {
        display: flex;
        flex-direction: row-reverse;
        align-items: center;
        gap: 0.4rem;
        white-space: nowrap;
        font-size: 0.78rem;
        color: #fff;
      }
      .wm-akp-tutorial-key {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 2.75rem;
        padding: 0.05rem 0.3rem;
        border: 1px solid rgba(255, 255, 255, 0.45);
        border-radius: 0.25rem;
        font-size: 0.68rem;
        font-weight: 600;
      }
    `);

    updatePullsTutorialPanel();

    const observer = new MutationObserver(() => updatePullsTutorialPanel());
    observer.observe(document.body, { childList: true, subtree: true });

    // Same self-heal rationale as Feature OWL's own button: navigating between revealed cards doesn't reliably
    // fire a mutation the observer above catches in time (or at all).
    setInterval(updatePullsTutorialPanel, 200);
  }

  // ============================================================
  // Rule 14: wherever div.min-h-0.overflow-y-auto is in the DOM (it only exists after a user action), for each of its
  // children that contains a <p> reading "Liste de souhaits", find the <p> that contains "vient d'être" and wrap the
  // text preceding that segment in « » guillemets
  //
  // Rule 14 (cont'd): that same <p> also contains the substring "en vente" right after "vient d'être" —
  // wrapped in its own span and tinted pink, the same treatment Rule 19 gives other notification types' key detail.
  //
  // Rule 14 (cont'd): the trailing " sur le marché" is also dropped — redundant with the "Liste de souhaits"
  // label right above it on the same notification.
  // ============================================================
  const WISHLIST_LISTED_PHRASE = "en vente";
  const WISHLIST_MARKETPLACE_SUFFIX = " sur le marché";

  function wrapWishlistToastCardName() {
    const list = document.querySelector("div.min-h-0.overflow-y-auto");
    if (!list) return;

    Array.from(list.children).forEach((child) => {
      const paragraphs = Array.from(child.querySelectorAll("p"));
      const isWishlistToast = paragraphs.some(
        (p) => p.textContent.trim() === "Liste de souhaits",
      );
      if (!isWishlistToast) return;

      const messageP = paragraphs.find((p) =>
        p.textContent.includes("vient d'être"),
      );
      if (!messageP || messageP.dataset.wmWishlistWrapped === "true") return;

      const idx = messageP.textContent.indexOf("vient d'être");
      const cardName = messageP.textContent.slice(0, idx).trim();
      const rest = messageP.textContent
        .slice(idx)
        .replace(WISHLIST_MARKETPLACE_SUFFIX, "");

      const listedIdx = rest.indexOf(WISHLIST_LISTED_PHRASE);

      messageP.textContent = `La carte « ${cardName} » `;
      if (listedIdx === -1) {
        messageP.append(rest);
      } else {
        messageP.append(rest.slice(0, listedIdx));

        const listedSpan = document.createElement("span");
        listedSpan.className = "wm-wishlist-listed";
        listedSpan.textContent = WISHLIST_LISTED_PHRASE;

        messageP.append(
          listedSpan,
          rest.slice(listedIdx + WISHLIST_LISTED_PHRASE.length),
        );
      }

      messageP.dataset.wmWishlistWrapped = "true";
    });
  }

  function watchWishlistToastWrap() {
    addStyle(`
      .wm-wishlist-listed {
        color: #f4c2f6;
        font-weight: 600;
      }
    `);

    wrapWishlistToastCardName();

    const observer = new MutationObserver(() => wrapWishlistToastCardName());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ============================================================
  // Rule 15: on a marketplace item URL, replace the text content of button.text-sm.gap-1.5 with "Retour en arrière",
  // leaving its svg icon child untouched
  // ============================================================
  function relabelMarketplaceBackButton() {
    if (!MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname)) return;

    const btn = document.querySelector("button.text-sm.gap-1\\.5");
    if (!btn || btn.textContent.trim() === "Retour en arrière") return;

    const textNode = Array.from(btn.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
    );
    if (!textNode) return;

    textNode.textContent = "Retour en arrière";
  }

  function watchMarketplaceBackButtonLabel() {
    relabelMarketplaceBackButton();

    const observer = new MutationObserver(() => relabelMarketplaceBackButton());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ============================================================
  // Feature PLB (OBSOLETE — its code has been removed and it no longer does anything; the number is kept so the
  // numbering of the other rules/features stays stable). It used to insert an "@" anchor linking to /profile/{name}
  // on a bid page (/marketplace/{UUID}): right before the first child of each ul.card-frame entry (the bidder's name),
  // and right before the seller's name (the <span> inside p.text-sm.mt-1).
  // ============================================================

  // ============================================================
  // Rule 33: on a bid page (/marketplace/{UUID}), force button.bg-[var(--color-accent)] (the "place a bid" button)
  // to a light red background when the current highest bidder — ul.card-frame's first entry, the bidder's name
  // being the <span> inside its p.text-xs — is your pseudo (Feature CFG's "Votre pseudo WikiMasters"), as a reminder you're already leading and don't need
  // to bid again.
  // ============================================================
  function isMyUsernameLeadingBid() {
    const nameSpan = document.querySelector("div.card-frame p.text-xs span");
    return isMyUsername(nameSpan?.textContent.trim());
  }

  function updateOwnBidButtonColor() {
    if (!MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname)) return;

    const bidButton = document.querySelector(
      "button.bg-\\[var\\(--color-accent\\)\\]",
    );
    if (!bidButton) return;

    bidButton.classList.toggle("wm-own-bid-leading", isMyUsernameLeadingBid());
  }

  function watchOwnBidButtonColor() {
    addStyle(`
      .wm-own-bid-leading {
        background-color: #fca5a5 !important;
        opacity: 0.5;
        transition: opacity 0.2s ease, background-color 0.2s ease;
      }
      .wm-own-bid-leading:hover {
        opacity: 1;
      }
    `);

    updateOwnBidButtonColor();

    const observer = new MutationObserver(() => updateOwnBidButtonColor());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ============================================================
  // Feature BSP: on a bid page, once span.font-medium reads "Vendue" or "Non vendue" (a cancelled auction,
  // "Annulée", is neither and is never recorded — findAuctionOutcomeSpan only matches text ending in "endue"), the
  // viewer isn't the seller of the auction (unsold or not) and
  // the viewer isn't the winning bidder (Rule 33's isMyUsernameLeadingBid — not the owned-card label,
  // span.bg-emerald-600/90, which is present whenever the viewer owns the card at all, won here or not), record
  // the final displayed price (span.text-2xl) — whether the auction actually sold or not, it's still useful
  // market signal — in localStorage, keyed by
  // "observed-{card name}" (h1.flex-1). A legacy entry still stored under the untagged card name is migrated to that
  // prefixed key on read. Skips while div.animate-spin is present (the page is still loading). Each stored entry is
  // tagged as "{price}-{tag}", tag being the bid UUID's second segment, so the same bid can never be recorded twice.
  // Each card keeps at most N entries (the "Prix de vente gardés par carte" setting of Feature CFG, 7 by default,
  // read when the code acts): once full, a new price replaces the array's current highest value, but only when it's
  // strictly lower than that value. Lowering the setting never deletes anything by itself: an array longer than the
  // new cap is only trimmed (its highest prices dropped) the next time that card is recorded or imported, and
  // until then the reference average still works on all of its stored prices.
  // ============================================================
  function getMaxStoredPrices() {
    return getConfigValue(MAX_STORED_PRICES_CONFIG_ID);
  }

  // Only this many of the stored prices (the lowest ones) feed the reference average (the "Prix retenus pour la
  // moyenne de référence" setting of Feature CFG, 5 by default); the extra stored ones are a buffer that keeps a card's
  // recent history without letting its higher prices weigh on the reference. It can never exceed the stored cap
  // (getMaxStoredPrices()): the clamp is applied here, when read, and warned about once per distinct clamp.
  let lastReferenceCountClampKey = null;
  function getReferencePricesCount() {
    const configured = getConfigValue(REFERENCE_PRICES_COUNT_CONFIG_ID);
    const maxStored = getMaxStoredPrices();
    const effective = Math.min(configured, maxStored);

    if (effective !== configured) {
      const clampKey = `${configured}/${maxStored}`;
      if (clampKey !== lastReferenceCountClampKey) {
        lastReferenceCountClampKey = clampKey;
        logger(
          CPL.WARN,
          `[BSP] Reference prices count ${configured} exceeds the stored cap ${maxStored}: using ${effective}`,
        );
      }
    } else {
      lastReferenceCountClampKey = null;
    }

    return effective;
  }
  const PRICE_ENTRY_REGEX = /^\d+-[0-9a-f]+$/i;
  const BSP_KEY_PREFIX = "observed-";

  function getBspObservedStorageKey(cardName) {
    return `${BSP_KEY_PREFIX}${cardName}`;
  }

  // A stored price entry is either the current tagged string
  // ("{price}-{tag}") or a plain number, the pre-tagging legacy format.
  function isValidBspPriceArray(value) {
    return (
      Array.isArray(value) &&
      value.every(
        (v) =>
          typeof v === "number" ||
          (typeof v === "string" && PRICE_ENTRY_REGEX.test(v)),
      )
    );
  }

  // Migrates a legacy untagged key (the plain card name) to the
  // prefixed key if that's still where the data lives.
  function readBspEntries(cardName) {
    const key = getBspObservedStorageKey(cardName);
    let raw = localStorage.getItem(key);

    if (raw === null) {
      const legacyRaw = localStorage.getItem(cardName);
      if (legacyRaw !== null) {
        localStorage.setItem(key, legacyRaw);
        localStorage.removeItem(cardName);
        logger(CPL.LOG, `Legacy price key migrated: "${cardName}"`);
        raw = legacyRaw;
      }
    }

    return JSON.parse(raw ?? "[]");
  }

  // Feature BSP (cont'd): the reference price averaged from stored entries is weighted rather than plain, and only
  // covers the getReferencePricesCount() lowest of them (5 by default; a card stores up to getMaxStoredPrices() of them, 7 by default) —
  // out of N prices, the lowest weighs N, the second-lowest N-1, ... the highest weighs 1 — so a single high
  // outlier among mostly-low sales pulls the reference up less than an unweighted average would.
  function computeWeightedAveragePrice(numericPrices) {
    if (!numericPrices.length) return null;

    const sorted = [...numericPrices]
      .sort((a, b) => a - b)
      .slice(0, getReferencePricesCount());
    const n = sorted.length;

    let weightedSum = 0;
    let weightTotal = 0;
    sorted.forEach((price, index) => {
      const weight = n - index;
      weightedSum += price * weight;
      weightTotal += weight;
    });

    return weightedSum / weightTotal;
  }

  function getBidTag() {
    const match = window.location.pathname.match(MARKETPLACE_BID_PATH_REGEX);
    return match?.[1]?.split("-")[1] ?? null;
  }

  // The seller's username: on a bid page, the link (a.hover:underline) inside a p (right after "Mis en vente par").
  // The colon of Tailwind's "hover:underline" class must be escaped in a selector — unescaped, it reads as a
  // pseudo-class and querySelector throws, which silently broke every caller (Feature BSP's recording included).
  function getBidPageSellerUsername() {
    return (
      document.querySelector("p a.hover\\:underline")?.textContent.trim() ??
      null
    );
  }

  function findAuctionOutcomeSpan() {
    return Array.from(document.querySelectorAll("span.font-medium")).find(
      (span) => span.textContent.endsWith("endue"),
    );
  }

  function recordSoldBidPrice() {
    if (!MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname)) return;
    if (document.querySelector("div.animate-spin")) return;

    const soldSpan = findAuctionOutcomeSpan();
    if (!soldSpan || soldSpan.dataset.wmPriceStored === "true") return;

    if (isMyUsernameLeadingBid()) return;

    // Feature BSP (cont'd) handles the seller's own completed sales instead (see updateSnipableBadge) — don't let them
    // pollute the market-observed average. Applies to the viewer's own auctions whatever their outcome, an unsold
    // ("Non vendue") one included.
    if (isMyUsername(getBidPageSellerUsername())) return;

    // Read h1.flex-1's own text node directly (rather than its full textContent) since Feature CNC prepends a
    // 📋 button inside that same element — including it here would corrupt the "observed-{cardName}" cache key.
    const nameEl = document.querySelector("h1.flex-1");
    const cardName = nameEl
      ? Array.from(nameEl.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join("")
          .trim()
      : undefined;
    const priceText = document
      .querySelector("span.text-2xl")
      ?.textContent.replace(/\s/g, "");
    if (!cardName || !priceText) return;

    const price = parseInt(priceText, 10);
    if (Number.isNaN(price)) return;

    const tag = getBidTag();
    if (!tag) return;

    soldSpan.dataset.wmPriceStored = "true";

    const prices = readBspEntries(cardName);
    if (
      prices.some(
        (entry) => typeof entry === "string" && entry.endsWith(`-${tag}`),
      )
    )
      return;

    const entry = `${price}-${tag}`;

    const maxStoredPrices = getMaxStoredPrices();
    if (prices.length < maxStoredPrices) {
      prices.push(entry);
    } else {
      // The cap may have been lowered since this card was last written: drop the highest prices down to it first
      while (prices.length > maxStoredPrices) {
        const surplusEntry = prices.reduce((max, current) =>
          parseInt(current, 10) > parseInt(max, 10) ? current : max,
        );
        prices.splice(prices.indexOf(surplusEntry), 1);
        logger(
          CPL.LOG,
          `Stored prices over the cap (${maxStoredPrices}) for "${cardName}": dropped ${surplusEntry}`,
        );
      }
      const highestEntry = prices.reduce((max, current) =>
        parseInt(current, 10) > parseInt(max, 10) ? current : max,
      );
      if (price < parseInt(highestEntry, 10)) {
        prices[prices.indexOf(highestEntry)] = entry;
      }
    }

    localStorage.setItem(
      getBspObservedStorageKey(cardName),
      JSON.stringify(prices),
    );
    logger(CPL.LOG, `Sale price recorded: "${cardName}" ${entry}`);
  }

  function watchSoldBidPriceRecording() {
    // Debounce: a bid page mutates heavily while it's loading/hydrating.
    // Running this on every single mutation fights that churn and can
    // freeze the tab, so only act once mutations settle down.
    let debounceId = null;
    const scheduleUpdate = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(recordSoldBidPrice, 300);
    };

    scheduleUpdate();

    const observer = new MutationObserver(() => scheduleUpdate());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ============================================================
  // Feature BBS: remembers the user's biggest sales and biggest purchases, each in its own localStorage entry
  // (BEST_TRADE_KINDS: "wm-observed-best-sells" / "wm-observed-best-buys"): an array of single-key objects
  // ({ "{card name}": "{amount}-{tag}" }, tag being the bid UUID's second segment, same tagged format as Feature
  // BSP's entries), kept sorted from the biggest amount to the smallest and capped at TOP_LIMIT_MAX (100) entries, whatever the
  // "Taille des classements « Top »" setting of Feature CFG (default 40, shared with Rule 35's list) says: that setting
  // only decides how many of the biggest are shown, so lowering it deletes nothing and raising it back shows the
  // trades that were kept. Once full, a new trade only gets in when it's strictly bigger than the current smallest entry, which it
  // replaces. A trade whose tag is already stored is skipped, so revisiting an auction
  // never records it twice; with no tag available, nothing is recorded. Skips while div.animate-spin is present
  // (the page is still loading). Unlike Feature BSP's "observed-" cache, which deliberately ignores the user's own
  // trades, this one only keeps them.
  // Every trade also carries a cutoff: "{amount}-{tag}-{cutoff}", how far the amount sits from the card's cached
  // Feature ETS eval price ("eval-{name}"), as a signed integer percentage ((amount / eval - 1) * 100, rounded to 0
  // decimals: "-21" for 21% under the eval). With no usable eval for that card there's no cutoff, and the value stays
  // "{amount}-{tag}". Entries already stored are brought up to date with refreshBestTradeCutoffs (on startup, and
  // whenever the profile modal opens), since their eval may have appeared or moved since they were recorded.
  // Two sources feed each entry:
  //  - a bid page, once span.font-medium reads "Vendue" and the seller (getBidPageSellerUsername) is your pseudo (Feature CFG's "Votre pseudo WikiMasters")
  //    (sells), or the winning bidder is (isMyUsernameLeadingBid; buys), the final price being span.text-2xl;
  //  - /marketplace, while the kind's tab ("Historique" for sells, "Gagnées" for buys — the tab button whose text
  //    starts with it, carrying border-b-2) is the active one: every div[id^="marketplace-auction-"] card whose
  //    label span (span.uppercase) reads "Vendue pour" (not "Non vendue") / "Achetée pour", and — for sells only —
  //    whose "Vendu par {name}" line names your pseudo (Feature CFG's "Votre pseudo WikiMasters"). Card name from its h3, amount from the span right after
  //    the label, tag from the UUID in the card's id.
  // ============================================================
  const BEST_TRADE_KINDS = {
    sells: {
      key: "wm-observed-best-sells",
      tabLabel: "Historique",
      cardLabel: "Vendue pour",
      isOnBidPage: () => isMyUsername(getBidPageSellerUsername()),
      isOnCard: (card) => {
        const sellerText = Array.from(card.querySelectorAll("p")).find((p) =>
          p.textContent.trim().startsWith("Vendu par "),
        )?.textContent;
        return isMyUsername(sellerText?.trim().match(/^Vendu par (\S+)/)?.[1]);
      },
      // Deal score of a sale: its premium over the eval (price / eval - 1, so 1.75 for "+175%"), see computeDealScore
      // (NaN without an eval)
      score: (cardName, amount) => {
        const target = getCardEvalValueByName(cardName);
        return target ? computeDealScore(amount / target - 1, target) : NaN;
      },
      cutoffHint:
        "Écart du prix de vente par rapport à la valeur estimée sur le marché : ",
      modalTitle: () => `💰 Vos ${getTopLimit()} plus grosses ventes`,
      emptyText: "Aucune vente en cache pour le moment.",
      buttonIcon: "💰",
      buttonLabel: "Mes plus grosses ventes",
    },
    buys: {
      key: "wm-observed-best-buys",
      tabLabel: "Gagnées",
      cardLabel: "Achetée pour",
      isOnBidPage: () => isMyUsernameLeadingBid(),
      isOnCard: () => true,
      // Deal score of a buy: its discount from the eval (1 - price / eval, so 0.75 for "-75%"), see
      // computeDealScore (NaN without an eval)
      score: (cardName, amount) => {
        const target = getCardEvalValueByName(cardName);
        return target ? computeDealScore(1 - amount / target, target) : NaN;
      },
      cutoffHint:
        "Écart du prix d'achat par rapport à la valeur estimée sur le marché : ",
      modalTitle: () => `🛒 Vos ${getTopLimit()} plus gros achats`,
      emptyText: "Aucun achat en cache pour le moment.",
      buttonIcon: "🛒",
      buttonLabel: "Mes plus gros achats",
    },
  };

  // How good a deal is, for the "Trier par bonne affaire" switch and the entries' data-score: the edge (how far the
  // price is on the right side of the eval, as a fraction) weighted by ln(1 + eval) to the 4th power, so an edge
  // only scores high when it's both big and on a card that matters. The power is what keeps a small card's huge
  // percentage from outscoring a pricier card's smaller one, and 4 is the lowest round value that holds the
  // calibration cases at least 2x apart:
  //   sell 971 at +175% (eval 353) = 1.75 * 5.9^4 ≈ 2076   vs   sell 250 at +216% (eval 79) = 2.16 * 4.4^4 ≈ 797
  //   buy 605 at -64% (eval 1680) = 0.64 * 7.4^4 ≈ 1951    vs   buy 13 at -93% (eval 186) = 0.93 * 5.2^4 ≈ 696
  // A negative edge (overpriced buy, underpriced sale) scores negative.
  const DEAL_SCORE_LOG_POWER = 4;
  function computeDealScore(edge, target) {
    return edge * Math.log(1 + target) ** DEAL_SCORE_LOG_POWER;
  }

  function readBestTrades(kind) {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(BEST_TRADE_KINDS[kind].key) ?? "[]",
      );
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // "{amount}-{tag}[-{cutoff}]" -> its parts; cutoff is undefined when the entry has none. The cutoff is a signed
  // integer, hence the regex rather than a split on "-" ("1907-01feb2--21"). Entries written back when it was still
  // a 2-decimal ratio ("1907-01feb2-3.23") parse too, until the next refresh rewrites them.
  function parseBestTradeValue(value) {
    const match = String(value).match(/^(\d+)-([0-9a-f]+)(?:-(-?[\d.]+))?$/i);
    if (!match) {
      const [amount, tag] = String(value).split("-");
      return { amount: parseInt(amount, 10), tag, cutoff: undefined };
    }
    return { amount: parseInt(match[1], 10), tag: match[2], cutoff: match[3] };
  }

  // How far the amount sits from the card's cached ETS eval price, as a rounded signed percentage string ("-21",
  // "223", "0"); null when the card has no usable eval (missing, "?" or zero)
  function computeBestTradeCutoff(cardName, amount) {
    const target = getCardEvalValueByName(cardName);
    return target ? String(Math.round((amount / target - 1) * 100)) : null;
  }

  function formatBestTradeCutoff(cutoff) {
    return `${Number(cutoff) > 0 ? "+" : ""}${cutoff}%`;
  }

  function buildBestTradeValue(cardName, amount, tag) {
    const base = `${amount}-${tag}`;
    const cutoff = computeBestTradeCutoff(cardName, amount);
    traceOnce(
      `[BBS] "${cardName}": ${amount} vs estimate -> ${cutoff === null ? "no estimate" : `${cutoff}%`}`,
    );
    return cutoff === null ? base : `${base}-${cutoff}`;
  }

  // Biggest amount first; a stable sort, so equal amounts keep their order
  function sortBestTradesByAmount(trades) {
    const amountOf = (entry) =>
      parseBestTradeValue(Object.values(entry)[0]).amount;
    return [...trades].sort((a, b) => amountOf(b) - amountOf(a));
  }

  // Rewrites every stored entry's value with a freshly computed one and puts them back in amount order (a cache
  // written while purchases were ranked by deal score is in that order), only saving when something changed
  function refreshBestTradeCutoffs(kind) {
    let changed = false;
    let trades = readBestTrades(kind).map((entry) => {
      if (!entry || typeof entry !== "object") return entry;

      const cardName = Object.keys(entry)[0];
      const { amount, tag } = parseBestTradeValue(entry[cardName]);
      if (Number.isNaN(amount) || !tag) return entry;

      const value = buildBestTradeValue(cardName, amount, tag);
      if (value === entry[cardName]) return entry;

      changed = true;
      return { [cardName]: value };
    });

    if (trades.every((e) => e && typeof e === "object")) {
      const sorted = sortBestTradesByAmount(trades).slice(0, TOP_LIMIT_MAX);
      if (
        sorted.length !== trades.length ||
        sorted.some((entry, i) => entry !== trades[i])
      ) {
        if (sorted.length !== trades.length)
          logger(
            CPL.INFO,
            `Best ${kind} trimmed to the buffer size: ${trades.length} -> ${sorted.length}`,
          );
        changed = true;
      }
      trades = sorted;
    }

    if (changed)
      localStorage.setItem(BEST_TRADE_KINDS[kind].key, JSON.stringify(trades));
  }

  function addBestTrade(kind, cardName, amount, tag) {
    if (!tag) return;

    const amountOf = (entry) =>
      parseBestTradeValue(Object.values(entry)[0]).amount;
    const trades = readBestTrades(kind);
    if (
      trades.some((e) => parseBestTradeValue(Object.values(e)[0]).tag === tag)
    )
      return;

    // Stored at the largest size the setting offers, whatever the configured one (that only limits what is shown)
    if (trades.length >= TOP_LIMIT_MAX) {
      if (amount <= amountOf(trades[trades.length - 1])) return;
      trades.pop();
    }
    trades.push({
      [cardName]: buildBestTradeValue(cardName, amount, tag),
    });

    trades.sort((a, b) => amountOf(b) - amountOf(a));
    if (trades.length > TOP_LIMIT_MAX) trades.length = TOP_LIMIT_MAX;

    localStorage.setItem(BEST_TRADE_KINDS[kind].key, JSON.stringify(trades));
    logger(
      CPL.LOG,
      `Best ${kind} recorded: "${cardName}" ${amount} (buffer of ${TOP_LIMIT_MAX}, ${getTopLimit()} shown)`,
    );
  }

  function recordBestTradesFromBidPage() {
    if (!MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname)) return;
    if (document.querySelector("div.animate-spin")) return;

    const soldSpan = findAuctionOutcomeSpan();
    if (!soldSpan || soldSpan.textContent.trim() !== "Vendue") return;

    // Read h1.flex-1's own text node directly, same as recordSoldBidPrice (Feature CNC's 📋 button lives inside it)
    const nameEl = document.querySelector("h1.flex-1");
    const cardName = nameEl
      ? Array.from(nameEl.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join("")
          .trim()
      : "";
    const priceText = document
      .querySelector("span.text-2xl")
      ?.textContent.replace(/\s/g, "");
    const amount = parseInt(priceText, 10);
    if (!cardName || Number.isNaN(amount)) return;

    Object.entries(BEST_TRADE_KINDS).forEach(([kind, config]) => {
      const flag = `wmBest${kind}Stored`;
      if (soldSpan.dataset[flag] === "true" || !config.isOnBidPage()) return;

      soldSpan.dataset[flag] = "true";
      addBestTrade(kind, cardName, amount, getBidTag());
    });
  }

  function recordBestTradesFromMarketplaceTabs() {
    if (!window.location.pathname.startsWith("/marketplace")) return;
    if (document.querySelector("div.animate-spin")) return;

    Object.entries(BEST_TRADE_KINDS).forEach(([kind, config]) => {
      const tabActive = Array.from(document.querySelectorAll("button")).some(
        (btn) =>
          btn.textContent.trim().startsWith(config.tabLabel) &&
          btn.classList.contains("border-b-2"),
      );
      if (!tabActive) return;

      const flag = `wmBest${kind}Stored`;
      document
        .querySelectorAll('div[id^="marketplace-auction-"]')
        .forEach((card) => {
          if (card.dataset[flag] === "true") return;

          const label = Array.from(
            card.querySelectorAll("span.uppercase"),
          ).find((span) => span.textContent.trim() === config.cardLabel);
          if (!label || !config.isOnCard(card)) return;

          const cardName = card.querySelector("h3")?.textContent.trim();
          const amount = parseInt(
            label.nextElementSibling?.textContent.replace(/\s/g, ""),
            10,
          );
          const tag = card.id.replace("marketplace-auction-", "").split("-")[1];
          if (!cardName || Number.isNaN(amount) || !tag) return;

          card.dataset[flag] = "true";
          addBestTrade(kind, cardName, amount, tag);
        });
    });
  }

  function watchBestTradeRecording() {
    // Same debounce as watchSoldBidPriceRecording: a bid page mutates heavily while it hydrates
    let debounceId = null;
    const scheduleUpdate = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        recordBestTradesFromBidPage();
        recordBestTradesFromMarketplaceTabs();
      }, 300);
    };

    scheduleUpdate();
    Object.keys(BEST_TRADE_KINDS).forEach(refreshBestTradeCutoffs);

    const observer = new MutationObserver(() => scheduleUpdate());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ============================================================
  // Feature BSP (cont'd): on a bid page, flag the card name (h1.flex-1, given "display: contents") as "EXCELLENT" when
  // the current price (input.min-w-0) is below 80% of the weighted average of that card's stored sold prices
  // (computeWeightedAveragePrice: out of N prices, the lowest weighs N, the second-lowest N-1, ... the highest
  // weighs 1, so a single high outlier pulls the reference up less than a plain average would), "agréable" when
  // it's between 80% and 100% of that average, "tolérable" when it's between 100% and 120%, or "excessive" when it's
  // above 120%; unflag it as soon as none of those is true. Below 50% of that average, with at least 5 stored sold
  // prices backing it — so the average is
  // actually meaningful — it's flagged "prix extraordinaire" instead of "EXCELLENT"; below 20%, with that same
  // 5-entry restriction, and the price is at least LEGENDARY_MIN_DIFFERENCE below that average, it's flagged
  // "prix légendaire" instead (a smaller gap falls back to the lower tiers). When this bid's own price is
  // the only entry stored for that card (a cache no-hit that this bid's
  // end just filled), that lone entry trivially equals the current price and would otherwise misleadingly compute
  // as "tolérable" — flag it "NEW ENTRY" (white) instead, since there's no real history yet to compare against.
  // Skips while div.animate-spin is present (the page is still loading).
  //
  // Feature BSP (cont'd) — seller's own sale: when the auction just sold ("Vendue") and the seller (p.text-sm.mt-1's
  // username) is your pseudo (Feature CFG's "Votre pseudo WikiMasters"), the tag instead grades how good a SALE it was — the mirror image of the buyer-facing
  // grading: a price above 120% of the reference value is an "excellente" sale, above 100% "agréable", above 80%
  // "tolérable", below that "décevante". The reference here is the ETS eval price (localStorage "eval-{name}"),
  // not the "observed-" BSP average: recordSoldBidPrice never logs the seller's own sales there (see its own
  // comment), so that cache is essentially always empty for a card you just sold. With no eval price cached
  // either, it falls back to the same "NEW ENTRY" (white) tag, worded for a sale instead.
  //
  // Feature BSP (cont'd) — buyer's own win: when the auction just sold ("Vendue") and the viewer is the winning
  // bidder (isMyUsernameLeadingBid — not the owned-card label, span.bg-emerald-600/90, which says nothing about
  // whether THIS auction is what the viewer owns it from) — the usual buyer-facing tag also appends the
  // reference average it was compared against, as "(obj. {value})"
  //
  // Feature BSP (cont'd) — reliable reference price: that same "(obj. {value})" suffix is also appended whenever
  // the reliability tag would read "indice fiable" (observedEntryCount >= EXTRAORDINARY_MIN_OBSERVED_ENTRIES on a
  // buyer-facing tag), not just on the viewer's own win — a reliable reference is worth showing on its own merit.
  //
  // Feature BSP (cont'd) — cancelled auction: when any span.font-medium reads "Annulée", no tag is shown at all,
  // buyer- or seller-facing — a cancelled auction has no real sale or final bid worth grading or comparing to.
  // ============================================================
  const LEGENDARY_THRESHOLD_RATIO = 0.2;
  const LEGENDARY_MIN_DIFFERENCE = 50;
  const EXTRAORDINARY_THRESHOLD_RATIO = 0.5;
  const EXTRAORDINARY_MIN_OBSERVED_ENTRIES = 5;
  const EXCELLENT_THRESHOLD_RATIO = 0.8;
  const TOLERABLE_THRESHOLD_RATIO = 1.0;
  const EXCESSIVE_THRESHOLD_RATIO = 1.2;
  const BADGE_CLASSES = [
    "wm-legendary",
    "wm-extraordinary",
    "wm-excellent",
    "wm-agreeable",
    "wm-tolerable",
    "wm-excessive",
    "wm-new-entry",
  ];
  const BUY_STATUS_LABELS = {
    legendary: "prix légendaire",
    extraordinary: "prix extraordinaire",
    excellent: "prix excellent",
    agreeable: "prix agréable",
    tolerable: "prix tolérable",
    excessive: "prix excessif",
  };
  const SALE_STATUS_LABELS = {
    excellent: "vente excellente",
    agreeable: "vente agréable",
    tolerable: "vente tolérable",
    excessive: "vente décevante",
  };

  // Buyer-facing grade of a price against the reference average (see the thresholds above); shared by the bid page's
  // badge and Feature MPA's marketplace arrows.
  function computeBuyStatus(price, referenceValue, observedEntryCount) {
    const isBackedEnough =
      observedEntryCount >= EXTRAORDINARY_MIN_OBSERVED_ENTRIES;

    if (
      price < referenceValue * LEGENDARY_THRESHOLD_RATIO &&
      referenceValue - price >= LEGENDARY_MIN_DIFFERENCE &&
      isBackedEnough
    )
      return "legendary";
    if (
      price < referenceValue * EXTRAORDINARY_THRESHOLD_RATIO &&
      isBackedEnough
    )
      return "extraordinary";
    if (price < referenceValue * EXCELLENT_THRESHOLD_RATIO) return "excellent";
    if (price < referenceValue * TOLERABLE_THRESHOLD_RATIO) return "agreeable";
    if (price < referenceValue * EXCESSIVE_THRESHOLD_RATIO) return "tolerable";
    return "excessive";
  }

  // The buy/sale status badge and the reliability tag are grouped into a single wrapper div (nameEl's actual
  // next sibling) so they move and get cleaned up together, rather than tracking each as its own sibling.
  function findBadgeGroup(nameEl) {
    return nameEl.nextElementSibling?.classList.contains("wm-badge-group")
      ? nameEl.nextElementSibling
      : null;
  }

  function getOrCreateBadgeGroup(nameEl) {
    return (
      findBadgeGroup(nameEl) ??
      (() => {
        const group = document.createElement("div");
        group.className = "wm-badge-group";
        nameEl.after(group);
        return group;
      })()
    );
  }

  function findBadgeIn(group) {
    return (
      Array.from(group?.children ?? []).find((el) =>
        BADGE_CLASSES.some((cls) => el.classList.contains(cls)),
      ) ?? null
    );
  }

  function setBadge(group, existing, className, label) {
    if (
      existing?.classList.contains(className) &&
      existing.textContent === label
    )
      return;

    existing?.remove();

    const badge = document.createElement("span");
    badge.className = className;
    badge.textContent = label;
    group.prepend(badge);
  }

  function removeReliabilityTag(group) {
    group?.querySelector(".wm-unreliable, .wm-reliable")?.remove();
  }

  function setReliabilityTag(group, kind) {
    const className = kind === "reliable" ? "wm-reliable" : "wm-unreliable";
    const existingTag = group?.querySelector(".wm-unreliable, .wm-reliable");
    if (existingTag?.classList.contains(className)) return;

    existingTag?.remove();
    const tag = document.createElement("span");
    tag.className = className;
    if (kind === "reliable") {
      tag.innerHTML = `<span class="wm-check-icon">✓</span> indice fiable`;
    } else {
      tag.textContent = "⚠️ indice peu fiable";
      tag.title = "Observez cette vente pour améliorer la qualité de l'indice";
    }
    group?.appendChild(tag);
  }

  function updateSnipableBadge() {
    if (!MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname)) return;
    if (document.querySelector("div.animate-spin")) return;

    const nameEl = document.querySelector("h1.flex-1");
    if (!nameEl) return;

    let group = findBadgeGroup(nameEl);
    const existing = findBadgeIn(group);

    // A cancelled auction ("Annulée") isn't a real outcome to price against — no sale, no legitimate final bid —
    // so no tag at all, buyer- or seller-facing. findAuctionOutcomeSpan only matches text ending in "endue" and
    // wouldn't catch this anyway, hence the separate check here.
    const isCancelled = Array.from(
      document.querySelectorAll("span.font-medium"),
    ).some((span) => span.textContent.trim() === "Annulée");
    if (isCancelled) {
      group?.remove();
      return;
    }

    // Read nameEl's own text nodes directly (rather than its full textContent) since Feature CNC prepends a 📋
    // button inside that same element — including it here would corrupt the "observed-"/"eval-" cache lookups
    // this cardName feeds into below.
    const cardName = Array.from(nameEl.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim();
    const isSold = findAuctionOutcomeSpan()?.textContent.trim() === "Vendue";

    // Once an auction is terminated — sold OR "Non vendue" — the bid input is gone (bidding's over either way),
    // so branching on isSold here is wrong: a "Non vendue" auction has no input.min-w-0 either. Prefer the input
    // when it's actually there (a live auction); otherwise fall back to the final price display, same source
    // recordSoldBidPrice uses.
    const priceInput = document.querySelector("input.min-w-0");
    let price;
    if (priceInput) {
      price = parseInt(priceInput.value.replace(/\s/g, ""), 10);
    } else {
      const priceText = document
        .querySelector("span.text-2xl")
        ?.textContent.replace(/\s/g, "");
      price = parseInt(priceText, 10);
    }

    if (!cardName || Number.isNaN(price)) {
      group?.remove();
      return;
    }

    const isMySoldAuction = isSold && isMyUsername(getBidPageSellerUsername());
    const isMyWonAuction = isSold && isMyUsernameLeadingBid();

    // Your own sale is graded against the ETS eval price, not the "observed-" BSP cache: recordSoldBidPrice
    // deliberately never logs your own sales there (to keep the market-observed average clean), so that cache
    // is essentially always empty for a card you just sold — the eval price is what's actually available.
    let referenceValue;
    let observedEntryCount = 0;

    if (isMySoldAuction) {
      referenceValue = getCardEvalValueByName(cardName);
    } else {
      const stored = readBspEntries(cardName);
      observedEntryCount = stored.length;

      const currentTag = getBidTag();
      const isFreshCacheEntry =
        currentTag !== null &&
        stored.length === 1 &&
        typeof stored[0] === "string" &&
        stored[0].endsWith(`-${currentTag}`);

      if (isFreshCacheEntry) {
        group = getOrCreateBadgeGroup(nameEl);
        setBadge(group, existing, "wm-new-entry", "désormais observé");
        removeReliabilityTag(group);
        traceOnce(`[BSP] "${cardName}" is the first observed price: ${price}`);
        return;
      }

      referenceValue = computeWeightedAveragePrice(
        stored.map((entry) => parseInt(entry, 10)),
      );
    }

    if (referenceValue === null) {
      if (isMySoldAuction) {
        group = getOrCreateBadgeGroup(nameEl);
        setBadge(group, existing, "wm-new-entry", "vente non comparable");
        removeReliabilityTag(group);
        traceOnce(
          `[BSP] my sale of "${cardName}" (${price}) has no estimate to compare to`,
        );
        return;
      }

      group?.remove();
      return;
    }

    let status;
    if (isMySoldAuction) {
      if (price > referenceValue * EXCESSIVE_THRESHOLD_RATIO)
        status = "excellent";
      else if (price > referenceValue * TOLERABLE_THRESHOLD_RATIO)
        status = "agreeable";
      else if (price > referenceValue * EXCELLENT_THRESHOLD_RATIO)
        status = "tolerable";
      else status = "excessive";
    } else {
      status = computeBuyStatus(price, referenceValue, observedEntryCount);
    }

    const isReliable =
      !isMySoldAuction &&
      observedEntryCount >= EXTRAORDINARY_MIN_OBSERVED_ENTRIES;

    let label = isMySoldAuction
      ? SALE_STATUS_LABELS[status]
      : BUY_STATUS_LABELS[status];
    if (isMyWonAuction || isReliable) {
      label += ` (obj. ${Math.round(referenceValue)})`;
    }
    group = getOrCreateBadgeGroup(nameEl);
    setBadge(group, existing, `wm-${status}`, label);
    traceOnce(
      `[BSP] "${cardName}": ${price} vs reference ${Math.round(referenceValue)} (${isMySoldAuction ? "my sale, estimate" : `${observedEntryCount} observed price(s)`}) -> ${status}${isReliable ? ", reliable" : ""}`,
    );

    if (isMySoldAuction) {
      removeReliabilityTag(group);
    } else if (observedEntryCount <= 2) {
      setReliabilityTag(group, "unreliable");
    } else if (isReliable) {
      setReliabilityTag(group, "reliable");
    } else {
      removeReliabilityTag(group);
    }
  }

  function watchSnipableBadge() {
    addStyle(`
      h1.flex-1 {
        display: contents;
      }
      .wm-badge-group {
        position: relative;
        display: inline-flex;
        align-items: center;
        margin-left: 0.5rem;
      }
      .wm-legendary,
      .wm-extraordinary,
      .wm-excellent,
      .wm-agreeable,
      .wm-tolerable,
      .wm-excessive,
      .wm-new-entry {
        width: max-content;
        font-weight: 600;
        font-size: 0.85rem;
        border-radius: 0.375rem;
        padding: 0.1rem 0.4rem;
      }
      .wm-legendary {
        color: #fff4cc;
        background-color: rgba(255, 215, 0, 0.2);
        border: 1px solid rgba(255, 215, 0, 0.6);
        animation: wm-legendary-glow 3s ease-in-out infinite;
      }
      @keyframes wm-legendary-glow {
        0%, 100% {
          box-shadow: 0 0 3px rgba(255, 215, 0, 0.5), 0 0 6px rgba(255, 215, 0, 0.25);
          text-shadow: 0 0 3px rgba(255, 215, 0, 0.6);
        }
        50% {
          box-shadow: 0 0 9px rgba(255, 215, 0, 1), 0 0 18px rgba(255, 195, 0, 0.75),
            0 0 28px rgba(255, 215, 0, 0.4);
          text-shadow: 0 0 6px rgba(255, 240, 150, 1), 0 0 14px rgba(255, 215, 0, 0.9);
        }
      }
      .wm-extraordinary {
        color: #22d3ee;
        background-color: rgba(34, 211, 238, 0.15);
      }
      .wm-excellent {
        color: #d8b4fe;
        background-color: rgba(216, 180, 254, 0.15);
      }
      .wm-agreeable {
        color: #4ade80;
        background-color: rgba(74, 222, 128, 0.15);
      }
      .wm-tolerable {
        color: #fbbf24;
        background-color: rgba(251, 191, 36, 0.15);
      }
      .wm-excessive {
        color: #ef2222;
        background-color: rgba(239, 34, 34, 0.15);
      }
      .wm-new-entry {
        color: #ffffff;
        background-color: rgba(255, 255, 255, 0.15);
      }
      .wm-unreliable,
      .wm-reliable {
        position: absolute;
        bottom: 1.5rem;
        width: max-content;
        font-size: 0.7rem;
        color: rgba(255, 255, 255, 0.5);
      }
      .wm-check-icon {
        color: #4ade80;
        font-weight: 700;
      }
    `);

    // Debounce: same rationale as watchSoldBidPriceRecording — avoid
    // inserting/removing the badge on every mutation while the page
    // is still busy loading.
    let debounceId = null;
    const scheduleUpdate = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(updateSnipableBadge, 300);
    };

    scheduleUpdate();

    const observer = new MutationObserver(() => scheduleUpdate());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ============================================================
  // Feature MPA: on /marketplace, while the "Parcourir" or "Mes enchères" tab (a button of div.overflow-x-auto,
  // carrying border-b-2 when active) is the active one — the latter's cards may be nested in Feature TMB's group lists,
  // hence the snapshot below reads every auction card inside the container rather than its direct children — every listed card (div[id^="marketplace-auction-"], the container's children; div.hover:z-10 is only the card's image frame, which doesn't hold the price) whose name (h3) has an "observed-" cache entry
  // (Feature BSP) gets a colored arrow appended inside its price (span.inline-flex.gap-1, the "Mise de départ" amount). The price is graded exactly like the bid
  // page's buyer-facing badge (computeBuyStatus, against computeWeightedAveragePrice of the stored prices), so the
  // colors are the badge's: gold (légendaire), cyan (extraordinaire), purple (excellent), green (agréable), amber
  // (tolérable), red (excessif). ▼ means the price sits below the reference average (légendaire to agréable), ▲ at or
  // above it (tolérable, excessif). Hovering the arrow tells the grade and the reference; with 2 stored prices or
  // fewer the reference is flagged as unreliable (dimmed arrow), as the bid page's "indice peu fiable" tag does.
  // The listed amount is the current bid, so what is graded (and compared to the reference for the arrow's direction)
  // is that amount + 10% (MPA_NEXT_BID_RATIO), the price a new bid would actually cost, but only for a card in the
  // "Surenchéri" state (you were outbid); any other card is graded at its listed price.
  // Cards without a cache entry get no arrow; arrows are removed when leaving the tab. Updated in place when a card's
  // price changes, since the site re-renders the list.
  // The search results vary with every search and take a while to resolve: changes are watched inside
  // div.md:p-6 div.md:gap-5 (the results container), and only handled once the snapshot of its children's ids (the
  // auction ids) differs from the last handled one; the container is re-attached whenever the site replaces it, and
  // the tab's active state is tracked separately.
  // ============================================================
  const MPA_ARROW_CLASS = "wm-mpa-arrow";
  const MPA_NEXT_BID_RATIO = 1.1;

  // The tabs the arrows apply to: "Parcourir" and "Mes enchères"
  const MPA_TAB_LABELS = ["Parcourir", "Mes enchères"];

  function isBrowseTabActive() {
    return Array.from(
      document.querySelectorAll("div.overflow-x-auto button"),
    ).some(
      (btn) =>
        MPA_TAB_LABELS.some((label) =>
          btn.textContent.trim().startsWith(label),
        ) && btn.classList.contains("border-b-2"),
    );
  }

  function updateMarketplaceArrows() {
    if (!window.location.pathname.startsWith("/marketplace")) return;

    if (!isBrowseTabActive()) {
      document
        .querySelectorAll(`.${MPA_ARROW_CLASS}`)
        .forEach((el) => el.remove());
      document
        .querySelectorAll("[data-wm-mpa-up]")
        .forEach((card) => delete card.dataset.wmMpaUp);
      return;
    }

    let graded = 0;
    const auctionCards = document.querySelectorAll(
      'div[id^="marketplace-auction-"]',
    );
    auctionCards.forEach((card) => {
      const priceEl = card.querySelector("span.gap-1");
      const cardName = card.querySelector("h3")?.textContent.trim();
      const existing = card.querySelector(`.${MPA_ARROW_CLASS}`);
      if (!priceEl || !cardName) return;

      let stored = [];
      try {
        stored = readBspEntries(cardName);
      } catch {
        stored = [];
      }
      // The listed amount is the current bid. On a card you were outbid on ("Surenchéri" label, the same one Feature
      // TMB groups by), bidding again costs 10% more, and that is what is compared; any other card is compared as listed
      const currentPrice = parseInt(
        priceEl.textContent
          .match(/\d[\d\s\u00a0\u202f]*/)?.[0]
          .replace(/\s/g, ""),
        10,
      );
      const isOutbid = (
        card.querySelector("span.rounded-lg")?.textContent ?? ""
      ).includes("Surenchéri");
      const price = isOutbid
        ? Math.ceil(currentPrice * MPA_NEXT_BID_RATIO)
        : currentPrice;
      const reference = isValidBspPriceArray(stored)
        ? computeWeightedAveragePrice(stored.map((e) => parseInt(e, 10)))
        : null;

      if (reference === null || Number.isNaN(price)) {
        existing?.remove();
        delete card.dataset.wmMpaUp;
        return;
      }

      const unreliable = stored.length <= 2;
      const status = computeBuyStatus(price, reference, stored.length);
      const arrow = price < reference * TOLERABLE_THRESHOLD_RATIO ? "▼" : "▲";
      // Rule 40 dims the cards flagged here (the ones whose arrow points up)
      if (arrow === "▲") card.dataset.wmMpaUp = "true";
      else delete card.dataset.wmMpaUp;
      const title = `${BUY_STATUS_LABELS[status]} (obj. ${Math.round(reference)})${unreliable ? " — indice peu fiable" : ""}`;
      const className = `${MPA_ARROW_CLASS} wm-mpa-${status}${unreliable ? " wm-mpa-unreliable" : ""}`;

      if (
        existing &&
        existing.parentElement === priceEl &&
        existing.textContent === arrow &&
        existing.title === title &&
        existing.className === className
      )
        return;

      existing?.remove();
      const el = document.createElement("span");
      el.className = className;
      el.textContent = arrow;
      el.title = title;
      priceEl.append(el);
      graded++;
    });
    if (graded > 0)
      traceOnce(
        `[MPA] ${graded} of ${auctionCards.length} listed card(s) graded`,
      );
  }

  function watchMarketplaceArrows() {
    addStyle(`
      .${MPA_ARROW_CLASS} {
        font-weight: 700;
        cursor: help;
      }
      .wm-mpa-unreliable {
        opacity: 0.5;
      }
      .wm-mpa-legendary { color: #ffd700; text-shadow: 0 0 6px rgba(255, 215, 0, 0.8); }
      .wm-mpa-extraordinary { color: #22d3ee; }
      .wm-mpa-excellent { color: #d8b4fe; }
      .wm-mpa-agreeable { color: #4ade80; }
      .wm-mpa-tolerable { color: #fbbf24; }
      .wm-mpa-excessive { color: #ef2222; }
    `);

    // Debounce: the list re-renders heavily while it loads, and our own insertions also trigger the observers
    let debounceId = null;
    const scheduleUpdate = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(updateMarketplaceArrows, 300);
    };

    // The search results change with every search/filter/page and take a while to resolve: they are watched where
    // they live (the results container), rather than through the whole body, and only acted on once they have
    // actually landed. Each result is a child div whose id is its auction's id, so the ids of those children,
    // joined, make a snapshot of what the container currently shows: while it is empty (still loading) or the
    // loading spinner is up nothing is done, and an update is only scheduled when a new snapshot differs from the
    // last one handled. The container itself is replaced when the SPA navigates or re-renders its layout, hence the
    // body observer below, which re-attaches the results observer to the new container (forgetting the snapshot)
    // and notices tab switches — it never schedules an update for unrelated mutations.
    let watchedContainer = null;
    let wasBrowseTabActive = false;
    let handledSnapshot = null;

    const snapshotResults = () =>
      watchedContainer
        ? Array.from(
            watchedContainer.querySelectorAll(
              'div[id^="marketplace-auction-"]',
            ),
          )
            .map((child) => child.id)
            .join("|")
        : "";

    const checkResults = () => {
      if (document.querySelector("div.animate-spin")) return;

      const snapshot = snapshotResults();
      if (snapshot === "" || snapshot === handledSnapshot) return;

      handledSnapshot = snapshot;
      scheduleUpdate();
    };
    const resultsObserver = new MutationObserver(checkResults);

    const syncObservers = () => {
      const container = document.querySelector("div.md\\:p-6 div.md\\:gap-5");
      if (container !== watchedContainer) {
        resultsObserver.disconnect();
        watchedContainer = container;
        handledSnapshot = null;
        if (container) {
          resultsObserver.observe(container, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        }
        checkResults();
      }

      const isActive = isBrowseTabActive();
      if (isActive !== wasBrowseTabActive) {
        wasBrowseTabActive = isActive;
        handledSnapshot = null;
        scheduleUpdate();
        checkResults();
      }
    };

    syncObservers();

    const observer = new MutationObserver(syncObservers);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  // ============================================================
  // Feature BSP (cont'd): on the user's own profile (/profile), dump every card's stored sold prices into a grid,
  // inserted as a sibling right after div.grid; each entry gets a "✕" button to clear its stored data. Next to
  // "Vider le cache", an import/export pill copies/restores every "observed-"/"eval-" localStorage entry as JSON.
  // Entries are sorted by descending "Objectif" (weighted average price); entries with no computable average sort last.
  // ============================================================
  function collectStoredBidPrices() {
    // Snapshot the keys first: migrating a legacy key below removes it
    // from localStorage mid-scan, which would otherwise shift indices
    // and skip entries in a live localStorage.key(i) loop.
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }

    const entries = [];

    keys.forEach((key) => {
      const raw = localStorage.getItem(key);
      if (raw === null) return;

      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        return;
      }

      if (!isValidBspPriceArray(value)) return;

      const isTagged = key.startsWith(BSP_KEY_PREFIX);
      const cardName = isTagged ? key.slice(BSP_KEY_PREFIX.length) : key;

      if (!isTagged) {
        // Legacy untagged key — migrate it to the prefixed key.
        localStorage.setItem(getBspObservedStorageKey(cardName), raw);
        localStorage.removeItem(key);
      }

      entries.push([cardName, value]);
    });

    return entries;
  }

  // Renames every remaining untagged legacy key (a plain card name
  // holding a tagged-price-array value) to its "observed-" prefixed
  // form. Returns how many keys were migrated.
  function migrateUntaggedBspKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keys.push(key);
    }

    let migratedCount = 0;

    keys.forEach((key) => {
      if (key.startsWith(BSP_KEY_PREFIX)) return;

      const raw = localStorage.getItem(key);
      if (raw === null) return;

      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        return;
      }

      if (!isValidBspPriceArray(value)) return;

      localStorage.setItem(getBspObservedStorageKey(key), raw);
      localStorage.removeItem(key);
      migratedCount++;
    });

    return migratedCount;
  }

  // Feature BSP/ETS (cont'd): an import/export pill next to "Vider le cache" carries every "observed-" (Feature
  // BSP) and "eval-" (Feature ETS) localStorage entry as a downloadable "key,value" CSV file, so that cache can be
  // moved to another browser/device. Values are carried as their raw stored strings (not re-parsed), since Feature
  // BSP's entries are JSON-encoded arrays while Feature ETS's are plain strings; both are CSV-quoted as needed.
  // Feature FOL's followed-users list and Feature UDS's player descriptions are carried too.
  const TAGGED_CACHE_PREFIXES = [BSP_KEY_PREFIX, "eval-"];
  const JSON_TO_CSV_COST_RATIO = 1.8; //? JSON costs ~1.8 times what CSV does for this cache's data

  // Feature FOL's followed-users list (FOLLOWED_USERS_KEY, declared further down, hence the function) travels with
  // that cache too; on import it's merged into the local list rather than replacing it. Feature UDS's "desc-{username}"
  // entries (USER_DESC_KEY_PREFIX, also declared further down) travel with it as well; on import, a description is
  // only taken for a player you have none for.
  function isTaggedCacheKey(key) {
    return (
      key === FOLLOWED_USERS_KEY ||
      key.startsWith(USER_DESC_KEY_PREFIX) ||
      TAGGED_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))
    );
  }

  function collectTaggedCacheEntries() {
    const entries = {};

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isTaggedCacheKey(key)) continue;

      const raw = localStorage.getItem(key);
      if (raw !== null) entries[key] = raw;
    }

    return entries;
  }

  // RFC 4180-ish: wraps a field in quotes (doubling any inner quote) whenever it contains a comma, quote or
  // line break; left as-is otherwise.
  function csvEscapeField(field) {
    const str = String(field);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function buildTaggedCacheCsv(entries) {
    const rows = [["key", "value"], ...Object.entries(entries)];
    return rows.map((row) => row.map(csvEscapeField).join(",")).join("\r\n");
  }

  // Minimal RFC 4180 parser: handles quoted fields, doubled-quote escapes, and commas/line breaks inside quotes.
  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (inQuotes) {
        if (char === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }

    if (field !== "" || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  function exportTaggedCacheEntries() {
    const entries = collectTaggedCacheEntries();
    const count = Object.keys(entries).length;
    const csv = buildTaggedCacheCsv(entries);

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `wiki-masterbetter-cache-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    logger(CPL.INFO, `Cache exported (${count} entries)`);
    GM_notification({
      title: "Wiki-Masters",
      text: `${count} entrée(s) exportée(s) en CSV.`,
      timeout: 4000,
    });
  }

  // Feature BSP/ETS (cont'd): importing is strictly additive — nothing already in the local cache is ever deleted,
  // and an imported row only changes a local entry when business rules prove it adds information. Each merge
  // function returns the value to store, or null when the local entry must stay untouched (so re-importing the
  // same file is a no-op):
  //  - "eval-{name}" (Feature ETS): a genuine numeric eval always beats the "?" placeholder (same invariant as
  //    recordTabularNumsValue: "?" never replaces a real value); absent locally -> imported one is added; two
  //    different numeric evals -> the local one stays, since it's the one this browser observed itself and keeps
  //    refreshing every time the card's market modal opens, whereas the file carries no timestamp to tell which is
  //    fresher. A value that is neither "?" nor a number is invalid and skipped.
  //  - "observed-{name}" (Feature BSP): the union of both arrays, deduplicated — tagged entries by their tag (the
  //    same bid is the same trade, whichever side recorded it; local copy kept), legacy plain numbers by
  //    multiplicity (max of both sides' counts, so they aren't doubled by a second import). Over the configured cap (getMaxStoredPrices()),
  //    the lowest prices are kept — the outcome the cap rule of recordSoldBidPrice converges to (a full list only
  //    ever swaps its highest price for a lower one) — so the only entries ever evicted are the surplus highest,
  //    exactly as a regular recording would have. An invalid array is skipped.
  function parseEvalForMerge(raw) {
    if (raw === UNKNOWN_EVAL_VALUE) return UNKNOWN_EVAL_VALUE;
    const num = parseFloat(String(raw).replace(/\s/g, "").replace(",", "."));
    return Number.isNaN(num) ? null : num;
  }

  function mergeImportedEval(localRaw, importedRaw) {
    const imported = parseEvalForMerge(importedRaw);
    if (imported === null) return null;
    if (localRaw === null) return importedRaw;

    const local = parseEvalForMerge(localRaw);
    if (local === null)
      return imported === UNKNOWN_EVAL_VALUE ? null : importedRaw; // corrupt local: repaired
    if (local === UNKNOWN_EVAL_VALUE && imported !== UNKNOWN_EVAL_VALUE) {
      return importedRaw;
    }
    return null;
  }

  function bspEntryPrice(entry) {
    return typeof entry === "number" ? entry : parseInt(entry, 10);
  }

  function mergeImportedBspEntries(localRaw, importedRaw) {
    let imported;
    let local = [];
    try {
      imported = JSON.parse(importedRaw);
      if (localRaw !== null) local = JSON.parse(localRaw);
    } catch {
      return null;
    }
    if (!isValidBspPriceArray(imported)) return null;
    if (!isValidBspPriceArray(local)) local = [];

    const merged = [...local];
    const seenTags = new Set(
      local.filter((e) => typeof e === "string").map((e) => e.split("-")[1]),
    );
    const legacyCount = (list, value) => list.filter((e) => e === value).length;

    imported.forEach((entry) => {
      if (typeof entry === "string") {
        const tag = entry.split("-")[1];
        if (seenTags.has(tag)) return;
        seenTags.add(tag);
        merged.push(entry);
      } else if (legacyCount(merged, entry) < legacyCount(imported, entry)) {
        merged.push(entry);
      }
    });

    const maxStoredPrices = getMaxStoredPrices();
    const kept = merged
      .map((entry, index) => ({ entry, index }))
      .sort(
        (a, b) =>
          bspEntryPrice(a.entry) - bspEntryPrice(b.entry) || a.index - b.index,
      )
      .slice(0, maxStoredPrices)
      .sort((a, b) => a.index - b.index)
      .map(({ entry }) => entry);

    // Nothing new came in: leave the local array alone, even if a lowered cap would now trim it (a config change
    // never deletes data by itself)
    if (merged.length === local.length) return null;

    const result = JSON.stringify(kept);
    return result === localRaw ? null : result;
  }

  function safeJsonParse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function importTaggedCacheEntries() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const rows = parseCsvRows(String(reader.result ?? ""));
        let importedCount = 0;
        let validCount = 0;

        rows.forEach(([key, value]) => {
          if (typeof key !== "string" || typeof value !== "string") return;
          if (!isTaggedCacheKey(key)) return;

          if (key === FOLLOWED_USERS_KEY) {
            try {
              const imported = JSON.parse(value);
              if (!Array.isArray(imported)) return;

              const merged = new Set([
                ...readFollowedUsers(),
                ...imported.filter((u) => typeof u === "string"),
              ]);
              validCount++;
              if (merged.size !== readFollowedUsers().length) {
                localStorage.setItem(key, JSON.stringify([...merged]));
                importedCount++;
              }
            } catch (error) {
              logger(
                CPL.WARN,
                "Cache import: followed users row skipped",
                error,
              );
              // Not a followed-users list: skipped like any other invalid row
            }
            return;
          }

          if (key.startsWith(USER_DESC_KEY_PREFIX)) {
            const text = value.trim();
            if (!text || text.length > USER_DESC_MAX_LENGTH) return;

            validCount++;
            if (readUserDescription(key.slice(USER_DESC_KEY_PREFIX.length)))
              return;
            localStorage.setItem(key, text);
            importedCount++;
            return;
          }

          const isEval = key.startsWith("eval-");
          const isBsp = key.startsWith(BSP_KEY_PREFIX);
          if (!isEval && !isBsp) return;

          const localRaw = localStorage.getItem(key);
          const next = isEval
            ? mergeImportedEval(localRaw, value)
            : mergeImportedBspEntries(localRaw, value);
          const isValid = isEval
            ? parseEvalForMerge(value) !== null
            : isValidBspPriceArray(safeJsonParse(value));
          if (isValid) validCount++;
          if (next === null) return;

          localStorage.setItem(key, next);
          importedCount++;
        });

        if (validCount === 0) {
          logger(CPL.WARN, "Cache import refused: no valid entry in the file");
          alert("Le fichier n'est pas un export valide.");
          return;
        }
        if (importedCount === 0) {
          logger(CPL.INFO, `Cache import: nothing new (${validCount} valid)`);
          alert("Aucune nouvelle entrée : votre cache contient déjà tout.");
          return;
        }

        // Every consumer of this cache (profile grid, ETS modal, trades, followed users, descriptions) reads it at render time,
        // so without a reload an import looks like it did nothing
        logger(
          CPL.INFO,
          `Cache imported (${importedCount} of ${validCount} valid entries), reloading`,
        );
        alert(
          `${importedCount} entrée(s) importée(s). La page va se recharger.`,
        );
        window.location.reload();
      };
      reader.onerror = () => {
        logger(CPL.ERROR, "Cache import: file unreadable", reader.error);
        alert("Le fichier n'a pas pu être lu.");
      };
      reader.readAsText(file);
    });

    input.click();
  }

  // The block is folded by default: only its title shows, with a switch at its right end that unfolds it (state
  // not remembered between visits).
  function renderStoredBidPricesGrid() {
    if (window.location.pathname !== "/profile") return;

    const grid = document.querySelector("div.grid");
    if (
      !grid ||
      grid.nextElementSibling?.classList.contains("wm-bsp-dump-actions")
    )
      return;

    // Rendered even with nothing observed yet: the actions row (export, import — the way to fill a fresh browser —
    // and cache clearing) must stay reachable, and Feature FOL anchors its list on the dump
    const entries = collectStoredBidPrices();

    const dump = document.createElement("div");
    dump.className = "wm-bsp-dump";

    const title = document.createElement("h2");
    title.className = "wm-bsp-dump-title";
    title.textContent = "🎯 Prix de vente des enchères observées ";

    const titlePrecision = document.createElement("span");
    titlePrecision.className = "wm-bsp-dump-title-precision";
    titlePrecision.textContent = `(max ${getMaxStoredPrices()}, moyenne sur les ${getReferencePricesCount()} moins chères)`;
    title.appendChild(titlePrecision);

    // Folded by default; the switch (aria-pressed = unfolded) shows/hides everything but the title
    dump.classList.add("wm-bsp-dump-folded");
    const foldSwitchContainer = document.createElement("span");
    foldSwitchContainer.className = "wm-bsp-dump-switch-container";
    const foldSwitchLabel = document.createElement("span");
    foldSwitchLabel.className = "wm-bsp-dump-switch-label";
    foldSwitchLabel.textContent = "Déplier / replier";
    foldSwitchContainer.appendChild(foldSwitchLabel);
    const foldSwitch = document.createElement("button");
    foldSwitch.type = "button";
    foldSwitch.className = "wm-bsp-dump-switch";
    foldSwitch.setAttribute("role", "switch");
    foldSwitch.setAttribute("aria-checked", "false");
    foldSwitch.setAttribute("aria-pressed", "false");
    foldSwitch.title = "Déplier / replier la liste des prix observés";
    foldSwitch.addEventListener("click", () => {
      const unfolded = foldSwitch.getAttribute("aria-checked") !== "true";
      foldSwitch.setAttribute("aria-checked", String(unfolded));
      foldSwitch.setAttribute("aria-pressed", String(unfolded));
      dump.classList.toggle("wm-bsp-dump-folded", !unfolded);
    });
    foldSwitchContainer.appendChild(foldSwitch);
    title.appendChild(foldSwitchContainer);

    dump.appendChild(title);

    // Text filter on the card names (case- and accent-insensitive); hides the entries that don't match. Being a
    // direct child of the block, it is folded away with the entries
    const filterInput = document.createElement("input");
    filterInput.type = "text";
    filterInput.className = "wm-bsp-dump-filter";
    filterInput.placeholder = "Filtrer par nom de carte...";
    filterInput.addEventListener("input", () => {
      const needle = foldAccents(filterInput.value.trim());
      let shown = 0;
      rows.forEach(({ cardName, entryEl }) => {
        const match = foldAccents(cardName).includes(needle);
        entryEl.style.display = match ? "" : "none";
        if (match) shown++;
      });
      logger(
        CPL.LOG,
        `Profile cache filter "${needle}": ${shown}/${rows.length} card(s) shown`,
      );
    });
    dump.appendChild(filterInput);

    const rows = [];

    const entriesWithAverage = entries.map(([cardName, prices]) => {
      const numericPrices = prices.map((entry) => parseInt(entry, 10));
      const weightedAverage = computeWeightedAveragePrice(numericPrices);
      const average =
        weightedAverage !== null ? Math.round(weightedAverage) : null;
      return { cardName, prices, average };
    });

    entriesWithAverage.sort(
      (a, b) => (b.average ?? -Infinity) - (a.average ?? -Infinity),
    );

    entriesWithAverage.forEach(({ cardName, prices, average }) => {
      const entryEl = document.createElement("div");
      entryEl.className = "wm-bsp-dump-entry";

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "wm-bsp-dump-clear";
      clearBtn.setAttribute("aria-label", `Effacer ${cardName}`);
      clearBtn.textContent = "✕";

      const nameCell = document.createElement("span");
      nameCell.className = "wm-bsp-dump-name";
      nameCell.textContent =
        cardName.length < 42 ? cardName : cardName.trim().slice(0, 42) + "...";

      const pricesCell = document.createElement("span");
      pricesCell.className = "wm-bsp-dump-prices";

      const averageCell = document.createElement("span");
      averageCell.className = "wm-bsp-dump-target";
      averageCell.textContent = average !== null ? `Objectif : ${average}` : "";
      pricesCell.appendChild(averageCell);

      const pricesListCell = document.createElement("span");
      pricesListCell.className = "wm-bsp-dump-prices-list";
      pricesListCell.textContent = prices
        .map((entry) => String(entry).split("-")[0])
        .join(",");
      pricesListCell.textContent = `(${pricesListCell.textContent})`;
      pricesCell.appendChild(pricesListCell);

      clearBtn.addEventListener("click", () => {
        logger(CPL.INFO, `Prices cleared: "${cardName}"`);
        localStorage.removeItem(getBspObservedStorageKey(cardName));
        clearBtn.remove();
        entryEl.classList.add("wm-bsp-dump-entry-cleared");
      });

      entryEl.appendChild(clearBtn);
      entryEl.appendChild(nameCell);
      entryEl.appendChild(pricesCell);
      dump.appendChild(entryEl);

      rows.push({ cardName, entryEl, clearBtn });
    });

    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "wm-bsp-dump-empty";
      empty.textContent = "Aucun prix de vente observé pour le moment.";
      dump.appendChild(empty);
    }
    logger(CPL.LOG, `Profile cache block rendered (${rows.length} card(s))`);

    const actionsRow = document.createElement("div");
    actionsRow.className = "wm-bsp-dump-actions";

    // The whole cache, i.e. everything the export carries (prices, estimates, followed players, descriptions). Stored
    // in localStorage it is JSON in UTF-16 (2 bytes per character of every key and raw value); the figure shown is
    // what it weighs as the CSV it is exported to and imported from, which a study found 1.8 times lighter
    const totalCacheSizeBytes =
      Object.entries(collectTaggedCacheEntries()).reduce(
        (sum, [key, raw]) => sum + (key.length + raw.length) * 2,
        0,
      ) / JSON_TO_CSV_COST_RATIO;
    const totalCacheSizeKb = (totalCacheSizeBytes / 1024).toFixed(1);

    const clearCacheBtn = document.createElement("button");
    clearCacheBtn.type = "button";
    clearCacheBtn.className = "wm-bsp-dump-clear-cache";
    clearCacheBtn.textContent = `Vider le cache (~${totalCacheSizeKb} Ko)`;
    actionsRow.appendChild(clearCacheBtn);

    clearCacheBtn.addEventListener("click", () => {
      // Feature ETS's estimates ("eval-{card name}") go too; the keys are snapshotted as removing shifts the indices
      const evalKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(EVAL_KEY_PREFIX)) evalKeys.push(key);
      }

      if (
        !confirm(
          `Vider le cache : supprimer les prix de vente observés de ${rows.length} carte(s) et ${evalKeys.length} estimation(s) ? Cette action est définitive.`,
        )
      ) {
        logger(CPL.LOG, "Cache clearing cancelled");
        return;
      }
      logger(
        CPL.INFO,
        `Cache cleared (${rows.length} card(s) of prices, ${evalKeys.length} estimate(s))`,
      );
      evalKeys.forEach((key) => localStorage.removeItem(key));
      localStorage.removeItem(TOP_EVALS_CACHE_KEY);
      rows.forEach(({ cardName, entryEl, clearBtn }) => {
        localStorage.removeItem(getBspObservedStorageKey(cardName));
        clearBtn.remove();
        entryEl.classList.add("wm-bsp-dump-entry-cleared");
      });
    });

    const importExportPill = document.createElement("div");
    importExportPill.className = "wm-bsp-dump-import-export";

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "wm-bsp-dump-import-export-btn";
    exportBtn.textContent = "Exporter";
    exportBtn.addEventListener("click", exportTaggedCacheEntries);

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "wm-bsp-dump-import-export-btn";
    importBtn.textContent = "Importer";
    importBtn.addEventListener("click", importTaggedCacheEntries);

    importExportPill.append(exportBtn, importBtn);
    actionsRow.appendChild(importExportPill);

    const importHint = document.createElement("span");
    importHint.className = "wm-bsp-dump-import-hint";
    importHint.textContent =
      "N.B. : l'import ajoute des informations sans supprimer l'existant.";
    actionsRow.appendChild(importHint);

    grid.after(actionsRow, dump);
  }

  function watchStoredBidPricesGrid() {
    addStyle(`
      .wm-bsp-dump {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
        margin-top: 1rem;
        padding: 0.75rem 1rem;
        border-radius: 0.75rem;
        border: 1px solid var(--color-border);
      }
      .wm-bsp-dump-empty {
        grid-column: 1 / -1;
        margin: 0;
        font-size: 0.85rem;
        opacity: 0.6;
      }
      .wm-bsp-dump-folded > :not(.wm-bsp-dump-title) {
        display: none;
      }
      .wm-bsp-dump-switch-container {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .wm-bsp-dump-switch-label {
        font-size: small;
        font-weight: normal;
      }
      .wm-bsp-dump-switch {
        position: relative;
        flex-shrink: 0;
        margin-left: auto;
        width: 2.25rem;
        height: 1.25rem;
        border: none;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.2);
        cursor: pointer;
        transition: background 0.2s ease;
      }
      .wm-bsp-dump-switch::after {
        content: "";
        position: absolute;
        top: 0.15rem;
        left: 0.15rem;
        width: 0.95rem;
        height: 0.95rem;
        border-radius: 50%;
        background: #fff;
        transition: transform 0.2s ease;
      }
      .wm-bsp-dump-switch[aria-checked="true"] {
        background: var(--color-accent);
      }
      .wm-bsp-dump-switch[aria-checked="true"]::after {
        transform: translateX(1rem);
      }
      .wm-bsp-dump-title {
        display: flex;
        align-items: center;
        grid-column: 1 / -1;
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
      }
      .wm-bsp-dump-title-precision {
        margin-left: 0.25rem;
        font-size: 0.8rem;
        font-weight: 400;
        opacity: 0.6;
      }
      .wm-bsp-dump-actions {
        display: flex;
        gap: 0.5rem;
        margin-top: 1rem;
        margin-bottom: 0.25rem;
      }
      .wm-bsp-dump-update-cache,
      .wm-bsp-dump-clear-cache {
        padding: 0.35rem 0.75rem;
        border-radius: 0.5rem;
        background: transparent;
        font-weight: 600;
        font-size: 0.75rem;
        letter-spacing: 0.05em;
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 0.2s ease, background-color 0.2s ease;
      }
      .wm-bsp-dump-update-cache {
        border: 1px solid var(--color-accent);
        color: var(--color-accent);
      }
      .wm-bsp-dump-update-cache:hover {
        opacity: 1;
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
      }
      .wm-bsp-dump-clear-cache {
        border: 1px solid #ef2222;
        color: #ef2222;
      }
      .wm-bsp-dump-clear-cache:hover {
        opacity: 1;
        background: rgba(239, 34, 34, 0.1);
      }
      .wm-bsp-dump-import-export {
        display: flex;
        border: 1px solid var(--color-accent);
        border-radius: 999px;
        overflow: hidden;
      }
      .wm-bsp-dump-import-hint {
        align-self: center;
        font-size: 0.75rem;
        opacity: 0.5;
      }
      .wm-bsp-dump-import-export-btn {
        padding: 0.35rem 0.75rem;
        border: none;
        background: transparent;
        color: var(--color-accent);
        font-weight: 600;
        font-size: 0.75rem;
        letter-spacing: 0.05em;
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 0.2s ease, background-color 0.2s ease;
      }
      .wm-bsp-dump-import-export-btn:first-child {
        border-right: 1px solid var(--color-accent);
      }
      .wm-bsp-dump-import-export-btn:hover {
        opacity: 1;
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
      }
      .wm-bsp-dump-entry {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.25rem 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 0.5rem;
        transition: opacity 0.2s ease;
      }
      .wm-bsp-dump-entry-cleared {
        opacity: 0.35;
      }
      .wm-bsp-dump-filter {
        grid-column: 1 / -1;
        justify-self: center;
        width: 25%;
        min-width: 12rem;
        padding: 0.5rem 0.75rem;
        border-radius: 0.5rem;
        border: 1px solid var(--color-border);
        background: transparent;
        color: inherit;
        font-size: 0.875rem;
      }
      .wm-bsp-dump-name {
        font-size: .825rem;
        font-weight: 600;
      }
      .wm-bsp-dump-clear {
        border: none;
        background: transparent;
        color: var(--color-foreground);
        opacity: 0.5;
        cursor: pointer;
        line-height: 1;
        transition: opacity 0.2s ease, color 0.2s ease;
      }
      .wm-bsp-dump-clear:hover {
        opacity: 1;
        color: #ef2222;
      }
      .wm-bsp-dump-target {
        color: #8db600;
        width: max-content;
        font-weight: 600;
        font-size: 1em;
      }
      .wm-bsp-dump-prices {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        margin-left: auto;
        font-size: .75em;
      }
    `);

    renderStoredBidPricesGrid();

    const observer = new MutationObserver(() => renderStoredBidPricesGrid());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature ETS: on /pulls and /collection, once the "Moyenne" row's span.tabular-nums appears (not the first
  // span.tabular-nums, which is the "Ventes" count), store its value in localStorage
  // under "eval-{name}", name being the text content of p.truncate. If it's missing but div.mb-5 p.mt-1\.5 reads
  // "Aucune vente" (no sales recorded yet for that card), stores the "?" placeholder (UNKNOWN_EVAL_VALUE) instead
  // of leaving that card unrecorded. p.truncate's own text node is read directly (rather than its full
  // textContent) since Feature CNC prepends a 📋 button inside that same element — including it here would
  // corrupt the cache key with a stray emoji. Never overwrites an already-stored genuine (numeric) eval with the
  // "?" placeholder — a transient DOM state during a page/modal transition (span.tabular-nums briefly gone while
  // a stale "Aucune vente" is still on screen) must not erase a value this already recorded correctly.
  // ============================================================
  const UNKNOWN_EVAL_VALUE = "?";

  function findAverageValueEl(root = document) {
    for (const label of root.querySelectorAll("span.uppercase")) {
      if (label.textContent.trim() !== "Moyenne") continue;
      const valueEl = label.parentElement?.querySelector("span.tabular-nums");
      if (valueEl) return valueEl;
    }
    return null;
  }

  function recordTabularNumsValue() {
    if (
      !window.location.pathname.startsWith("/pulls") &&
      !window.location.pathname.startsWith("/collection")
    )
      return;

    const valueEl = findAverageValueEl();
    const cardNameEl = document.querySelector("p.truncate");
    const cardName = cardNameEl
      ? Array.from(cardNameEl.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join("")
          .trim()
      : undefined;
    let value = valueEl?.textContent.trim().replace(/\s/g, "");

    if (!value) {
      const noSalesContainer = document.querySelector("div.mb-5 p.mt-1\\.5");
      if (noSalesContainer?.textContent.includes("Aucune vente")) {
        value = UNKNOWN_EVAL_VALUE;
      }
    }

    if (!cardName || !value) return;

    const key = `eval-${cardName}`;
    const existingValue = localStorage.getItem(key);
    if (existingValue === value) return;
    if (
      value === UNKNOWN_EVAL_VALUE &&
      existingValue !== null &&
      existingValue !== UNKNOWN_EVAL_VALUE
    )
      return;

    localStorage.setItem(key, value);
    logger(CPL.LOG, `Estimate recorded: "${cardName}" ${value}`);
  }

  function watchTabularNumsRecording() {
    // Debounce: same rationale as Feature BSP's watchers — avoid
    // running this on every single mutation while the page is busy.
    let debounceId = null;
    const scheduleUpdate = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(recordTabularNumsValue, 300);
    };

    scheduleUpdate();

    const observer = new MutationObserver(() => scheduleUpdate());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ============================================================
  // Feature ETS (cont'd): on /collection (and in the trade detail modal of /trades), whenever the cards grid (div.gap-3.justify-center) changes, append each
  // card's cached eval price (Feature ETS, keyed "eval-{name}") to its rarity tag (div.top-2.left-2), as
  // "{rarity} ({eval})". The eval value is reformatted first: below the configured threshold (the "Seuil « sans valeur » des estimations" setting of Feature CFG, 10 by
  // default), it's replaced outright with "💩"; above 1000, it's abbreviated to "{X,X} K" (French decimal comma); otherwise it's shown as stored, including the "?"
  // placeholder for a card with no recorded sales.
  // ============================================================
  // The threshold is read when each pass runs; a tag remembers the one it was rendered with (data-wm-worthless), so a
  // changed setting makes the next pass (the next DOM mutation, debounced 300 ms) rewrite the already-shown tags
  function getWorthlessThreshold() {
    return getConfigValue(WORTHLESS_THRESHOLD_CONFIG_ID);
  }

  function formatEvalValue(rawValue, threshold = getWorthlessThreshold()) {
    const num = parseFloat(rawValue.replace(/\s/g, "").replace(",", "."));
    if (Number.isNaN(num)) return rawValue;

    if (num < threshold) {
      return "💩";
    }

    if (num > 1000) {
      return `${(num / 1000).toFixed(1).replace(".", ",")} K`;
    }

    return rawValue;
  }

  // Rule 44 (cont'd): the cards of the trade detail modal on /trades (div.max-w-4xl) get the same appendix
  function getRarityTaggedCards() {
    const path = window.location.pathname;
    if (path.startsWith("/collection")) {
      const grid = document.querySelector("div.gap-3.justify-center");
      return grid ? Array.from(grid.children) : [];
    }
    if (path.startsWith("/trades")) {
      const modal = document.querySelector("div.max-w-4xl");
      if (!modal) return [];
      return Array.from(modal.querySelectorAll("h3"))
        .map((h3) => h3.closest("div.relative.rounded-2xl"))
        .filter(Boolean);
    }
    return [];
  }

  function appendEvalToRarityTags() {
    const cards = getRarityTaggedCards();
    if (cards.length === 0) return;

    const threshold = getWorthlessThreshold();
    let appended = 0;
    cards.forEach((card) => {
      const nameEl = card.querySelector("h3");
      const rarityEl = card.querySelector("div.top-2.left-2");
      if (!nameEl || !rarityEl) return;

      const cardName = nameEl.textContent.trim();
      const evalValue = localStorage.getItem(`eval-${cardName}`);
      if (!cardName || !evalValue) return;

      const baseRarity =
        rarityEl.dataset.wmBaseRarity ?? rarityEl.textContent.trim();
      rarityEl.dataset.wmBaseRarity = baseRarity;

      const appendixText = ` (${formatEvalValue(evalValue, threshold)})`;
      let appendix = rarityEl.querySelector(":scope > .wm-eval-appendix");

      if (!appendix) {
        rarityEl.textContent = baseRarity;
        appendix = document.createElement("span");
        appendix.className = "wm-eval-appendix";
        rarityEl.appendChild(appendix);
      }

      if (
        appendix.textContent === appendixText &&
        appendix.dataset.wmWorthless === String(threshold)
      )
        return;

      appendix.textContent = appendixText;
      appendix.dataset.wmWorthless = String(threshold);
      appended++;
    });
    if (appended > 0)
      traceOnce(
        `[ETS] estimate shown on ${appended} card tag(s) (worthless below ${threshold})`,
      );
  }

  function watchRarityEvalTags() {
    addStyle(`
      .wm-eval-appendix {
        font-size: 0.75em;
        opacity: 0.5;
      }
    `);

    // Debounce: same rationale as the rest of Feature ETS/BSP.
    let debounceId = null;
    const scheduleUpdate = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(appendEvalToRarityTags, 300);
    };

    scheduleUpdate();

    const observer = new MutationObserver(() => scheduleUpdate());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 17: on the notification container (div.card-frame.shadow-xl.overflow-hidden), replace its first
  // child's "justify-between" class with "gap-4"
  // ============================================================
  function replaceNotificationContainerFirstChildSpacing() {
    const container = document.querySelector(
      "div.card-frame.shadow-xl.overflow-hidden",
    );
    const firstChild = container?.firstElementChild;
    if (!firstChild || !firstChild.classList.contains("justify-between"))
      return;

    firstChild.classList.remove("justify-between");
    firstChild.classList.add("gap-4");
  }

  function watchNotificationContainerFirstChildSpacing() {
    replaceNotificationContainerFirstChildSpacing();

    const observer = new MutationObserver(() =>
      replaceNotificationContainerFirstChildSpacing(),
    );
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 18: on /collection and /pulls, when the card modal (div.card-frame.p-6) opens, focus its filter input
  // (input.px-3) after 250ms. Focusing it opens its dropdown, hence the dedicated "rule-18" toggle.
  // Rule 18b: on arrival on /collection, focus input.rounded-lg as soon as it enters the DOM. Toggle-able on its own
  // as "rule-18b". Also suppresses the focus outline on nav a[href="/pulls"], left lingering from the click that
  // navigated there (always on, with either toggle).
  // Rule 18 (cont'd): while that input is focused and its dropdown (ul.absolute) is open, Home/End select the first/last
  // item instead of moving the text cursor. The site's own selection can only be moved by its ArrowDown/ArrowUp
  // handlers, so those keys are replayed on the input, one per tick (React needs to re-render and update
  // aria-selected in between), until the first/last li carries aria-selected="true" — bounded by the item count.
  // ============================================================
  function selectCardModalListEdge(input, edge) {
    const key = edge === "first" ? "ArrowUp" : "ArrowDown";
    const press = () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key, code: key, bubbles: true }),
      );

    const run = async () => {
      const items = () =>
        Array.from(
          input
            .closest("div.card-frame.p-6")
            ?.querySelectorAll("ul.absolute li") ?? [],
        );
      const limit = items().length + 1;
      for (let i = 0; i < limit; i++) {
        const list = items();
        if (!list.length) return;
        const target = edge === "first" ? list[0] : list[list.length - 1];
        if (target.getAttribute("aria-selected") === "true") return;
        press();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    run();
  }

  function onCardModalInputHomeEnd(event) {
    if (event.key !== "Home" && event.key !== "End") return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
      return;

    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches("input.px-3"))
      return;
    const modal = input.closest("div.card-frame.p-6");
    if (!modal || !modal.querySelector("ul.absolute li")) return;

    event.preventDefault();
    selectCardModalListEdge(input, event.key === "Home" ? "first" : "last");
  }

  function focusCollectionModalInput() {
    if (
      !window.location.pathname.startsWith("/collection") &&
      !window.location.pathname.startsWith("/pulls")
    )
      return;

    const modal = document.querySelector("div.card-frame.p-6");
    if (!modal || modal.dataset.wmInputFocused === "true") return;

    modal.dataset.wmInputFocused = "true";

    setTimeout(() => {
      modal.querySelector("input.px-3")?.focus();
    }, 250);
  }

  function focusCollectionSearchInput() {
    if (!window.location.pathname.startsWith("/collection")) return;

    const input = document.querySelector("input.rounded-lg");
    if (!input || input.dataset.wmInputFocused === "true") return;

    input.dataset.wmInputFocused = "true";
    input.focus();
  }

  function watchCollectionModalInputFocus(flags) {
    addStyle(`
      nav a[href="/pulls"]:focus {
        outline: none;
      }
    `);

    if (flags["rule-18"]) {
      document.addEventListener("keydown", onCardModalInputHomeEnd, true);
    }

    const onMutation = () => {
      if (flags["rule-18"]) focusCollectionModalInput();
      if (flags["rule-18b"]) focusCollectionSearchInput();
    };
    onMutation();

    const observer = new MutationObserver(onMutation);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature FCP: a settings-wheel button, visually cloning .wm-fold-toggle, sits next to the sidebar's fold/pin toggle
  // (nav h1's closest nav). Clicking it opens a modal listing every rule/feature documented above, each with its own
  // checkbox; unchecking one disables it. A pill next to the hint text toggles every checkbox at once — reading
  // "Tout désélectionner" when all are checked, "Tout sélectionner" otherwise, and flipping to match whichever it
  // said. The choice is stored in localStorage under "wm-feature-flags" (default: everything enabled, except entries
  // with defaultEnabled: false, e.g. Feature TBD) and, since most rules only wire themselves up once at page load,
  // applies after the next reload — hence the "Recharger la page" button in the modal's footer. Styled independently of
  // .wm-fold-toggle's own stylesheet (injected by rule 6) so this button and modal always work even when every other
  // rule/feature is disabled.
  // ============================================================
  const FEATURE_FLAGS_KEY = "wm-feature-flags";

  const FEATURE_REGISTRY = [
    { id: "rule-1a", label: "Notifications affichées en plus grand" },
    { id: "rule-1b", label: "Masquer le bouton d'analyse de marché" },
    {
      id: "rule-2",
      label: "Marquer les notifications précédentes comme lues au clic",
    },
    { id: "rule-3", label: "Suffixe du titre d'onglet selon la page active" },
    { id: "rule-4", label: "Grille d'amis sur 3 colonnes" },
    { id: "rule-5", label: "Réduire les boutons Message / Échanger" },
    { id: "rule-6", label: "Repli automatique de la barre latérale" },
    { id: "feature-npn", label: "Épingle pour la barre latérale" },
    { id: "rule-7", label: "Tout marquer lu au clic sur la 1ère notification" },
    { id: "feature-tbc", label: "Bouton d'échange rapide sur la collection" },
    {
      id: "rule-9",
      label:
        "Ouvrir l'onglet choisi du marché à l'arrivée et trier « Parcourir » par fin imminente à la saisie",
    },
    { id: "rule-10", label: "Mise à jour du compteur au clic sur un objet" },
    { id: "rule-11", label: "Opacité réduite de l'incitation Pro épuisée" },
    { id: "rule-12", label: "Boutons d'action plus visibles sur les profils" },
    {
      id: "feature-pnp",
      label: "Notification push quand les paquets s'accumulent",
    },
    { id: "rule-13", label: "Limiter l'affichage à 20 notifications lues" },
    { id: "feature-tmb", label: "Regrouper les enchères par statut" },
    { id: "feature-cme", label: "Fermer les modales avec Échap" },
    {
      id: "feature-pnb",
      label: "Notification push en fin d'enchère (30 secondes)",
    },
    {
      id: "feature-car",
      label: "Bouton « Tout réclamer » sur les hauts faits",
    },
    { id: "feature-akp", label: "Navigation au clavier sur /pulls" },
    {
      id: "feature-sat",
      label: "Bouton « Tout sélectionner sauf étiquetées »",
    },
    { id: "feature-lbd", label: "Lancer l'enchère avec la touche Entrée" },
    {
      id: "rule-14",
      label: "Encadrer le nom de carte des notifications de liste de souhaits",
    },
    { id: "rule-15", label: "Re-labelliser le bouton retour d'une enchère" },
    {
      id: "rule-16",
      label: "Défilement vers la dernière notification non lue",
    },
    {
      id: "feature-bsp",
      label: "Suivi et alerte des prix de vente des enchères",
    },
    { id: "rule-17", label: "Espacement du conteneur de notifications" },
    {
      id: "rule-18",
      label:
        "Focus automatique sur le champ de filtre à l'ouverture d'une carte",
    },
    {
      id: "rule-18b",
      label: "Focus automatique sur la recherche de la collection",
    },
    { id: "feature-ets", label: "Mémorisation des estimations de cartes" },
    {
      id: "rule-19",
      label:
        "Reformuler les notifications (carte rendue, remboursement, vente)",
    },
    {
      id: "feature-ebc",
      label: "Bouton d'évaluation groupée des cartes non estimées",
    },
    {
      id: "rule-20",
      label: "Scroll suit la sélection clavier dans la modale de carte",
    },
    {
      id: "feature-gcp",
      label: "Lien de profil sur le nom des amis (souhaits globaux)",
    },
    {
      id: "rule-21",
      label: "Masquer les mentions légales de la modale de carte",
    },
    {
      id: "feature-cnc",
      label: "Copier le nom de la carte depuis sa modale",
    },
    {
      id: "rule-22",
      label: "Centrer le chargement / « Enchère introuvable » dans la page",
    },
    { id: "rule-23", label: "Remplacer le favicon du site" },
    {
      id: "feature-fis",
      label:
        "Corriger le style de la transition de page (/pulls, /friends, /guild)",
    },
    {
      id: "rule-24",
      label: "Ajuster la taille de la liste d'étiquettes et la trier par usage",
    },
    {
      id: "rule-25",
      label: "Dé-lister les cartes possédées de la liste de souhaits",
    },
    {
      id: "rule-26",
      label: "Historique des échanges sur deux colonnes",
    },
    {
      id: "rule-27",
      label: "Filtrer l'historique des échanges par utilisateur",
    },
    {
      id: "rule-28",
      label: "Bouton pour effacer la recherche de collection",
    },
    {
      id: "feature-owl",
      label: "Lien direct vers la page Wikipédia d'une carte tirée",
    },
    {
      id: "rule-29",
      label:
        "Recharger automatiquement la page (pile de paquets pleine, enchère introuvable, échec de la collection)",
    },
    {
      id: "rule-30",
      label: "Agrandir et réorganiser la modale d'étiquetage en masse",
    },
    {
      id: "rule-31",
      label: "Filtrer les notifications par type",
    },
    {
      id: "rule-32",
      label: "Lueur rouge quand une enchère se termine dans moins de 10s",
    },
    {
      id: "rule-33",
      label: "Bouton de mise en rouge quand vous êtes en tête",
    },
    {
      id: "rule-34",
      label: "Navigation et recherche au clavier dans la liste des étiquettes",
    },
    {
      id: "rule-35",
      label: "Bouton des plus grosses estimations de votre collection",
    },
    {
      id: "feature-bbs",
      label: "Mémorisation de vos plus grosses ventes et achats",
    },
    {
      id: "rule-36",
      label: "Aller directement à une page de la collection",
    },
    {
      id: "feature-fol",
      label: "Suivre des joueurs (œil rouge sur les pages d'enchère)",
    },
    {
      id: "rule-37",
      label: "Masquer les boutons « favori » de la barre d'actions groupées",
    },
    {
      id: "rule-38",
      label: "Halo rouge sur les cartes sans estimation (collection)",
    },
    {
      id: "feature-uds",
      label: "Description personnelle des joueurs (profil et amis)",
    },
    {
      id: "rule-39",
      label: "Barres de progression des succès en bas à droite",
    },
    {
      id: "feature-mpa",
      label: "Flèches de prix sur les cartes connues de /marketplace",
    },
    {
      id: "feature-tbd",
      label:
        "Étiqueter les cartes pendant l'estimation en masse (« TBD » sans estimation, plages de valeur)",
      defaultDisabled: true,
    },
    {
      id: "feature-dad",
      label: "Choisir la durée d'enchère par défaut à l'ouverture de la vente",
    },
    {
      id: "feature-wat",
      label: "Surveiller des enchères et les retrouver depuis /marketplace",
    },
    {
      id: "rule-40",
      label:
        "Interrupteur pour estomper les cartes à flèche ▲ (marché, Parcourir)",
    },
    {
      id: "rule-41",
      label: "Mémoriser les noms de vos étiquettes (liste des étiquettes)",
    },
    {
      id: "rule-42",
      label:
        "Retour arrière sur un champ d'étiquette vide : sélectionner les étiquettes de la carte",
    },
    {
      id: "rule-43",
      label:
        "Interrupteur pour cacher les cartes hors de votre liste de souhaits (marché, Parcourir) et bouton « Feuilleter (WMB) » pour la mémoriser",
    },
    {
      id: "rule-44",
      label:
        "Total des estimations des cartes reçues dans le détail d'un échange (/trades)",
    },
    {
      id: "rule-45",
      label: "Réduire la marge sous le bloc du haut de la barre de navigation",
    },
  ];

  function readFeatureFlags() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(FEATURE_FLAGS_KEY) ?? "{}");
    } catch (error) {
      logger(CPL.WARN, "Feature flags unreadable, defaults restored", error);
      stored = {};
    }

    const flags = {};
    FEATURE_REGISTRY.forEach(({ id, defaultDisabled }) => {
      flags[id] = stored[id] ?? !defaultDisabled;
    });
    return flags;
  }

  function writeFeatureFlags(flags) {
    localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(flags));
    logger(CPL.INFO, "Feature flags saved", flags);
  }

  // ============================================================
  // Feature CFG: the settings modal's "Config" tab holds business values (as opposed to the "Fonctionnalités" tab's
  // on/off switches), each chosen with a horizontal pill selector. They are kept together in localStorage under
  // "wm-config" (a JSON object, id -> chosen option) and saved as soon as one is picked — no reload needed, since
  // whatever reads them does so when it acts. A stored value that is no longer one of the entry's options falls back
  // to its default. The entries are laid out in a 2-column grid (1 column on narrow screens). The first entry is Feature DAD's default auction duration; the second is the age after which
  // Feature WAT's watched auctions are removed automatically; the third is the size of the "Top" lists (Rule 35, Feature BBS); the fourth is the estimate under which a card shows "💩" (Feature ETS); the fifth is how many sale prices Feature BSP keeps per card; the sixth is how many of the cheapest of them average into the reference price (never more than the fifth); the seventh is the pack pile size from which Feature PNP notifies (50, 70, 90 by default, 100 %); the eighth is the time left (5, 10, 15 by default, 30 s) from which Rule 32's countdown glows red; the ninth is the number of attempts per card (1, 3 by default, 5) before Feature EBC skips a card that gets no estimate; the tenth is how long Feature EBC waits for a card's estimate, on the first attempt / on the retries (4 s / 10 s, 8 s / 20 s by default, 15 s / 40 s); the eleventh is the marketplace tab Rule 9 opens on arrival (Parcourir, Mes enchères by default, Historique, Gagnées, Aucun).
  // ============================================================
  const CONFIG_KEY = "wm-config";

  const AUCTION_DURATION_CONFIG_ID = "auction-duration";
  const WATCHED_MAX_AGE_CONFIG_ID = "watched-max-age";
  const TOP_LIMIT_CONFIG_ID = "top-limit";
  // The largest size the "Top" setting offers. The Top lists are always stored/buffered at that size, whatever the
  // configured one: the setting only decides how many of them are shown, so raising it again never loses entries
  const TOP_LIMIT_MAX = 100;
  const WORTHLESS_THRESHOLD_CONFIG_ID = "worthless-threshold";
  const MAX_STORED_PRICES_CONFIG_ID = "max-stored-prices";
  const REFERENCE_PRICES_COUNT_CONFIG_ID = "reference-prices-count";
  const PILE_NOTIFICATION_THRESHOLD_CONFIG_ID = "pile-notification-threshold";
  const BID_TIMER_URGENT_THRESHOLD_CONFIG_ID = "bid-timer-urgent-threshold";
  const EVAL_MAX_ATTEMPTS_CONFIG_ID = "eval-max-attempts";
  const EVAL_TIMEOUTS_CONFIG_ID = "eval-timeouts";
  const DEFAULT_MARKETPLACE_TAB_CONFIG_ID = "default-marketplace-tab";
  // The marketplace tabs the script knows the site uses (Rule 9, Feature MPA, Feature BBS)
  const DEFAULT_MARKETPLACE_TAB_LABELS = [
    "Parcourir",
    "Mes ventes",
    "Mes enchères",
    "Gagnées",
    "Historique",
  ];

  const DAY_MS = 24 * 60 * 60 * 1000;
  const WATCHED_MAX_AGE_OPTIONS_MS = {
    "1 jour": DAY_MS,
    "3 jours": 3 * DAY_MS,
    "7 jours": 7 * DAY_MS,
    "30 jours": 30 * DAY_MS,
    "1 an": 365 * DAY_MS,
  };

  // Feature CFG (cont'd): the entries are bundled in titled groups, in CONFIG_GROUPS' order (an entry's `group` is one of
  // its ids). An entry is { id, group, label, options (the labels the pills show, which is also what gets stored),
  // defaultValue (one of the labels), values? (label -> the value the script actually uses, when that isn't the
  // label itself), hint? (a small line under the label) }. An entry with `type: "text"` is a free text field instead
  // (no options; `placeholder?`; trimmed, at most CONFIG_TEXT_MAX_LENGTH characters, saved shortly after typing;
  // `readOnly: true` shows it without letting it be typed in, for a value only the script fills in). An entry with
  // `type: "ranges"` is an editable list of { min, max, tag, enabled } value ranges (a null bound is no bound; each has
  // a switch, an off range being kept but not applied; at most CONFIG_RANGES_MAX; saved shortly after an edit;
  // getConfigValue returns the array). An entry with
  // `type: "select"` is a drop-down of free values: `choices()` gives the current candidates (read when the panel is
  // built), the stored value is kept even when it isn't one of them, and `defaultValue` is always offered. An entry with
  // `type: "range"` is a slider (`min`, `max`, `step`; stored as the number's string, clamped and snapped to the
  // step when read; getConfigValue returns the number). Code reads a setting with getConfigValue(id), at the time
  // it acts, never by copying it into a constant at load: that is what makes a change apply without a reload.
  const CONFIG_GROUPS = [
    { id: "account", title: "Compte" },
    { id: "auctions", title: "Enchères & marché" },
    { id: "prices", title: "Prix de vente observés" },
    { id: "estimates", title: "Estimations & classements" },
    { id: "bulk-eval", title: "Estimation en masse" },
    { id: "alerts", title: "Notifications & alertes" },
  ];

  const MY_USERNAME_CONFIG_ID = "my-username";
  const TBD_TAG_CONFIG_ID = "tbd-tag";
  const TBD_TAG_DEFAULT = "TBD";
  const VALUE_RANGES_CONFIG_ID = "tbd-value-ranges";
  const CONFIG_RANGES_MAX = 30;
  const CONFIG_TEXT_MAX_LENGTH = 64;

  const CONFIG_REGISTRY = [
    {
      id: MY_USERNAME_CONFIG_ID,
      group: "account",
      type: "text",
      label: "Votre pseudo WikiMasters",
      readOnly: true,
      placeholder: "Rempli en ouvrant votre profil",
      defaultValue: "",
      hint: "Sert à reconnaître vos ventes et vos enchères. Détecté automatiquement dès que vous ouvrez votre profil (/profile).",
    },
    {
      id: AUCTION_DURATION_CONFIG_ID,
      group: "auctions",
      label: "Durée par défaut d'enchère",
      hint: "Durée sélectionnée automatiquement quand vous ouvrez la fenêtre de mise en vente d'une carte.",
      options: ["10 min", "30 min", "1 h", "3 h", "6 h", "12 h"],
      defaultValue: "1 h",
    },
    {
      id: WATCHED_MAX_AGE_CONFIG_ID,
      group: "auctions",
      label: "Suppression automatique des enchères surveillées",
      hint: "Délai après la fin d'une enchère surveillée au bout duquel elle est retirée de la liste, quand vous ouvrez votre profil.",
      options: Object.keys(WATCHED_MAX_AGE_OPTIONS_MS),
      defaultValue: "7 jours",
    },
    {
      id: DEFAULT_MARKETPLACE_TAB_CONFIG_ID,
      group: "auctions",
      label: "Onglet du marché ouvert par défaut",
      options: [...DEFAULT_MARKETPLACE_TAB_LABELS, "Aucun"],
      defaultValue: "Mes enchères",
      // "Aucun": no tab is clicked, the site's own default stays
      values: {
        Parcourir: "Parcourir",
        "Mes enchères": "Mes enchères",
        Historique: "Historique",
        Gagnées: "Gagnées",
        Aucun: null,
      },
      hint: "Onglet sélectionné automatiquement à l'arrivée sur /marketplace",
    },
    {
      id: TOP_LIMIT_CONFIG_ID,
      group: "estimates",
      label: "Taille des classements « Top »",
      hint: "Nombre d'entrées affichées dans les classements « Top » (estimations, plus grosses ventes et achats). Les 100 meilleures sont toujours gardées en mémoire, quel que soit ce réglage.",
      options: ["10", "20", "40", "60", String(TOP_LIMIT_MAX)],
      defaultValue: "40",
      values: {
        10: 10,
        20: 20,
        40: 40,
        60: 60,
        [TOP_LIMIT_MAX]: TOP_LIMIT_MAX,
      },
    },
    {
      id: WORTHLESS_THRESHOLD_CONFIG_ID,
      group: "estimates",
      label: "Seuil « sans valeur » des estimations",
      type: "range",
      min: 1,
      max: 100,
      step: 1,
      defaultValue: "10",
      hint: "En dessous de cette estimation, la carte affiche '💩'",
    },
    {
      id: MAX_STORED_PRICES_CONFIG_ID,
      group: "prices",
      label: "Prix de vente gardés par carte",
      options: ["5", "7", "10", "15"],
      defaultValue: "7",
      values: { 5: 5, 7: 7, 10: 10, 15: 15 },
      hint: "Nombre maximal de prix de vente enregistrés pour une même carte",
    },
    {
      id: REFERENCE_PRICES_COUNT_CONFIG_ID,
      group: "prices",
      label: "Prix retenus pour la moyenne de référence",
      options: ["3", "5", "7"],
      defaultValue: "5",
      values: { 3: 3, 5: 5, 7: 7 },
      hint: "Nombre de prix les moins chers utilisés pour calculer la moyenne de référence",
    },
    {
      id: PILE_NOTIFICATION_THRESHOLD_CONFIG_ID,
      group: "alerts",
      label: "Seuil d'alerte de la pile de paquets",
      options: ["50 %", "70 %", "90 %", "100 %"],
      defaultValue: "90 %",
      // The proportion of the max pile size from which notifications start, minus 1 point of floating point uncertainty
      values: {
        "50 %": 0.5 - 0.01,
        "70 %": 0.7 - 0.01,
        "90 %": 0.9 - 0.01,
        "100 %": 1 - 0.01,
      },
      hint: "Part de la pile à partir de laquelle la notification de paquets est envoyée",
    },
    {
      id: BID_TIMER_URGENT_THRESHOLD_CONFIG_ID,
      group: "alerts",
      label: "Seuil de la lueur rouge de fin d'enchère",
      options: ["5 s", "10 s", "15 s", "30 s"],
      defaultValue: "15 s",
      values: { "5 s": 5, "10 s": 10, "15 s": 15, "30 s": 30 },
      hint: "En dessous de ce temps restant, le décompte « Se termine dans... » luit en rouge",
    },
    {
      id: TBD_TAG_CONFIG_ID,
      group: "bulk-eval",
      type: "select",
      label: "Étiquette « TBD »",
      defaultValue: TBD_TAG_DEFAULT,
      choices: () => readKnownTagNames(),
      hint: "Étiquette posée sur les cartes sans estimation (fonctionnalité TBD). La liste vient de vos étiquettes, mémorisées quand vous ouvrez la liste des étiquettes de votre collection.",
    },
    {
      id: EVAL_MAX_ATTEMPTS_CONFIG_ID,
      group: "bulk-eval",
      label: "Essais par carte (estimation en masse)",
      options: ["1", "3", "5"],
      defaultValue: "3",
      values: { 1: 1, 3: 3, 5: 5 },
      hint: "Nombre d'essais avant de passer une carte qui n'obtient pas d'estimation",
    },
    {
      id: VALUE_RANGES_CONFIG_ID,
      group: "bulk-eval",
      type: "ranges",
      label: "Étiquettes automatiques selon l'estimation",
      defaultValue: [],
      hint: "Pendant l'estimation en masse (fonctionnalité TBD), une carte reçoit l'étiquette de chaque plage qui contient son estimation (min ≤ valeur ≤ max ; une borne vide n'en est pas une). Les plages peuvent se chevaucher et partager une étiquette.",
    },
    {
      id: EVAL_TIMEOUTS_CONFIG_ID,
      group: "bulk-eval",
      label: "Délais d'attente de l'estimation",
      options: [
        "Rapide (4 s / 10 s)",
        "Standard (8 s / 20 s)",
        "Patient (15 s / 40 s)",
      ],
      defaultValue: "Standard (8 s / 20 s)",
      values: {
        "Rapide (4 s / 10 s)": { first: 4000, retry: 10000 },
        "Standard (8 s / 20 s)": { first: 8000, retry: 20000 },
        "Patient (15 s / 40 s)": { first: 15000, retry: 40000 },
      },
      hint: "Temps d'attente de l'estimation d'une carte : premier essai / essais suivants",
    },
  ];

  // Parsed once and kept (settings are read from hot paths: every card of a page, every DOM pass); writeConfigValue
  // refreshes it
  let configCache = null;

  function readConfig() {
    if (configCache) return configCache;

    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}");
    } catch (error) {
      logger(CPL.WARN, "Config unreadable, defaults restored", error);
    }

    const config = {};
    CONFIG_REGISTRY.forEach(({ id, type, options, defaultValue }) => {
      const value = stored?.[id];
      if (type === "text") {
        config[id] =
          typeof value === "string"
            ? value.trim().slice(0, CONFIG_TEXT_MAX_LENGTH)
            : defaultValue;
      } else if (type === "ranges") {
        config[id] = normalizeValueRanges(value);
      } else if (type === "select") {
        config[id] =
          typeof value === "string" && value.trim() !== ""
            ? value.trim().slice(0, CONFIG_TEXT_MAX_LENGTH)
            : defaultValue;
      } else if (type === "range") {
        const entry = CONFIG_REGISTRY.find((candidate) => candidate.id === id);
        const number = parseFloat(value);
        config[id] = Number.isFinite(number)
          ? String(snapConfigRange(entry, number))
          : defaultValue;
      } else {
        config[id] = options.includes(value) ? value : defaultValue;
      }
    });
    configCache = config;
    return config;
  }

  // A stored list of value ranges made safe to use: bounds are finite numbers or null, tags are trimmed text
  function normalizeValueRanges(value) {
    if (!Array.isArray(value)) return [];

    const bound = (number) =>
      typeof number === "number" && Number.isFinite(number) ? number : null;
    return value
      .filter((range) => range && typeof range === "object")
      .slice(0, CONFIG_RANGES_MAX)
      .map((range) => ({
        min: bound(range.min),
        max: bound(range.max),
        tag:
          typeof range.tag === "string"
            ? range.tag.trim().slice(0, CONFIG_TEXT_MAX_LENGTH)
            : "",
        // Switched on unless saved as off (ranges saved before the switch existed have none)
        enabled: range.enabled !== false,
      }));
  }

  // A slider's value brought into its entry's min/max and onto its step
  function snapConfigRange({ min, max, step }, number) {
    const snapped = min + Math.round((number - min) / step) * step;
    return Math.min(max, Math.max(min, snapped));
  }

  // The value the script uses for a setting: the entry's `values` mapping of the chosen label, or the label itself
  // (a number for a slider)
  function getConfigValue(id) {
    const entry = CONFIG_REGISTRY.find((candidate) => candidate.id === id);
    const label = readConfig()[id];
    if (entry?.type === "range") return Number(label);
    return entry?.values && label in entry.values ? entry.values[label] : label;
  }

  // The player's own pseudo (the "Votre pseudo WikiMasters" setting), "" while unknown. Nothing matches an unknown
  // pseudo: compare through isMyUsername(), never with === on the getter, or an empty name would match an empty text.
  function getMyUsername() {
    return getConfigValue(MY_USERNAME_CONFIG_ID);
  }

  function isMyUsername(name) {
    const me = getMyUsername();
    return me !== "" && name === me;
  }

  function writeConfigValue(id, value) {
    const config = { ...readConfig(), [id]: value };
    configCache = config;
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      const shown = typeof value === "string" ? value : JSON.stringify(value);
      logger(CPL.INFO, `Config saved: ${id} = ${shown}`);
    } catch (error) {
      logger(CPL.ERROR, `Config not saved: ${id}`, error);
    }
  }

  function buildConfigPanel() {
    const panel = document.createElement("div");
    panel.className = "wm-settings-config";

    const config = readConfig();
    CONFIG_GROUPS.forEach((group) => {
      const entries = CONFIG_REGISTRY.filter(
        (entry) => entry.group === group.id,
      );
      if (entries.length === 0) return;

      const groupTitle = document.createElement("h3");
      groupTitle.className = "wm-config-group-title";
      groupTitle.textContent = group.title;
      panel.appendChild(groupTitle);

      entries.forEach((entry) =>
        panel.appendChild(buildConfigRow(entry, config)),
      );
    });

    return panel;
  }

  // A styled options list (what a native <select> / <datalist> can't be: their options are drawn by the browser) shown
  // under `anchor`: a fixed-position panel, put inside the settings overlay so it stacks above the modal and a click on
  // it doesn't count as a click on the overlay. `values` are the strings offered, `selected` the current one (marked,
  // and focused first when `focusSelected`), `onPick(value)` runs on a choice. It closes on a pick, Escape (without
  // closing the settings modal), a click elsewhere or a scroll outside it. Options keep the anchor's focus on
  // mousedown, so it can be a text field being typed in. Returns { close, firstOption }.
  function openConfigOptions({
    anchor,
    values,
    selected,
    onPick,
    focusSelected = true,
  }) {
    const host = anchor.closest(".wm-settings-overlay") ?? document.body;
    const list = document.createElement("div");
    list.className = "wm-dd-list";
    list.setAttribute("role", "listbox");

    const optionEls = values.map((value) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "wm-dd-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(value === selected));
      option.classList.toggle("wm-dd-option-selected", value === selected);

      const text = document.createElement("span");
      text.className = "wm-dd-option-text";
      text.textContent = value;
      const check = document.createElement("span");
      check.className = "wm-dd-option-check";
      check.textContent = value === selected ? "✓" : "";
      option.append(text, check);

      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => {
        close();
        onPick(value);
      });
      list.appendChild(option);
      return option;
    });

    const onOutside = (event) => {
      if (!list.contains(event.target) && !anchor.contains(event.target))
        close();
    };
    const onScroll = (event) => {
      if (!list.contains(event.target)) close();
    };
    function close() {
      if (!list.isConnected) return;
      list.remove();
      document.removeEventListener("mousedown", onOutside, true);
      window.removeEventListener("scroll", onScroll, true);
      anchor.setAttribute("aria-expanded", "false");
    }

    list.addEventListener("keydown", (event) => {
      const index = optionEls.indexOf(document.activeElement);
      const move = (next) => {
        event.preventDefault();
        optionEls[(next + optionEls.length) % optionEls.length]?.focus();
      };
      if (event.key === "ArrowDown") move(index + 1);
      else if (event.key === "ArrowUp") move(index === -1 ? -1 : index - 1);
      else if (event.key === "Home") move(0);
      else if (event.key === "End") move(optionEls.length - 1);
      else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        anchor.focus();
      }
    });

    host.appendChild(list);
    anchor.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", onOutside, true);
    window.addEventListener("scroll", onScroll, true);

    const rect = anchor.getBoundingClientRect();
    list.style.minWidth = `${rect.width}px`;
    const below = window.innerHeight - rect.bottom - 8;
    const top =
      list.offsetHeight > below && rect.top > below
        ? Math.max(8, rect.top - list.offsetHeight - 4)
        : rect.bottom + 4;
    list.style.top = `${top}px`;
    list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - list.offsetWidth - 8))}px`;

    const target = focusSelected
      ? (optionEls.find((option, i) => values[i] === selected) ?? optionEls[0])
      : null;
    target?.focus();
    target?.scrollIntoView?.({ block: "nearest" });

    return { close, firstOption: optionEls[0] ?? null };
  }

  // A circled "i" next to a setting's name, whose hint shows in a tooltip while it is hovered or focused (and toggles on
  // a click, for touch screens). The tip is a fixed-position panel put inside the settings overlay, so the panel's
  // scrolling can't clip it; Escape hides it without closing the settings modal.
  function buildConfigInfo(hint) {
    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "wm-config-info";
    icon.textContent = "i";
    icon.setAttribute("aria-label", hint);

    let tip = null;
    const hide = () => {
      tip?.remove();
      tip = null;
    };
    const show = () => {
      if (tip) return;
      tip = document.createElement("div");
      tip.className = "wm-config-tip";
      tip.setAttribute("role", "tooltip");
      tip.textContent = hint;
      (icon.closest(".wm-settings-overlay") ?? document.body).appendChild(tip);

      const rect = icon.getBoundingClientRect();
      const above = rect.top > tip.offsetHeight + 12;
      tip.style.top = `${above ? rect.top - tip.offsetHeight - 6 : rect.bottom + 6}px`;
      tip.style.left = `${Math.max(8, Math.min(rect.left - 8, window.innerWidth - tip.offsetWidth - 8))}px`;
    };

    icon.addEventListener("mouseenter", show);
    icon.addEventListener("mouseleave", hide);
    icon.addEventListener("focus", show);
    icon.addEventListener("blur", hide);
    icon.addEventListener("click", () => (tip ? hide() : show()));
    icon.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !tip) return;
      event.stopPropagation();
      hide();
    });
    return icon;
  }

  function buildConfigRow(
    {
      id,
      type,
      label,
      options,
      hint,
      placeholder,
      readOnly,
      min,
      max,
      step,
      choices,
      defaultValue,
    },
    config,
  ) {
    const row = document.createElement("div");
    row.className = "wm-config-row";

    const rowLabel = document.createElement("p");
    rowLabel.className = "wm-config-label";
    rowLabel.textContent = label;
    if (hint) rowLabel.append(buildConfigInfo(hint));

    if (type === "ranges") {
      const ranges = normalizeValueRanges(config[id]);
      const list = document.createElement("div");
      list.className = "wm-config-ranges";

      // Tag suggestions: the names Rule 41 remembered (any other name can be typed: it will be created)
      const knownTags = readKnownTagNames().sort((a, b) => a.localeCompare(b));

      let saveTimerId = null;
      const save = () => {
        clearTimeout(saveTimerId);
        writeConfigValue(id, normalizeValueRanges(ranges));
      };
      const saveSoon = () => {
        clearTimeout(saveTimerId);
        saveTimerId = setTimeout(save, 400);
      };

      const render = () => {
        list.replaceChildren();
        ranges.forEach((range, index) => {
          const line = document.createElement("div");
          line.className = "wm-config-range-row";

          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "wm-config-range-switch";
          toggle.setAttribute("role", "switch");
          toggle.title = "Activer / désactiver cette plage";
          toggle.setAttribute("aria-label", "Activer cette plage");
          const syncToggle = () => {
            toggle.setAttribute("aria-checked", String(range.enabled));
            toggle.setAttribute("aria-pressed", String(range.enabled));
            line.classList.toggle("wm-config-range-row-off", !range.enabled);
          };
          toggle.addEventListener("click", () => {
            range.enabled = !range.enabled;
            syncToggle();
            save();
            logger(
              CPL.LOG,
              `Value range ${range.enabled ? "enabled" : "disabled"}: ${range.min ?? "-"} to ${range.max ?? "-"} -> "${range.tag}"`,
            );
          });
          syncToggle();

          const numberInput = (key, symbol, hintText) => {
            const wrap = document.createElement("label");
            wrap.className = "wm-config-range-bound";
            wrap.title = hintText;
            const sign = document.createElement("span");
            sign.textContent = symbol;
            const input = document.createElement("input");
            input.type = "number";
            input.step = "any";
            input.placeholder = "ø";
            input.value = range[key] === null ? "" : String(range[key]);
            input.setAttribute("aria-label", hintText);
            input.addEventListener("input", () => {
              const number = parseFloat(input.value);
              range[key] = Number.isFinite(number) ? number : null;
              line.classList.toggle(
                "wm-config-range-row-invalid",
                range.min !== null &&
                  range.max !== null &&
                  range.min > range.max,
              );
              saveSoon();
            });
            wrap.append(sign, input);
            return wrap;
          };

          const tagInput = document.createElement("input");
          tagInput.type = "text";
          tagInput.className = "wm-config-range-tag";
          tagInput.maxLength = CONFIG_TEXT_MAX_LENGTH;
          tagInput.placeholder = "Étiquette";
          tagInput.setAttribute("aria-label", "Étiquette de la plage");
          tagInput.setAttribute("aria-haspopup", "listbox");
          tagInput.setAttribute("aria-expanded", "false");
          tagInput.autocomplete = "off";
          tagInput.value = range.tag;

          // The suggestions (names containing what is typed) follow the typing, without taking the focus
          let suggestions = null;
          const showSuggestions = () => {
            suggestions?.close();
            const typed = tagInput.value.trim().toLowerCase();
            const matching = knownTags.filter(
              (name) =>
                name.toLowerCase().includes(typed) &&
                name.toLowerCase() !== typed,
            );
            suggestions =
              matching.length === 0
                ? null
                : openConfigOptions({
                    anchor: tagInput,
                    values: matching,
                    selected: null,
                    focusSelected: false,
                    onPick: (name) => {
                      tagInput.value = name;
                      range.tag = name;
                      save();
                      tagInput.focus();
                    },
                  });
          };
          tagInput.addEventListener("focus", showSuggestions);
          tagInput.addEventListener("input", () => {
            range.tag = tagInput.value.trim();
            saveSoon();
            showSuggestions();
          });
          tagInput.addEventListener("change", save);
          tagInput.addEventListener("keydown", (event) => {
            if (event.key === "ArrowDown" && suggestions?.firstOption) {
              event.preventDefault();
              suggestions.firstOption.focus();
            } else if (event.key === "Escape" && suggestions) {
              event.stopPropagation();
              suggestions.close();
              suggestions = null;
            }
          });

          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "wm-config-text-clear";
          removeBtn.textContent = "✕";
          removeBtn.title = "Supprimer cette plage";
          removeBtn.setAttribute("aria-label", "Supprimer cette plage");
          removeBtn.addEventListener("click", () => {
            ranges.splice(index, 1);
            save();
            render();
          });

          line.classList.toggle(
            "wm-config-range-row-invalid",
            range.min !== null && range.max !== null && range.min > range.max,
          );
          line.append(
            toggle,
            numberInput("min", "≥", "Borne basse (incluse) : valeur ≥"),
            numberInput("max", "≤", "Borne haute (incluse) : valeur ≤"),
            tagInput,
            removeBtn,
          );
          list.appendChild(line);
        });
        addBtn.disabled = ranges.length >= CONFIG_RANGES_MAX;
      };

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "wm-config-ranges-add";
      addBtn.textContent = "+ Ajouter une plage";
      addBtn.addEventListener("click", () => {
        ranges.push({ min: null, max: null, tag: "", enabled: true });
        save();
        render();
        list.lastElementChild?.querySelector("input")?.focus();
      });

      render();
      row.append(rowLabel, list, addBtn);
      return row;
    }

    if (type === "select") {
      // The default, the names the script knows, and the current value even if it is neither (kept, never lost)
      const values = [
        defaultValue,
        ...[...choices()].sort((a, b) => a.localeCompare(b)),
      ];
      if (!values.includes(config[id])) values.push(config[id]);
      const offered = [...new Set(values)];

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "wm-dd-trigger";
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-label", label);

      const triggerText = document.createElement("span");
      triggerText.className = "wm-dd-trigger-text";
      triggerText.textContent = config[id];
      const chevron = document.createElement("span");
      chevron.className = "wm-dd-chevron";
      chevron.textContent = "▾";
      trigger.append(triggerText, chevron);

      let popover = null;
      const open = () => {
        popover = openConfigOptions({
          anchor: trigger,
          values: offered,
          selected: readConfig()[id],
          onPick: (value) => {
            triggerText.textContent = value;
            if (value !== readConfig()[id]) writeConfigValue(id, value);
            trigger.focus();
          },
        });
      };
      trigger.addEventListener("click", () => {
        if (trigger.getAttribute("aria-expanded") === "true") popover?.close();
        else open();
      });
      trigger.addEventListener("keydown", (event) => {
        if (
          event.key !== "ArrowDown" ||
          trigger.getAttribute("aria-expanded") === "true"
        )
          return;
        event.preventDefault();
        open();
      });

      row.append(rowLabel, trigger);
      return row;
    }

    if (type === "range") {
      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "wm-config-range";
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(step);
      slider.value = config[id];
      slider.setAttribute("aria-label", label);

      const output = document.createElement("output");
      output.className = "wm-config-range-value";
      output.textContent = slider.value;

      // The figure follows the thumb while it moves; the value is saved once it is let go (or a key step is made)
      slider.addEventListener("input", () => {
        output.textContent = slider.value;
      });
      slider.addEventListener("change", () => {
        output.textContent = slider.value;
        if (slider.value !== readConfig()[id])
          writeConfigValue(id, slider.value);
      });

      const field = document.createElement("div");
      field.className = "wm-config-range-field";
      field.append(slider, output);
      row.append(rowLabel, field);
      return row;
    }

    if (type === "text") {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "wm-config-text";
      input.maxLength = CONFIG_TEXT_MAX_LENGTH;
      input.value = config[id];
      input.placeholder = placeholder ?? "";
      input.setAttribute("aria-label", label);
      input.autocomplete = "off";
      input.spellcheck = false;
      if (readOnly) {
        input.readOnly = true;
        input.classList.add("wm-config-text-readonly");

        // A cross empties the value (it can't be typed over), to be detected again by the script
        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "wm-config-text-clear";
        clearBtn.textContent = "✕";
        clearBtn.setAttribute("aria-label", `Réinitialiser : ${label}`);
        clearBtn.title =
          "Réinitialiser (la valeur sera de nouveau détectée par le script)";
        const syncClearBtn = () => {
          clearBtn.disabled = input.value === "";
        };
        clearBtn.addEventListener("click", () => {
          writeConfigValue(id, "");
          input.value = "";
          syncClearBtn();
          logger(CPL.INFO, `Config reset: ${id}`);
        });
        syncClearBtn();

        const field = document.createElement("div");
        field.className = "wm-config-text-field";
        field.append(input, clearBtn);
        row.append(rowLabel, field);
        return row;
      }

      // Saved as it is typed (once typing pauses), and at once when leaving the field
      let debounceId = null;
      const save = () => {
        clearTimeout(debounceId);
        const value = input.value.trim();
        if (value !== readConfig()[id]) writeConfigValue(id, value);
      };
      input.addEventListener("input", () => {
        clearTimeout(debounceId);
        debounceId = setTimeout(save, 500);
      });
      input.addEventListener("change", save);

      row.append(rowLabel, input);
      return row;
    }

    const pill = document.createElement("div");
    pill.className = "wm-config-pill";
    pill.setAttribute("role", "radiogroup");
    pill.setAttribute("aria-label", label);

    const buttons = options.map((option) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wm-config-pill-btn";
      btn.setAttribute("role", "radio");
      btn.textContent = option;
      btn.addEventListener("click", () => {
        writeConfigValue(id, option);
        sync(option);
      });
      return btn;
    });
    const sync = (value) =>
      buttons.forEach((btn) => {
        const selected = btn.textContent === value;
        btn.setAttribute("aria-checked", String(selected));
        btn.classList.toggle("wm-config-pill-btn-selected", selected);
      });
    sync(config[id]);

    pill.append(...buttons);
    row.append(rowLabel, pill);
    return row;
  }

  // Runs `apply` (which swaps the modal's content) and eases the modal from its previous width/height to the new
  // natural ones instead of letting it jump. Skipped when the user prefers reduced motion or the size is unchanged.
  const MODAL_RESIZE_MS = 250;

  function animateModalResize(modal, apply) {
    const from = modal.getBoundingClientRect();
    modal.style.transition = "none";
    modal.style.width = "";
    modal.style.height = "";
    apply();
    const to = modal.getBoundingClientRect();

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (
      reduced ||
      (Math.abs(from.width - to.width) < 1 &&
        Math.abs(from.height - to.height) < 1)
    ) {
      modal.style.transition = "";
      return;
    }

    modal.style.boxSizing = "border-box";
    modal.style.overflow = "hidden";
    modal.style.width = `${from.width}px`;
    modal.style.height = `${from.height}px`;
    void modal.offsetWidth;
    modal.style.transition = `width ${MODAL_RESIZE_MS}ms ease, height ${MODAL_RESIZE_MS}ms ease`;
    modal.style.width = `${to.width}px`;
    modal.style.height = `${to.height}px`;

    setTimeout(() => {
      ["transition", "width", "height", "boxSizing", "overflow"].forEach(
        (prop) => (modal.style[prop] = ""),
      );
    }, MODAL_RESIZE_MS + 30);
    logger(
      CPL.LOG,
      `Settings modal resized ${Math.round(from.width)}x${Math.round(from.height)} -> ${Math.round(to.width)}x${Math.round(to.height)}`,
    );
  }

  function buildFeatureConfigModal(flags) {
    const overlay = document.createElement("div");
    overlay.className = "wm-settings-overlay";

    const modal = document.createElement("div");
    modal.className = "wm-settings-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Configuration de Wiki-MasterBetter");

    const header = document.createElement("div");
    header.className = "wm-settings-header";

    const title = document.createElement("h2");
    title.className = "wm-settings-title";
    title.textContent = "⚙️ Réglages";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "wm-settings-close";
    closeBtn.setAttribute("aria-label", "Fermer");
    closeBtn.textContent = "✕";

    header.append(title, closeBtn);

    const hintRow = document.createElement("div");
    hintRow.className = "wm-settings-hint-row";

    const hint = document.createElement("p");
    hint.className = "wm-settings-hint";
    hint.textContent = "Rechargez la page pour appliquer vos changements.";

    const selectAllBtn = document.createElement("button");
    selectAllBtn.type = "button";
    selectAllBtn.className = "wm-settings-select-all";

    hintRow.append(hint, selectAllBtn);

    const list = document.createElement("div");
    list.className = "wm-settings-list";

    const checkboxes = [];

    const updateSelectAllLabel = () => {
      const allChecked = checkboxes.every((checkbox) => checkbox.checked);
      selectAllBtn.textContent = allChecked
        ? "Tout désélectionner"
        : "Tout sélectionner";
    };

    selectAllBtn.addEventListener("click", () => {
      const next = !checkboxes.every((checkbox) => checkbox.checked);
      checkboxes.forEach((checkbox) => {
        checkbox.checked = next;
        flags[checkbox.dataset.wmFeatureId] = next;
      });
      writeFeatureFlags(flags);
      updateSelectAllLabel();
    });

    FEATURE_REGISTRY.forEach(({ id, label }) => {
      const item = document.createElement("label");
      item.className = "wm-settings-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = flags[id];
      checkbox.dataset.wmFeatureId = id;
      checkbox.addEventListener("change", () => {
        flags[id] = checkbox.checked;
        writeFeatureFlags(flags);
        updateSelectAllLabel();
      });
      checkboxes.push(checkbox);

      const idTitle = document.createElement("h3");
      idTitle.className = "wm-settings-item-title";
      idTitle.textContent = id;

      const idRow = document.createElement("div");
      idRow.className = "wm-settings-item-id-row";
      idRow.append(checkbox, idTitle);

      const text = document.createElement("p");
      text.className = "wm-settings-item-label";
      text.textContent = label;

      item.append(idRow, text);
      list.appendChild(item);
    });

    updateSelectAllLabel();

    const footer = document.createElement("div");
    footer.className = "wm-settings-footer";

    const reloadBtn = document.createElement("button");
    reloadBtn.type = "button";
    reloadBtn.className = "wm-settings-reload";
    reloadBtn.textContent = "Recharger la page";
    reloadBtn.addEventListener("click", () => {
      logger(CPL.INFO, "Manual reload from the settings modal");
      window.location.reload();
    });

    footer.appendChild(reloadBtn);

    const featuresPanel = document.createElement("div");
    featuresPanel.className = "wm-settings-panel";
    featuresPanel.append(hintRow, list, footer);

    featuresPanel.hidden = true;

    const configPanel = document.createElement("div");
    configPanel.className = "wm-settings-panel";
    configPanel.appendChild(buildConfigPanel());

    const tabs = document.createElement("div");
    tabs.className = "wm-settings-tabs";
    tabs.setAttribute("role", "tablist");
    [
      { name: "Configuration", panel: configPanel },
      { name: "Fonctionnalités", panel: featuresPanel },
    ].forEach(({ name, panel }, index, all) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "wm-settings-tab";
      tab.setAttribute("role", "tab");
      tab.textContent = name;
      tab.addEventListener("click", () => {
        if (tab.getAttribute("aria-selected") === "true") return;
        animateModalResize(modal, () => {
          all.forEach((other) => {
            other.panel.hidden = other.panel !== panel;
          });
        });
        tabs.querySelectorAll(".wm-settings-tab").forEach((btn) => {
          const selected = btn === tab;
          btn.setAttribute("aria-selected", String(selected));
          btn.classList.toggle("wm-settings-tab-selected", selected);
        });
        logger(CPL.LOG, `Settings tab: ${name}`);
      });
      tab.setAttribute("aria-selected", String(index === 0));
      tab.classList.toggle("wm-settings-tab-selected", index === 0);
      tabs.appendChild(tab);
    });

    modal.append(header, tabs, configPanel, featuresPanel);
    overlay.appendChild(modal);

    const onKeydown = (event) => {
      if (event.key === "Escape") close();
    };
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKeydown);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", onKeydown);

    return overlay;
  }

  function setupFeatureConfigButton() {
    const nav = document.querySelector("nav h1")?.closest("nav");
    if (!nav) return;

    const row = ensureToggleRow(nav);
    if (row.querySelector(":scope > .wm-settings-toggle")) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "wm-fold-toggle wm-settings-toggle";
    toggle.title = "Configurer les fonctionnalités de Wiki-MasterBetter";
    toggle.setAttribute("aria-haspopup", "dialog");

    const icon = document.createElement("span");
    icon.className = "wm-fold-toggle-icon";
    icon.textContent = "⚙️";
    toggle.appendChild(icon);

    toggle.addEventListener("click", () => {
      if (document.querySelector(".wm-settings-overlay")) return;
      document.body.appendChild(buildFeatureConfigModal(readFeatureFlags()));
    });

    row.insertBefore(toggle, row.firstChild);
  }

  function watchFeatureConfigButton() {
    addStyle(`
      .wm-fold-toggle,
      .wm-settings-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
        padding: 0.75rem;
        border-radius: 0.75rem;
        border: 1px solid var(--color-border);
        background: transparent;
        color: var(--color-foreground);
        opacity: 0.6;
        cursor: pointer;
        font-size: 1.1rem;
        line-height: 1;
        transition: background-color 0.2s ease, opacity 0.2s ease;
      }
      .wm-fold-toggle:hover,
      .wm-settings-toggle:hover {
        opacity: 1;
        background-color: var(--color-surface-light);
      }
      .wm-fold-toggle-icon {
        display: inline-block;
      }
      .wm-toggle-row {
        display: flex;
        flex-direction: row;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }
      .wm-toggle-row > .wm-fold-toggle {
        flex: 1 1 0;
        min-width: 0;
        margin-bottom: 0;
      }
      .wm-settings-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.5);
      }
      .wm-settings-modal {
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        padding: 1rem;
        background-color: var(--color-surface-light);
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        color: var(--color-foreground);
      }
      .wm-settings-panel:not([hidden]) {
        animation: wm-settings-panel-in 0.5s ease;
      }
      @keyframes wm-settings-panel-in {
        from { opacity: 0; transform: translateY(0.4rem); }
        to { opacity: 1; transform: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .wm-settings-panel:not([hidden]) { animation: none; }
      }
      .wm-settings-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .wm-settings-title {
        font-size: 1.1rem;
        font-weight: 600;
        margin: 0;
      }
      .wm-settings-close {
        border: none;
        background: transparent;
        color: var(--color-foreground);
        opacity: 0.6;
        cursor: pointer;
        font-size: 1rem;
        line-height: 1;
        padding: 0.25rem;
      }
      .wm-settings-close:hover {
        opacity: 1;
      }
      .wm-settings-hint-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        margin: 0 0 0.75rem 0;
      }
      .wm-settings-hint {
        white-space: pre-line;
        font-size: 0.85rem;
        opacity: 0.7;
        margin: 0;
      }
      .wm-settings-select-all {
        flex-shrink: 0;
        padding: 0.3rem 0.75rem;
        border-radius: 999px;
        border: 1px solid var(--color-accent);
        background: transparent;
        color: var(--color-accent);
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        cursor: pointer;
        transition: background-color 0.2s ease;
      }
      .wm-settings-select-all:hover {
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
      }
      .wm-settings-list {
        max-height: 60vh;
        max-width: 80vw;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem 0.5rem;
        overflow-y: auto;
        padding-right: 0.25rem;
      }
      .wm-settings-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.4rem;
        text-align: center;
        cursor: pointer;
        padding: 0.5rem;
        border: 1px solid rgba(128, 128, 128, 0.4);
        border-radius: 0.5rem;
      }
      .wm-settings-item-id-row {
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      .wm-settings-item-title {
        margin: 0;
        font-family: monospace;
        font-size: 0.75rem;
        font-weight: 600;
        opacity: 0.6;
      }
      .wm-settings-item-label {
        margin-block: auto;
        font-size: 0.8rem;
      }
      .wm-settings-item input {
        flex-shrink: 0;
        accent-color: var(--color-accent);
      }
      .wm-settings-tabs {
        display: flex;
        gap: 0.25rem;
        margin-bottom: 0.75rem;
        border-bottom: 1px solid rgba(128, 128, 128, 0.4);
      }
      .wm-settings-tab {
        padding: 0.4rem 0.9rem;
        border: none;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: inherit;
        font-size: 0.85rem;
        font-weight: 600;
        opacity: 0.6;
        cursor: pointer;
        transition: opacity 0.2s ease, border-color 0.2s ease;
      }
      .wm-settings-tab:hover {
        opacity: 1;
      }
      .wm-settings-tab-selected {
        opacity: 1;
        border-bottom-color: var(--color-accent);
        color: var(--color-accent);
      }
      .wm-settings-config {
        min-width: 46rem;
        max-width: 90vw;
        max-height: 60vh;
        padding-right: 0.25rem;
        padding-bottom: 0.25rem;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem 1.5rem;
        overflow-y: auto;
      }
      .wm-config-group-title {
        grid-column: 1 / -1;
        margin: 0.5rem 0 -0.25rem;
        padding-bottom: 0.25rem;
        border-bottom: 1px solid rgba(128, 128, 128, 0.4);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        opacity: 0.7;
      }
      .wm-config-group-title:first-child {
        margin-top: 0;
      }
      @media (max-width: 800px) {
        .wm-settings-config {
          grid-template-columns: minmax(0, 1fr);
          min-width: 0;
        }
      }
      .wm-config-row {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .wm-config-info {
        margin-left: 0.325rem;
        margin-bottom: 0.5rem;
        border: 1px solid currentColor;
        border-radius: 99vw;
        background: transparent;
        width: 0.75rem;
        height: 0.75rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        color: var(--color-accent);
        font-size: 0.6rem;
        font-weight: 700;
        line-height: 1;
        vertical-align: middle;
        cursor: help;
        opacity: 0.75;
        transition: opacity 0.2s ease, background-color 0.2s ease;
      }
      .wm-config-info:hover,
      .wm-config-info:focus-visible {
        outline: none;
        opacity: 1;
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
      }
      .wm-config-tip {
        position: fixed;
        z-index: 10001;
        max-width: min(20rem, 40vw);
        padding: 0.5rem 0.7rem;
        border: 1px solid var(--color-border);
        border-radius: 0.6rem;
        background-color: var(--color-surface-light);
        color: var(--color-foreground);
        font-size: 0.75rem;
        font-weight: 400;
        line-height: 1.35;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
        pointer-events: none;
      }
      .wm-config-label {
        margin: 0;
        font-size: 0.85rem;
        font-weight: 600;
      }
      .wm-config-text {
        width: 100%;
        max-width: 18rem;
        padding: 0.35rem 1rem;
        border: 1px solid var(--color-accent);
        border-radius: 999px;
        background: transparent;
        color: var(--color-foreground);
        font-size: 0.85rem;
      }
      .wm-config-ranges {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .wm-config-range-row {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
      }
      .wm-config-range-bound {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.85rem;
      }
      .wm-config-range-bound input,
      .wm-config-range-tag {
        padding: 0.3rem 0.6rem;
        border: 1px solid var(--color-accent);
        border-radius: 999px;
        background: transparent;
        color: var(--color-foreground);
        font-size: 0.85rem;
      }
      .wm-config-range-bound input {
        width: 6rem;
      }
      .wm-config-range-tag {
        min-width: 8rem;
        max-width: 14rem;
        padding-inline: 1rem;
        flex: 1;
      }
      .wm-config-range-switch {
        position: relative;
        flex-shrink: 0;
        width: 2.1rem;
        height: 1.2rem;
        padding: 0;
        border: none;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.2);
        cursor: pointer;
        transition: background 0.2s ease;
      }
      .wm-config-range-switch::after {
        content: "";
        position: absolute;
        top: 0.15rem;
        left: 0.15rem;
        width: 0.9rem;
        height: 0.9rem;
        border-radius: 50%;
        background: #fff;
        transition: transform 0.2s ease;
      }
      .wm-config-range-switch[aria-checked="true"] {
        background: var(--color-accent);
      }
      .wm-config-range-switch[aria-checked="true"]::after {
        transform: translateX(0.9rem);
      }
      .wm-config-range-row > :not(.wm-config-range-switch):not(.wm-config-text-clear) {
        transition: opacity 0.35s ease;
      }
      .wm-config-range-row-off > :not(.wm-config-range-switch):not(.wm-config-text-clear) {
        opacity: 0.4;
      }
      .wm-config-range-row-invalid .wm-config-range-bound input {
        border-color: #ef4444;
      }
      .wm-config-ranges-add {
        align-self: flex-start;
        padding: 0.25rem 1rem;
        border: 1px dashed var(--color-accent);
        border-radius: 999px;
        background: transparent;
        color: var(--color-accent);
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
      }
      .wm-config-ranges-add:hover:not(:disabled) {
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
      }
      .wm-config-ranges-add:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .wm-dd-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        width: 100%;
        max-width: 18rem;
        padding: 0.35rem 0.9rem;
        border: 1px solid var(--color-accent);
        border-radius: 999px;
        background: transparent;
        color: var(--color-foreground);
        font-size: 0.85rem;
        cursor: pointer;
        transition: background-color 0.2s ease;
      }
      .wm-dd-trigger:hover,
      .wm-dd-trigger[aria-expanded="true"] {
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
      }
      .wm-dd-trigger-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .wm-dd-chevron {
        flex-shrink: 0;
        color: var(--color-accent);
        font-size: 0.8rem;
        transition: transform 0.2s ease;
      }
      .wm-dd-trigger[aria-expanded="true"] .wm-dd-chevron {
        transform: rotate(180deg);
      }
      .wm-dd-list {
        position: fixed;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        max-width: min(24rem, 90vw);
        max-height: 14rem;
        overflow-y: auto;
        padding: 0.3rem;
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        background-color: var(--color-surface-light);
        color: var(--color-foreground);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        animation: wm-dd-in 0.12s ease-out;
      }
      @keyframes wm-dd-in {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .wm-dd-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.4rem 0.7rem;
        border: none;
        border-radius: 0.5rem;
        background: transparent;
        color: inherit;
        font-size: 0.85rem;
        text-align: left;
        cursor: pointer;
      }
      .wm-dd-option:hover,
      .wm-dd-option:focus-visible {
        outline: none;
        background: color-mix(in srgb, var(--color-accent) 14%, transparent);
      }
      .wm-dd-option-selected {
        color: var(--color-accent);
        font-weight: 600;
      }
      .wm-dd-option-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .wm-dd-option-check {
        flex-shrink: 0;
        font-size: 0.8rem;
      }
      .wm-config-range-field {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .wm-config-range {
        flex: 1;
        max-width: 16rem;
        accent-color: var(--color-accent);
        cursor: pointer;
      }
      .wm-config-range-value {
        min-width: 2.5rem;
        padding: 0.1rem 0.5rem;
        border: 1px solid var(--color-accent);
        border-radius: 999px;
        color: var(--color-accent);
        font-size: 0.8rem;
        font-weight: 600;
        text-align: center;
      }
      .wm-config-text-readonly {
        opacity: 0.7;
        cursor: default;
      }
      .wm-config-text-field {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .wm-config-text-field .wm-config-text {
        flex: 1;
        min-width: 0;
      }
      .wm-config-text-clear {
        border: none;
        background: transparent;
        color: var(--color-foreground);
        line-height: 1;
        opacity: 0.5;
        cursor: pointer;
        transition: opacity 0.2s ease, color 0.2s ease;
      }
      .wm-config-text-clear:hover:not(:disabled) {
        opacity: 1;
        color: #ef2222;
      }
      .wm-config-text-clear:disabled {
        opacity: 0.2;
        cursor: default;
      }
      .wm-config-pill {
        display: flex;
        align-self: flex-start;
        border: 1px solid var(--color-accent);
        border-radius: 999px;
        overflow: hidden;
      }
      .wm-config-pill-btn {
        padding: 0.35rem 0.9rem;
        border: none;
        background: transparent;
        color: var(--color-accent);
        font-size: 0.8rem;
        font-weight: 600;
        opacity: 0.7;
        cursor: pointer;
        transition: opacity 0.2s ease, background-color 0.2s ease;
      }
      .wm-config-pill-btn + .wm-config-pill-btn {
        border-left: 1px solid var(--color-accent);
      }
      /* The pill's rounded ends cut into the first and last buttons: they get extra room on their outer side */
      .wm-config-pill-btn:first-child {
        padding-left: 1rem;
      }
      .wm-config-pill-btn:last-child {
        padding-right: 1rem;
      }
      .wm-config-pill-btn:hover {
        opacity: 1;
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
      }
      .wm-config-pill-btn-selected {
        opacity: 1;
        background: color-mix(in srgb, var(--color-accent) 25%, transparent);
      }
      .wm-settings-footer {
        margin-top: 0.75rem;
      }
      .wm-settings-reload {
        display: block;
        width: 100%;
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        border: 1px solid var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        color: var(--color-accent);
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s ease;
      }
      .wm-settings-reload:hover {
        background: color-mix(in srgb, var(--color-accent) 20%, transparent);
      }
    `);

    setupFeatureConfigButton();

    const observer = new MutationObserver(() => setupFeatureConfigButton());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature TUT: a "❓" button, right next to the settings wheel (same row, same .wm-fold-toggle styling), opens
  // a modal with short explanations for the script's features that aren't self-explanatory from their UI alone —
  // keyboard shortcuts, toggles, and anything with a non-obvious trigger. Always on, like the settings button
  // itself: it's documentation, not a behavior to disable. Reuses the settings modal's overlay/header/close
  // styling (.wm-settings-*) so it looks consistent, with its own single-column list style for readable prose.
  // ============================================================
  // An entry flagged `cache: true` relies on data kept in the browser that the export/import of Feature BSP carries
  // (sale prices, estimates, followed players, player descriptions); it gets a 💾 badge in the top right corner
  const TUTORIAL_CACHE_BADGE_TITLE =
    "Cette fonctionnalité s'appuie sur des données mémorisées dans votre navigateur : elles s'exportent et s'importent depuis votre profil (à côté de « Vider le cache »).";
  const TUTORIAL_ENTRIES = [
    {
      title: "Estimer toute votre collection d'un coup",
      cache: true,
      text: "Dans votre collection, le bouton rouge « Estimation en masse » estime les cartes de la page qui n'ont pas de prix, puis passe à la page suivante, jusqu'à la fin. « Arrêter la reconnaissance » l'interrompt quand vous voulez. Laissez l'onglet ouvert et visible pendant tout ce temps : s'il passe en arrière-plan, le navigateur le ralentit et l'estimation devient peu fiable.",
    },
    {
      title: "Savoir si un prix est bon",
      cache: true,
      text: "Sur la page d'une enchère, une petite étiquette de couleur vous dit si le prix est intéressant. Elle compare avec les prix auxquels cette carte s'est déjà vendue sous vos yeux. Si c'est vous qui vendez, elle vous dit si votre vente est réussie.",
    },
    {
      title: "Repérer les bonnes affaires",
      cache: true,
      text: "Sur le marché, dans l'onglet « Parcourir », une flèche colorée apparaît à côté du prix des cartes que vous connaissez : ▼ si le prix est bas (bonne affaire), ▲ s'il est élevé. Passez la souris dessus pour plus de détails.",
    },
    {
      title: "Cacher les cartes qui ne vous intéressent pas",
      text: "Sur le marché, onglet « Parcourir », le bouton « Cacher indésirables » masque les cartes qui ne sont pas dans votre liste de souhaits. Pour cela, le script doit d'abord connaître votre liste : ouvrez « Toutes les cartes », activez « Liste de souhaits » et laissez-le faire quelques secondes, il feuillette les pages tout seul. Re-cliquez sur le bouton pour tout ré-afficher ; le choix est mémorisé.",
    },
    {
      title: "Estomper les cartes trop chères",
      text: "Sur le marché, onglet « Parcourir », le bouton « ▲ Estomper » (à droite des boutons de rareté) rend plus pâles les cartes à flèche ▲, c'est-à-dire celles dont le prix n'est pas une bonne affaire. Re-cliquez pour les voir normalement ; le choix est mémorisé.",
    },
    {
      title: "Le prix estimé d'une carte",
      cache: true,
      text: "Quand vous estimez une carte (au moment de la vendre), le script retient son prix et l'affiche à côté de sa rareté. Dans votre collection, des boutons estiment plusieurs cartes d'un coup et les classent par estimation.",
    },
    {
      title: "Garder une enchère à l'œil",
      text: "Sur la page d'une enchère, « 📌 Surveiller » la met de côté (re-cliquez pour la retirer). Sur le marché, « 📌 Surveillées » liste ces enchères : cliquez sur l'une d'elles pour y retourner. Une enchère terminée est retirée toute seule quand vous la visitez.",
    },
    {
      title: "Lancer une enchère plus vite",
      text: "Quand vous mettez une carte en vente, tapez le prix de départ puis appuyez sur Entrée : l'enchère démarre, sans cliquer sur le bouton.",
    },
    {
      title: "Voir vos plus grosses cartes",
      cache: true,
      text: "Dans votre collection, le bouton « Top 40 » à droite du titre montre vos 40 cartes les mieux estimées (vous pouvez changer ce nombre dans les réglages ⚙️, onglet « Config »). Le ✕ d'une ligne enlève cette estimation.",
    },
    {
      title: "Trier les notifications",
      text: "En haut de la liste de notifications, les boutons 💰 🛒 🔨 ⭐ n'affichent qu'un seul type (ventes, achats, enchères, liste de souhaits). Cliquez à nouveau sur le bouton allumé pour tout revoir.",
    },
    {
      title: "Être prévenu sur votre ordinateur",
      text: "Si vous acceptez les notifications du navigateur, le script vous prévient quand vous avez beaucoup de paquets à ouvrir, et juste avant la fin d'une de vos enchères.",
    },
    {
      title: "Suivre un joueur",
      cache: true,
      text: "Sur le profil d'un joueur, le bouton « Suivre » (un œil), à côté de « Signaler », le met dans vos joueurs suivis : l'œil devient rouge, et un petit œil rouge apparaît à côté de son pseudo sur les pages d'enchère.",
    },
    {
      title: "Retrouver les cartes sans estimation",
      text: "Option éteinte au départ (à allumer dans ⚙️) : pendant une estimation en masse, une carte dont le prix reste inconnu (« ? ») reçoit l'étiquette « TBD » (ou une autre de vos étiquettes, au choix dans les réglages), pour la retrouver facilement. Vous pouvez aussi demander une étiquette selon le prix : par exemple, toutes les cartes estimées entre 500 et 1 000 reçoivent l'étiquette de votre choix.",
    },
    {
      title: "Choisir les cartes sans étiquette",
      text: "Dans votre collection, un bouton choisit d'un clic toutes les cartes qui n'ont pas encore d'étiquette.",
    },
    {
      title: "Noter un mot sur un joueur",
      cache: true,
      text: "Sur le profil d'un autre joueur, le bouton « Description » permet d'écrire une courte note (128 caractères maximum). Entrée l'enregistre, et une note vide l'efface. Elle s'affiche à côté de son pseudo, et vous seul la voyez.",
    },
    {
      title: "Aller sur le profil d'un ami",
      text: "Dans « Toutes les cartes », cliquez sur le pseudo d'un ami qui possède une carte pour ouvrir directement son profil.",
    },
    {
      title: "Adapter le script à vos habitudes",
      text: "Dans ⚙️, l'onglet « Config » réunit des réglages qui se choisissent d'un clic et s'appliquent tout de suite : durée d'enchère proposée par défaut, onglet du marché ouvert à l'arrivée, taille des classements, moments où vous êtes prévenu, etc. Au départ, rien ne change par rapport à avant.",
    },
    {
      title: "Le bouton ⚙️ (réglages)",
      text: "Il sert à activer/désactiver chaque fonctionnalité du script. Rechargez la page après un changement pour qu'il soit pris en compte.",
    },
    {
      title: "Le menu à gauche",
      text: "Il se réduit à de petites icônes. Passez la souris dessus pour le voir en entier, ou cliquez sur 📌 pour qu'il reste toujours ouvert.",
    },
  ];

  function buildTutorialModal() {
    const overlay = document.createElement("div");
    overlay.className = "wm-settings-overlay";

    const modal = document.createElement("div");
    modal.className = "wm-settings-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Tutoriels de Wiki-MasterBetter");

    const header = document.createElement("div");
    header.className = "wm-settings-header";

    const title = document.createElement("h2");
    title.className = "wm-settings-title";
    title.textContent = "❓ Tutoriels";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "wm-settings-close";
    closeBtn.setAttribute("aria-label", "Fermer");
    closeBtn.textContent = "✕";

    header.append(title, closeBtn);

    const hint = document.createElement("p");
    hint.className = "wm-settings-hint";
    hint.textContent =
      "Un petit guide pour les fonctionnalités les moins évidentes du script. (rédigé par Claude)\nLe 💾 signale celles qui reposent sur des données mémorisées, exportables et importables depuis votre profil.";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "wm-tutorial-search";
    search.placeholder = "Rechercher dans les tutoriels...";
    search.setAttribute("aria-label", "Rechercher dans les tutoriels");

    const list = document.createElement("div");
    list.className = "wm-tutorial-list";

    // The scroller (list) is not the multi-column box: a column box with a capped height spills its content into
    // extra columns sideways instead of scrolling down
    const columns = document.createElement("div");
    columns.className = "wm-tutorial-columns";
    list.appendChild(columns);

    TUTORIAL_ENTRIES.forEach(({ title: entryTitle, text, cache }) => {
      const item = document.createElement("div");
      item.className = "wm-tutorial-item";

      if (cache) {
        const badge = document.createElement("span");
        badge.className = "wm-tutorial-item-cache";
        badge.textContent = "💾";
        badge.title = TUTORIAL_CACHE_BADGE_TITLE;
        badge.setAttribute("role", "img");
        badge.setAttribute("aria-label", TUTORIAL_CACHE_BADGE_TITLE);
        item.classList.add("wm-tutorial-item-has-cache");
        item.appendChild(badge);
      }

      const itemTitle = document.createElement("h3");
      itemTitle.className = "wm-tutorial-item-title";
      itemTitle.textContent = entryTitle;

      const itemText = document.createElement("p");
      itemText.className = "wm-tutorial-item-text";
      itemText.textContent = text;

      item.append(itemTitle, itemText);
      columns.appendChild(item);
    });

    const noResult = document.createElement("p");
    noResult.className = "wm-settings-hint wm-tutorial-no-result";
    noResult.textContent = "Aucun tutoriel ne correspond à cette recherche.";
    noResult.hidden = true;
    list.appendChild(noResult);

    // Accents and case are ignored, and the title and the text are both searched
    const fold = foldAccents;
    search.addEventListener("input", () => {
      const query = fold(search.value.trim());
      let shown = 0;
      columns.querySelectorAll(".wm-tutorial-item").forEach((item) => {
        const match = !query || fold(item.textContent).includes(query);
        item.hidden = !match;
        if (match) shown++;
      });
      noResult.hidden = shown > 0;
      logger(CPL.LOG, `Tutorial search "${query}": ${shown} result(s)`);
    });

    // Same panel as the settings tabs, so the content eases in with their fade and slide
    const panel = document.createElement("div");
    panel.className = "wm-settings-panel wm-tutorial-panel";
    panel.append(hint, search, list);

    modal.append(header, panel);
    overlay.appendChild(modal);

    const onKeydown = (event) => {
      if (event.key === "Escape") close();
    };
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKeydown);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", onKeydown);
    logger(CPL.LOG, "Tutorial modal opened");
    setTimeout(() => search.focus(), 0);

    return overlay;
  }

  function setupTutorialButton() {
    const nav = document.querySelector("nav h1")?.closest("nav");
    if (!nav) return;

    const row = ensureToggleRow(nav);
    if (row.querySelector(":scope > .wm-tutorial-toggle")) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "wm-fold-toggle wm-tutorial-toggle";
    toggle.title = "Tutoriels des fonctionnalités de Wiki-MasterBetter";
    toggle.setAttribute("aria-haspopup", "dialog");

    const icon = document.createElement("span");
    icon.className = "wm-fold-toggle-icon";
    icon.textContent = "❓";
    toggle.appendChild(icon);

    toggle.addEventListener("click", () => {
      if (document.querySelector(".wm-settings-overlay")) return;
      document.body.appendChild(buildTutorialModal());
    });

    const settingsToggle = row.querySelector(":scope > .wm-settings-toggle");
    if (settingsToggle) {
      settingsToggle.after(toggle);
    } else {
      row.insertBefore(toggle, row.firstChild);
    }
  }

  function watchTutorialButton() {
    addStyle(`
      .wm-tutorial-panel {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .wm-tutorial-search {
        margin-inline: auto;
        border-radius: 0.5rem;
        border: 1px solid var(--color-border);
        width: max(20rem,50%);
        padding: 0.5rem 0.75rem;
        background: transparent;
        color: inherit;
        font-size: 0.875rem;
      }
      .wm-tutorial-item {
        position: relative;
      }
      .wm-tutorial-item-cache {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        font-size: 0.75rem;
        line-height: 1;
        opacity: 0.75;
        cursor: help;
      }
      .wm-tutorial-item-has-cache .wm-tutorial-item-title {
        padding-right: 1.5rem;
      }
      .wm-tutorial-item[hidden] {
        display: none;
      }
      .wm-tutorial-list {
        max-width: max(50rem,50vw);
        max-height: 80vh;
        padding-right: 0.25rem;
        overflow-x: hidden;
        overflow-y: auto;
      }
      .wm-tutorial-columns {
        column-count: 2;
        column-gap: 0.6rem;
      }
      @media (max-width: 640px) {
        .wm-tutorial-columns {
          column-count: 1;
        }
      }
      .wm-tutorial-item {
        break-inside: avoid;
        margin-bottom: 0.6rem;
        padding: 0.5rem 0.75rem;
        border: 1px solid rgba(128, 128, 128, 0.4);
        border-radius: 0.5rem;
      }
      .wm-tutorial-item-title {
        margin: 0 0 0.25rem 0;
        font-size: 0.9rem;
        font-weight: 600;
      }
      .wm-tutorial-item-text {
        margin: 0;
        font-size: 0.85rem;
        opacity: 0.85;
        line-height: 1.4;
      }
    `);

    setupTutorialButton();

    const observer = new MutationObserver(() => setupTutorialButton());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 19: a single pass over every <p> in the notification display
  // (div.card-frame.shadow-xl.overflow-hidden) rewrites whichever of these three notification types it matches:
  //   - the fixed phrase "Votre carte vous est rendue." — with no name in it, that phrase is only how this
  //     notification type is identified. The card name isn't in that <p>: it's found by scanning the enclosing
  //     notification item (button.w-full.items-start)'s whole text content for a quoted segment (straight quotes or
  //     « » guillemets). Rewritten to "Personne n'a enchéri pour votre carte « {name} »", tinted light orange
  //   - an outbid refund notification, "{username} a misé {bid} wikibidous sur « {card} ». Vos {refund}
  //     wikibidous vous ont été remboursés.", rewritten to "Enchère pour « {card} » : {bid} > {refund}.
  //     Renchérissez pour gagner la carte.", with the "{bid}" segment in a gentle yellow; {card} itself is
  //     truncated to 42 characters (plus "...") if longer
  //   - "Votre carte « {card} » a été vendue pour {amount} wikibidous." rewritten to "+{amount} wb pour
  //     avoir vendu « {card} »" (green); "Vous avez remporté « {card} » pour {amount} wikibidous." rewritten to
  //     "-{amount} wb pour avoir acheté « {card} »" (gentle red)
  // Each <p> matches at most one of these, so they're tried in sequence and the first hit wins.
  // ============================================================
  const RETURNED_CARD_PHRASE = "Votre carte vous est rendue.";
  const QUOTED_TEXT_REGEX = /[«"](.+?)[»"]/;
  const OUTBID_REFUND_PHRASE_SUFFIX = "vous ont été remboursés.";
  const OUTBID_REFUND_DETAILS_REGEX =
    /a misé\s+(\d+)\s+wikibidous sur\s*[«"](.+?)[»"]\.\s*Vos\s+(\d+)\s+wikibidous vous ont été remboursés/;
  const CARD_SOLD_DETAILS_REGEX =
    /Votre carte\s*[«"](.+?)[»"]\s*a été vendue pour\s+(\d+)\s+wikibidous\.?/;
  const CARD_BOUGHT_DETAILS_REGEX =
    /Vous avez remporté\s*[«"](.+?)[»"]\s*pour\s+(\d+)\s+wikibidous\.?/;

  function rewriteReturnedCardParagraph(p) {
    if (!p.textContent.trim().endsWith(RETURNED_CARD_PHRASE)) return false;

    const item = p.closest("button.w-full.items-start");
    const match = item?.textContent.match(QUOTED_TEXT_REGEX);
    if (!match) return false;

    const cardName = match[1].trim();

    const noBidderSpan = document.createElement("span");
    noBidderSpan.className = "wm-returned-card-message";
    noBidderSpan.textContent = "Personne";

    p.textContent = "";
    p.append(noBidderSpan, ` n'a enchéri pour votre carte « ${cardName} ».`);
    return true;
  }

  function rewriteOutbidRefundParagraph(p) {
    if (!p.textContent.trim().endsWith(OUTBID_REFUND_PHRASE_SUFFIX))
      return false;

    const match = p.textContent.match(OUTBID_REFUND_DETAILS_REGEX);
    if (!match) return false;

    const [, otherBid, cardName, userBid] = match;
    const formattedCardName =
      cardName.length < 42 ? cardName : cardName.trim().slice(0, 42) + "...";

    const bidComparisonSpan = document.createElement("span");
    bidComparisonSpan.className = "wm-outbid-refund-other-bid";
    bidComparisonSpan.textContent = `${otherBid} > ${userBid}`;

    p.textContent = "";
    p.append(
      `Enchère pour « ${formattedCardName} » : `,
      bidComparisonSpan,
      `. Renchérissez pour gagner la carte.`,
    );
    return true;
  }

  function rewriteCardSoldOrBoughtParagraph(p) {
    const soldMatch = p.textContent.match(CARD_SOLD_DETAILS_REGEX);
    const boughtMatch =
      !soldMatch && p.textContent.match(CARD_BOUGHT_DETAILS_REGEX);
    const match = soldMatch || boughtMatch;
    if (!match) return false;

    const [, cardName, amount] = match;

    const amountSpan = document.createElement("span");
    amountSpan.className = soldMatch
      ? "wm-card-sold-amount"
      : "wm-card-bought-amount";
    amountSpan.textContent = soldMatch ? `+${amount} wb` : `-${amount} wb`;

    p.textContent = "";
    p.append(
      amountSpan,
      soldMatch
        ? ` pour avoir vendu « ${cardName.trim()} ».`
        : ` pour avoir acheté « ${cardName.trim()} ».`,
    );
    return true;
  }

  function rewriteNotificationParagraphs() {
    const container = document.querySelector(
      "div.card-frame.shadow-xl.overflow-hidden",
    );
    if (!container) return;

    container.querySelectorAll("p").forEach((p) => {
      try {
        if (p.dataset.wmNotificationRewritten === "true") return;

        const rewritten =
          rewriteReturnedCardParagraph(p) ||
          rewriteOutbidRefundParagraph(p) ||
          rewriteCardSoldOrBoughtParagraph(p);
        if (!rewritten) return;

        p.dataset.wmNotificationRewritten = "true";
      } catch (error) {
        logger(CPL.ERROR, "Rule 19 failed on a notification", error);
      }
    });
  }

  function watchNotificationRewrites() {
    addStyle(`
      .wm-returned-card-message {
        color: #fdba74;
      }

      .wm-outbid-refund-other-bid {
        color: #facc15;
        font-weight: 600;
      }

      .wm-card-sold-amount {
        color: #10b981;
        font-weight: 600;
      }

      .wm-card-bought-amount {
        color: #f87171;
        font-weight: 600;
      }
    `);

    rewriteNotificationParagraphs();

    const observer = new MutationObserver(() =>
      rewriteNotificationParagraphs(),
    );
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ============================================================
  // Rule 31: on the notification container (div.card-frame.shadow-xl.overflow-hidden), insert a row of toggle
  // buttons into its header (the container's first child, see Rule 17) — one per notification type this script
  // already knows how to recognize: sold ("Votre carte « X » a été vendue pour Y wikibidous.", or its Rule
  // 19-rewritten form carrying .wm-card-sold-amount), bought ("Vous avez remporté « X » pour Y wikibidous.",
  // .wm-card-bought-amount), bidding-related (the outbid-refund phrase and the "no bidder" returned-card phrase
  // Rule 19 also matches, or their rewritten .wm-outbid-refund-other-bid / .wm-returned-card-message forms), and
  // wishlist (an item containing the substring "mise en vente" — see Rule 14's WISHLIST_LISTED_PHRASE — or, as a
  // fallback, a <p> reading exactly "Liste de souhaits"). Both the original and Rule 19-rewritten phrasing are
  // checked since this can run before or after Rule 19 processes the same item.
  //
  // Rule 31 (cont'd): clicking a button shows only notification items (button.w-full.items-start) of that type
  // and hides the rest (display: none); clicking the already-active button clears the filter and shows everything
  // again. Only one button can be active at a time — activating one deactivates whichever was active before. The
  // active filter (or its absence) is remembered in localStorage and reapplied automatically, including to
  // notifications that stream in afterward.
  // ============================================================
  const NOTIFICATION_FILTER_STORAGE_KEY = "wm-notification-filter";
  const NOTIFICATION_FILTER_TYPES = [
    { id: "sold", icon: "💰", label: "Ventes" },
    { id: "bought", icon: "🛒", label: "Achats" },
    { id: "bid", icon: "🔨", label: "Enchères" },
    { id: "wishlist", icon: "⭐", label: "Liste de souhaits" },
  ];

  function getNotificationFilter() {
    return localStorage.getItem(NOTIFICATION_FILTER_STORAGE_KEY);
  }

  function setNotificationFilter(type) {
    logger(CPL.LOG, `Notification filter: ${type ?? "none"}`);
    if (type) localStorage.setItem(NOTIFICATION_FILTER_STORAGE_KEY, type);
    else localStorage.removeItem(NOTIFICATION_FILTER_STORAGE_KEY);
  }

  function getNotificationItemType(item) {
    if (item.querySelector(".wm-card-sold-amount")) return "sold";
    if (item.querySelector(".wm-card-bought-amount")) return "bought";
    if (
      item.querySelector(
        ".wm-outbid-refund-other-bid, .wm-returned-card-message",
      )
    )
      return "bid";

    const text = item.textContent;
    if (CARD_SOLD_DETAILS_REGEX.test(text)) return "sold";
    if (CARD_BOUGHT_DETAILS_REGEX.test(text)) return "bought";
    if (
      OUTBID_REFUND_DETAILS_REGEX.test(text) ||
      text.trim().endsWith(RETURNED_CARD_PHRASE)
    )
      return "bid";

    const isWishlistItem =
      text.includes(WISHLIST_LISTED_PHRASE) ||
      Array.from(item.querySelectorAll("p")).some(
        (p) => p.textContent.trim() === "Liste de souhaits",
      );
    if (isWishlistItem) return "wishlist";

    return null;
  }

  function applyNotificationFilter() {
    const container = document.querySelector(
      "div.card-frame.shadow-xl.overflow-hidden",
    );
    if (!container) return;

    const activeType = getNotificationFilter();

    container.querySelectorAll("button.w-full.items-start").forEach((item) => {
      item.style.display =
        !activeType || getNotificationItemType(item) === activeType
          ? ""
          : "none";
    });
  }

  function setupNotificationFilterButtons() {
    const container = document.querySelector(
      "div.card-frame.shadow-xl.overflow-hidden",
    );
    const header = container?.firstElementChild;
    if (!header) return;

    if (header.querySelector(":scope > .wm-notification-filter-row")) {
      applyNotificationFilter();
      return;
    }

    const row = document.createElement("div");
    row.className = "wm-notification-filter-row";

    const activeType = getNotificationFilter();

    NOTIFICATION_FILTER_TYPES.forEach(({ id, icon, label }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wm-notification-filter-btn";
      btn.title = `Filtrer : ${label}`;
      btn.textContent = icon;
      btn.setAttribute("aria-pressed", String(id === activeType));

      btn.addEventListener("click", () => {
        const next = btn.getAttribute("aria-pressed") === "true" ? null : id;
        setNotificationFilter(next);

        row
          .querySelectorAll(".wm-notification-filter-btn")
          .forEach((b) =>
            b.setAttribute("aria-pressed", String(b === btn && next !== null)),
          );

        applyNotificationFilter();
      });

      row.appendChild(btn);
    });

    header.appendChild(row);
    applyNotificationFilter();
  }

  function watchNotificationFilterButtons() {
    addStyle(`
      .wm-notification-filter-row {
        display: flex;
        gap: 0.35rem;
        margin-left: auto;
      }
      .wm-notification-filter-btn {
        border: none;
        background: #ffffff0f;
        border-radius: 0.375rem;
        padding: 0.25rem 0.45rem;
        font-size: 0.9rem;
        line-height: 1;
        cursor: pointer;
        opacity: 0.6;
        transition: background 0.2s ease, opacity 0.2s ease;
      }
      .wm-notification-filter-btn:hover {
        background: #ffffff3f;
        opacity: 1;
      }
      .wm-notification-filter-btn[aria-pressed="true"] {
        background: var(--color-accent);
        opacity: 1;
      }
    `);

    setupNotificationFilterButtons();

    const observer = new MutationObserver(() =>
      setupNotificationFilterButtons(),
    );
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature GCP: on /global-collection, each card showing which friend owns it renders that friend's username in a
  // span.truncate, but the card's own overlay (div.inset-0) sits on top and captures every pointer event, so a plain
  // hover/click listener on the span never fires. Instead, track the mouse position (mousemove) and, at any given
  // point, resolve which card (the div.inset-0 whose bounding rect contains that point) and username span (its
  // parent's span.truncate) the cursor is over; while it's within that span's own bounding rect, show it as
  // clickable, and clicking navigates to /profile/{username} instead of the card's default action
  // ============================================================
  function getGcpCardAtPoint(clientX, clientY) {
    const cards = document.querySelectorAll("div.inset-0");

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return card;
      }
    }

    return null;
  }

  function getGcpUsernameSpanAt(clientX, clientY) {
    const card = getGcpCardAtPoint(clientX, clientY);
    if (!card) return null;

    const usernameSpan =
      card.querySelector("span.truncate") ??
      card.parentElement?.querySelector("span.truncate");
    if (!usernameSpan) return null;

    const rect = usernameSpan.getBoundingClientRect();
    const isOverUsername =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    return isOverUsername ? usernameSpan : null;
  }

  let gcpHoveredUsernameSpan = null;

  function handleGcpMouseMove(event) {
    if (!window.location.pathname.startsWith("/global-collection")) return;

    const usernameSpan = getGcpUsernameSpanAt(event.clientX, event.clientY);
    if (usernameSpan === gcpHoveredUsernameSpan) return;

    gcpHoveredUsernameSpan?.classList.remove("wm-friend-username-hover");
    usernameSpan?.classList.add("wm-friend-username-hover");
    gcpHoveredUsernameSpan = usernameSpan;
  }

  function handleGcpClick(event) {
    if (!window.location.pathname.startsWith("/global-collection")) return;

    const usernameSpan = getGcpUsernameSpanAt(event.clientX, event.clientY);
    if (!usernameSpan) return;

    const username = usernameSpan.textContent.trim();
    if (!username) return;

    event.preventDefault();
    event.stopPropagation();
    logger(CPL.LOG, `Friend name clicked: ${username}`);
    window.location.href = `/profile/${encodeURIComponent(username)}`;
  }

  function watchGlobalCollectionFriendProfileLinks() {
    addStyle(`
      .wm-friend-username-hover {
        cursor: pointer;
        text-decoration: underline;
      }
    `);

    document.addEventListener("mousemove", handleGcpMouseMove);
    document.addEventListener("click", handleGcpClick, true);
  }

  // ============================================================
  // Rule 25: on /global-collection, add a button next to the "wishlist only" toggle (button.gap-1\.5) — much like
  // Feature EBC's own bulk-action buttons — offering to remove every card
  // showing the "Possédée" tag (span.bg-emerald-600\/90 inside its description, div.top-\[45\%\]) from the
  // wishlist. Removing one is: click the card (opens its modal), click button.w-full.transition-colors (the
  // modal's "unwish" button), then Escape to close it before moving to the next; cancellable via a fixed stop
  // button, same pattern as Feature EBC's own. Once the run ends (naturally or stopped), div.backdrop-blur-sm
  // is clicked to dismiss whatever card modal is left open. The container itself is always present — only its cards are
  // (re)populated after the toggle is flipped — so rather than watching for the container's arrival, every
  // mutation restarts a short debounce (same rationale as Feature BSP's own scheduleUpdate: avoid reading a
  // still-repopulating list) and the button's label only updates once the DOM has settled.
  //
  // Rule 25 (cont'd): with the toggle unchecked the page lists every card, so there is no telling which owned ones
  // are wishlisted: the button then shows no count, and a card whose modal button reads "Ajouter à la liste de
  // souhaits" (not wishlisted) is not clicked — its modal is just closed and the card skipped for the rest of the
  // run (tracked by name, as the list keeps showing it).
  // ============================================================
  function getWishlistOwnedCards(cardList) {
    return Array.from(cardList.children).filter((card) =>
      card
        .querySelector("div.top-\\[45\\%\\]")
        ?.querySelector("span.bg-emerald-600\\/90"),
    );
  }

  function getWishlistCardName(card) {
    return card.querySelector("h3")?.textContent.trim() ?? "";
  }

  function isWishlistOnlyToggleChecked() {
    return !!document
      .querySelector("button.gap-1\\.5:nth-child(1)")
      ?.classList.contains("ring-2");
  }

  // The card modal's wishlist button: "Retirer..." (wishlisted, button.border) or "Ajouter à la liste de souhaits"
  function waitForWishlistModalButton(timeout = 4000, interval = 100) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const btn =
          document.querySelector(
            "button.transition-colors.border:nth-child(1)",
          ) ??
          Array.from(document.querySelectorAll("div.card-frame button")).find(
            (b) => /liste de souhaits/i.test(b.textContent),
          );
        if (btn) resolve(btn);
        else if (Date.now() - start >= timeout) resolve(null);
        else setTimeout(check, interval);
      };
      check();
    });
  }

  function insertStopWishlistCleanupButton(state) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wm-wishlist-cleanup-stop";
    btn.textContent = "Arrêter le retrait";

    btn.addEventListener("click", () => {
      state.stopped = true;
    });

    document.body.appendChild(btn);
    return btn;
  }

  async function removeWishlistOwnedCards(button) {
    const state = { stopped: false };
    const stopBtn = insertStopWishlistCleanupButton(state);

    let removed = 0;
    const skippedNames = new Set();
    logger(CPL.INFO, "Wishlist cleanup started");
    while (!state.stopped) {
      const cardList = document.querySelector("div.gap-3.justify-center");
      const card = cardList
        ? getWishlistOwnedCards(cardList).find(
            (c) => !skippedNames.has(getWishlistCardName(c)),
          )
        : null;
      if (!card) break;

      button.textContent = `Retrait des cartes possédées... (${removed + 1})`;
      (card.querySelector("div.inset-0") ?? card).click();

      const wishBtn = await waitForWishlistModalButton();
      if (wishBtn && /^\s*ajouter/i.test(wishBtn.textContent)) {
        // Not wishlisted: clicking would add it. Only close the modal.
        skippedNames.add(getWishlistCardName(card));
        logger(
          CPL.LOG,
          `Not wishlisted, skipped: "${getWishlistCardName(card)}"`,
        );
      } else if (!wishBtn) {
        // Same: skipped, or the loop would reopen this card forever
        skippedNames.add(getWishlistCardName(card));
        logger(
          CPL.WARN,
          `Wishlist button not found in the modal of "${getWishlistCardName(card)}"`,
        );
      } else {
        wishBtn?.click();
        removed++;
        logger(
          CPL.LOG,
          `Removed from wishlist: "${getWishlistCardName(card)}"`,
        );
      }

      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );

      // Give the list a moment to drop the card before re-scanning for the next one.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Whether the run finished naturally or was stopped early, make sure no card modal is
    // left open behind it — clicking the backdrop dismisses it the same way a manual click
    // outside the modal would.
    document.querySelector("div.backdrop-blur-sm")?.click();

    logger(
      CPL.INFO,
      `Wishlist cleanup ${state.stopped ? "stopped" : "complete"}: ${removed} removed, ${skippedNames.size} skipped`,
    );
    stopBtn.remove();
    button.disabled = false;
    updateWishlistCleanupButtonLabel(button);
  }

  function updateWishlistCleanupButtonLabel(button) {
    if (button.disabled) return;

    const cardList = document.querySelector("div.gap-3.justify-center");
    const ownedCount = cardList ? getWishlistOwnedCards(cardList).length : 0;

    button.style.display = ownedCount === 0 ? "none" : "";
    // Unchecked toggle: owned cards aren't known to be wishlisted, so no count
    if (!isWishlistOnlyToggleChecked()) {
      button.textContent = "Dé-lister les cartes possédées";
      return;
    }
    button.textContent =
      ownedCount > 1
        ? `Dé-lister les ${ownedCount} cartes possédées`
        : `Dé-lister la carte possédée`;
  }

  function insertWishlistCleanupButton(toggle) {
    let btn = document.querySelector(".wm-wishlist-cleanup");
    if (btn) return btn;

    // Same styling approach as Feature EBC's own buttons: clone a native button's className
    // (here, the toggle itself) so ours blends in with the site's own look, rather than
    // custom-styling it from scratch.
    const referenceBtn =
      toggle.parentElement?.querySelector("button") ?? toggle;

    btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${referenceBtn.className} wm-wishlist-cleanup`;

    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      btn.disabled = true;
      removeWishlistOwnedCards(btn);
    });

    toggle.after(btn);
    return btn;
  }

  function watchWishlistOwnedCardCount() {
    addStyle(`
      .wm-wishlist-cleanup-stop {
        position: absolute;
        top: 1rem;
        right: 1rem;
        z-index: 999;
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 0.5rem;
        background: #dc26265f;
        color: #fff;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        opacity: 0.8;
        transition: background-color 0.2s ease, opacity 0.2s ease;
      }
      .wm-wishlist-cleanup-stop:hover {
        background: #b91c1c;
        opacity: 1;
      }
    `);

    const evaluate = () => {
      if (!window.location.pathname.startsWith("/global-collection")) return;

      const toggle = document.querySelector("button.gap-1\\.5:nth-child(1)");
      if (!toggle) return;

      const btn = insertWishlistCleanupButton(toggle);
      updateWishlistCleanupButtonLabel(btn);
    };

    let debounceId = null;
    const scheduleEvaluate = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(evaluate, 300);
    };

    const observer = new MutationObserver(scheduleEvaluate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  // ============================================================
  // Rule 26: on /trades, once the "Historique" tab (identified by which tab button currently carries the active
  // class, button.border-\[var\(--color-accent\)\]) is selected and its list (div.space-y-3.animate-fade-in-up)
  // has loaded (i.e. has at least one child), rearrange it into two flexible columns — not a strict grid (equal
  // row heights) nor CSS multi-column (which would fill the whole first column before spilling into the second,
  // i.e. items 1-N/2 then N/2+1-N). Instead, items are read in their original top-to-bottom order and each one
  // is placed into whichever column is currently shorter, so the reading order still goes roughly left-to-right,
  // top-to-bottom despite every item's height being different. Skipped once every current child already carries
  // "wm-trades-history-item" (i.e. this has already run for exactly this set of children), rather than on every
  // mutation, since re-measuring and reshuffling an already-arranged list on unrelated mutations would fight the
  // layout it just built.
  // ============================================================
  // Rule 26 (hotfix): the two columns are laid out with absolute positioning on each item, in place, rather than
  // re-parenting items into two wrapper divs like the original implementation did. Leaving /trades re-renders the
  // "Historique" list, and React's reconciler crashes (insertBefore/removeChild "not a child of this node") if a
  // card it still thinks is a direct child of list was actually moved under our column wrapper — same failure mode
  // already documented on Rule 4. Only setting each item's own inline position never changes anyone's parent, so
  // React's own re-render (or unmount, when switching tabs) stays consistent with the real DOM no matter what we
  // did to it.
  //
  // Rule 26 (hotfix 2): each item's height is measured AFTER its width is narrowed down to the column width, not
  // before. An item can wrap onto extra lines once narrowed (e.g. a trade listing several cards per side), so
  // measuring at the list's original full width under-counted its real (post-resize) height — the next item placed
  // below it then overlapped instead of being pushed down.
  //
  // Rule 26 (hotfix 3): a dataset flag on the list used to guard against reprocessing, cleared only once the list's
  // children count reached 0. But leaving /trades and coming back can swap in a fresh batch of "Historique" items
  // without ever passing through that empty state (the site replaces the old children directly), so the flag stayed
  // "true" from the very first run and every later visit's fresh, unstyled items were left un-arranged. Checking
  // each current child directly (do they already carry our class?) instead of a one-shot flag re-arranges every
  // time a set of children hasn't been processed yet, no matter how it got there. This same layout routine is also
  // reused by Rule 27 to re-pack the list around whatever is currently visible after a filter change, so it only
  // ever lays out children whose "display" isn't "none" — a hidden item keeps whatever stale position it had, which
  // is harmless since it isn't shown anyway.
  // ============================================================
  function layoutTradesHistoryColumns(list) {
    const items = Array.from(list.children).filter(
      (item) => item.style.display !== "none",
    );
    const gap = 12;
    const columnWidth = (list.clientWidth - gap) / 2;

    // Width has to be applied before measuring height: an item can wrap onto extra lines once narrowed down to a
    // column's width (e.g. a trade with several cards per side), so measuring offsetHeight at the list's original
    // full width under-counts how tall it actually ends up once placed in a column — the next item placed below it
    // then overlaps it instead of being pushed down.
    items.forEach((item) => {
      item.classList.add("wm-trades-history-item");
      item.style.width = `${columnWidth}px`;
    });

    const heights = items.map((item) => item.offsetHeight);
    const columnHeights = [0, 0];

    items.forEach((item, i) => {
      const target = columnHeights[0] <= columnHeights[1] ? 0 : 1;
      item.style.left = target === 0 ? "0" : `${columnWidth + gap}px`;
      item.style.top = `${columnHeights[target]}px`;
      columnHeights[target] += heights[i] + gap;
    });

    list.classList.add("wm-trades-history-grid");
    list.style.height = `${Math.max(columnHeights[0], columnHeights[1]) - gap}px`;
  }

  function updateTradesHistoryGrid() {
    if (!window.location.pathname.startsWith("/trades")) return;

    const list = document.querySelector("div.space-y-3.animate-fade-in-up");
    if (!list || list.children.length === 0) return;

    const alreadyLaidOut = Array.from(list.children).every((item) =>
      item.classList.contains("wm-trades-history-item"),
    );
    if (alreadyLaidOut) return;

    const activeTab = document.querySelector(
      "button.border-\\[var\\(--color-accent\\)\\]",
    );
    if (activeTab?.textContent.trim() !== "Historique") return;

    layoutTradesHistoryColumns(list);
  }

  function watchTradesHistoryGrid() {
    addStyle(`
      .wm-trades-history-grid {
        position: relative;
      }
      .wm-trades-history-item {
        position: absolute;
      }
    `);

    updateTradesHistoryGrid();

    const observer = new MutationObserver(() => updateTradesHistoryGrid());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  // ============================================================
  // Rule 27: on /trades, once Rule 26's div.wm-trades-history-grid exists, insert a text input right before it
  // to filter the "Historique" list by trading partner. Each trade instance (div.card-frame.p-4) carries its
  // partner's name in span.text-sm, prefixed with "De " (they initiated it) or "À " (you did) — stripped before
  // matching. Items whose partner name doesn't contain the (case-insensitive) filter text are hidden via
  // "display: none"; an empty filter shows everything again. Rule 26's own column layout is then re-run so the
  // remaining visible items re-pack into two tight columns instead of keeping the positions they had among the
  // full, unfiltered list — which would otherwise leave them floating in place with gaps where hidden items used
  // to be.
  // ============================================================
  const TRADE_PARTNER_PREFIX_REGEX = /^(De |À )/;

  function getTradePartnerName(item) {
    const span = item.querySelector("span.text-sm");
    if (!span) return null;

    return span.textContent
      .trim()
      .replace(TRADE_PARTNER_PREFIX_REGEX, "")
      .trim();
  }

  function filterTradesHistoryByPartner(grid, query) {
    const normalizedQuery = query.trim().toLowerCase();

    grid.querySelectorAll(".card-frame.p-4").forEach((item) => {
      const partnerName = getTradePartnerName(item) ?? "";
      const matches =
        !normalizedQuery || partnerName.toLowerCase().includes(normalizedQuery);
      item.style.display = matches ? "" : "none";
    });

    layoutTradesHistoryColumns(grid);
  }

  function insertTradesHistoryFilterInput(grid) {
    if (
      grid.previousElementSibling?.classList.contains(
        "wm-trades-history-filter",
      )
    ) {
      return grid.previousElementSibling;
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = "wm-trades-history-filter";
    input.placeholder = "Filtrer par nom d'utilisateur...";

    input.addEventListener("input", () => {
      filterTradesHistoryByPartner(grid, input.value);
    });

    grid.before(input);
    return input;
  }

  function updateTradesHistoryFilter() {
    if (!window.location.pathname.startsWith("/trades")) return;

    const grid = document.querySelector("div.wm-trades-history-grid");
    if (!grid) return;

    const input = insertTradesHistoryFilterInput(grid);
    filterTradesHistoryByPartner(grid, input.value);
  }

  function watchTradesHistoryFilter() {
    addStyle(`
      .wm-trades-history-filter {
        display: block;
        margin-inline: auto;
        width: 25%;
        margin-bottom: 0.75rem;
        padding: 0.5rem 0.75rem;
        border-radius: 0.5rem;
        border: 1px solid var(--color-border);
        background: transparent;
        color: inherit;
        font-size: 0.875rem;
      }
    `);

    updateTradesHistoryFilter();

    const observer = new MutationObserver(() => updateTradesHistoryFilter());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature EBC: on /collection, add three buttons as the last children of div.flex-wrap.gap-2 (rarity filter
  // buttons): "Ré-estimer la page" (re-evaluates every card), "Estimer les cartes non évaluées" (only cards
  // whose rarity tag doesn't yet carry an ETS appendix, or carries the "?" unknown marker — hidden outright once
  // that count reaches 0 on the current page), and "Ordonner la page par prix" (reorders the grid by
  // each card's raw eval value, unknowns last). The two evaluation
  // buttons show a fixed "Arrêter la reconnaissance" button and, for each targeted card, click its
  // .wm-quick-action button, wait for Feature ETS to record a fresh value under its "eval-{name}" localStorage
  // key, then press Escape to close the modal before moving to the next card. The stop button cancels the run
  // after the current card; the two evaluation buttons disable each other while either is running. Whenever a
  // native rarity filter button (button.px-3.py-1.transition-colors) shows up after "Ré-estimer la page" —
  // e.g. a new rarity tier's filter button getting appended past our own controls — it's moved back in front of
  // it, keeping the site's own filter buttons grouped together ahead of ours.
  //
  // Feature EBC (cont'd): the action buttons (the three above and the "Estimation complète" one below) are wrapped in a
  // dock, a div (wm-eval-dock) pushed to the end of that row with an auto left margin, as Rule 40's switch is on
  // /marketplace; the native filter buttons are kept ahead of the dock instead of ahead of "Ré-estimer la page".
  //
  // Feature EBC (cont'd): cards marked as favorite (they contain a button.text-amber-200) are skipped by every bulk
  // evaluation, and left out of the counts and durations shown: such a card has no "Mettre aux enchères" button, so
  // its estimate can't be reached. More generally, a card that can't be put up for sale (no sell button in its modal, no
  // card image to click, e.g. already on auction or in a trade) is skipped as soon as the quick action says so, and a
  // card still without an estimate after the configured number of attempts (Feature CFG, default 3) is skipped too, with a warning each time and the
  // skipped names listed when the run ends.
  //
  // Feature EBC (cont'd): both evaluation buttons, and the "Estimation en masse" one below, only run reliably
  // while their tab is the active one and the window isn't minimized — their polling (waitForCardEvaluation's
  // setTimeout loop, and waitUntil's below) gets throttled by the browser once background/minimized, which
  // stretches the time a slow card's evaluation needs to land. evaluateCollectionCards never skips a card on
  // timeout: it closes the modal (Escape) and re-clicks the card's quick action, waiting again, until a value is
  // recorded or the run is stopped.
  // ============================================================
  function getAllCollectionCards() {
    const grid = document.querySelector("div.gap-3.justify-center");
    if (!grid) return null;

    return Array.from(grid.children);
  }

  // A favorite card (flagged by a button.text-amber-200) has no "Mettre aux enchères" button, so it can't be put up
  // for sale and its estimate can't be reached: bulk evaluations skip it
  function isFavoriteCollectionCard(card) {
    return card.querySelector("button.text-amber-200") !== null;
  }

  function getEvaluableCollectionCards() {
    const cards = getAllCollectionCards();
    if (cards === null) return null;

    return cards.filter((card) => !isFavoriteCollectionCard(card));
  }

  function getUnevaluatedCollectionCards() {
    const cards = getEvaluableCollectionCards();
    if (cards === null) return null;

    return cards.filter((card) => {
      const rarityEl = card.querySelector("div.top-2.left-2");
      if (!rarityEl) return false;

      const appendix = rarityEl.querySelector(":scope > .wm-eval-appendix");
      if (!appendix) return true;

      return appendix.textContent.trim() === `(${UNKNOWN_EVAL_VALUE})`;
    });
  }

  // Resolves true once a fresh value lands under "eval-{cardName}" (the
  // caller must have cleared that key beforehand so a stale value already
  // present can't be mistaken for a freshly recorded one), or false if
  // stopped/timed out first. The default timeout is only a fallback: evaluateCollectionCards, its sole caller,
  // always passes the configured delay (Feature CFG's "eval-timeouts").
  function waitForCardEvaluation(
    cardName,
    state,
    timeout = 8000,
    interval = 150,
  ) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (state.stopped) {
          resolve(false);
          return;
        }
        if (localStorage.getItem(`eval-${cardName}`) !== null) {
          resolve(true);
          return;
        }
        if (Date.now() - start >= timeout) {
          resolve(false);
          return;
        }
        setTimeout(check, interval);
      };
      check();
    });
  }

  function insertStopEvaluationButton(state) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wm-eval-stop";
    btn.append("Arrêter la reconnaissance");

    const note = document.createElement("span");
    note.className = "wm-eval-stop-note";
    note.textContent = "Les valeurs trouvées seront conservées";
    btn.appendChild(note);

    btn.addEventListener("click", () => {
      state.stopped = true;
    });

    document.body.appendChild(btn);
    return btn;
  }

  // Measured: evaluating 50 cards takes about 27 seconds in best case scenario, 237 at usual times
  const EVALUATION_SECONDS_PER_CARD__BEST = 27 / 50;
  const EVALUATION_SECONDS_PER_CARD__WORST = 237 / 50;

  function updateEvaluateUnratedButtonLabel(btn) {
    if (btn.disabled) return;

    const cards = getUnevaluatedCollectionCards();

    // Nothing left to evaluate on this page — no point offering the button at all.
    btn.style.display = cards !== null && cards.length === 0 ? "none" : "";

    const label =
      cards === null
        ? "Estimer les cartes non évaluées (chargement...)"
        : `Estimer les cartes non évaluées (${Math.round(cards.length * EVALUATION_SECONDS_PER_CARD__BEST)} – ${Math.round(cards.length * EVALUATION_SECONDS_PER_CARD__WORST)} s)`;

    if (btn.textContent === label) return;
    btn.textContent = label;
  }

  // Feature TBD (cont'd of EBC, off by default): once a batch evaluation has ended on "?" for a card, the market
  // modal is closed (div.max-w-lg button.absolute), "TBD" is typed into the card modal's tag input
  // (div.relative input) and submitted with Enter, then the card's active tags (div.space-y-2 div.gap-1.5) are
  // awaited until one <span> reads that tag. The tag is the "Étiquette « TBD »" setting of Feature CFG ("TBD" by default;
  // the drop-down offers the tag names Rule 41 remembered), read when each card is tagged. Cards that already carry any
  // tag are left untouched. Typing goes through the native value setter, like Rule 28's clearing.
  // Feature TBD (cont'd): the same machinery also tags cards by their new estimate, see tagCardForValueRanges below.
  function getTbdTag() {
    return getConfigValue(TBD_TAG_CONFIG_ID);
  }

  const CARD_TAG_CHIPS_SELECTOR = "div.space-y-2 div.gap-1\\.5 span";

  // Closes the market modal and waits for the card modal's tag input (div.relative input); null when it never shows
  async function openCardTagInput(state) {
    document.querySelector("div.max-w-lg button.absolute")?.click();

    const hasInput = await waitUntil(
      () => document.querySelector("div.relative input") !== null,
      state,
    );
    return hasInput ? document.querySelector("div.relative input") : null;
  }

  // The card's active tags, as the chips show them
  function readActiveCardTags() {
    return Array.from(document.querySelectorAll(CARD_TAG_CHIPS_SELECTOR)).map(
      (chip) => chip.textContent,
    );
  }

  // Types the tag into the card modal's tag input, submits it with Enter and waits for it to show among the chips
  async function addTagToCard(input, tag, state) {
    input.focus();
    NATIVE_INPUT_VALUE_SETTER.call(input, tag);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    for (const type of ["keydown", "keypress", "keyup"]) {
      input.dispatchEvent(
        new KeyboardEvent(type, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
        }),
      );
    }

    return waitUntil(
      () => readActiveCardTags().some((text) => text.includes(tag)),
      state,
    );
  }

  // Escape goes through the input (still focused, and bubbling up to the document) so the card modal closes right
  // away; evaluateCollectionCards then presses it once more on the document, which is harmless.
  async function closeCardModalFrom(input) {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  async function tagCardAsToBeDetermined() {
    const state = { stopped: false };
    const tbdTag = getTbdTag();

    const input = await openCardTagInput(state);
    if (!input) {
      logger(CPL.WARN, "TBD tagging: tag input not found");
      return;
    }

    // Only untagged cards get the TBD tag: any active tag already there (that one included) means leaving the card alone
    if (readActiveCardTags().length > 0) return;

    const tagged = await addTagToCard(input, tbdTag, state);
    if (tagged) logger(CPL.LOG, `Card tagged "${tbdTag}"`);
    else logger(CPL.WARN, `TBD tagging: tag "${tbdTag}" never showed up`);

    await closeCardModalFrom(input);
  }

  // Feature TBD (cont'd): the value ranges of the "Étiquettes automatiques selon l'estimation" setting of Feature CFG. A
  // card whose bulk evaluation ended on a number gets the tag of every range that contains it (min <= value <= max,
  // a blank bound being no bound at all). Ranges may overlap and may share a tag: all the matching ones count, each
  // distinct tag once; a range switched off in the settings is kept but not applied. A card is only touched if it has
  // no tag yet or carries at least one tag defined in the ranges (any range, switched on or not): the tags it carries
  // that the ranges define but that no longer match the new value are removed (the chip's button), then the missing
  // matching ones are added (a value that falls in no range only removes the outdated tag; the TBD tag counts as one of them). Cards carrying only
  // other tags are left alone.
  function getValueRangeTags(value) {
    const tags = [];
    getConfigValue(VALUE_RANGES_CONFIG_ID).forEach(
      ({ min, max, tag, enabled }) => {
        if (!enabled || !tag || tags.includes(tag)) return;
        if (min !== null && value < min) return;
        if (max !== null && value > max) return;
        tags.push(tag);
      },
    );
    return tags;
  }

  // Every tag the automatic tagging manages: the ranges' ones (switched on or not) and the "TBD" one, which a found
  // estimate makes outdated
  function getAllValueRangeTags() {
    const tags = getConfigValue(VALUE_RANGES_CONFIG_ID)
      .map(({ tag }) => tag)
      .filter(Boolean);
    const tbdTag = getTbdTag();
    if (tbdTag && !tags.includes(tbdTag)) tags.push(tbdTag);
    return tags;
  }

  // Clicks the remove button inside the chip reading that tag and waits for the chip to go; false when it never does
  async function removeTagFromCard(tag, state) {
    const chip = Array.from(
      document.querySelectorAll(CARD_TAG_CHIPS_SELECTOR),
    ).find((el) => el.textContent.includes(tag));
    const removeBtn = chip?.querySelector("button") ?? chip?.lastElementChild;
    if (!removeBtn) return false;

    removeBtn.click();
    return waitUntil(
      () => !readActiveCardTags().some((text) => text.includes(tag)),
      state,
    );
  }

  async function tagCardForValueRanges(value) {
    const tags = getValueRangeTags(value);
    // The card is opened even when the value falls in no range: the TBD or price tag it carries (if any) is outdated

    const state = { stopped: false };
    const input = await openCardTagInput(state);
    if (!input) {
      logger(CPL.WARN, "Value tagging: tag input not found");
      return;
    }

    const autoTags = getAllValueRangeTags();
    const isAuto = (text) => autoTags.some((tag) => text.includes(tag));
    const present = readActiveCardTags();
    if (present.length > 0 && !present.some(isAuto)) {
      logger(CPL.LOG, `Value tagging: card carries only other tags (${value})`);
      await closeCardModalFrom(input);
      return;
    }

    for (const tag of autoTags) {
      if (tags.includes(tag) || !present.some((text) => text.includes(tag))) {
        continue;
      }
      const removed = await removeTagFromCard(tag, state);
      if (removed) logger(CPL.LOG, `Card untagged "${tag}" (${value})`);
      else logger(CPL.WARN, `Value tagging: tag "${tag}" never went away`);
    }

    for (const tag of tags) {
      if (present.some((text) => text.includes(tag))) {
        logger(CPL.LOG, `Card already tagged "${tag}" (${value})`);
        continue;
      }

      const added = await addTagToCard(
        document.querySelector("div.relative input") ?? input,
        tag,
        state,
      );
      if (added) logger(CPL.LOG, `Card tagged "${tag}" (${value})`);
      else logger(CPL.WARN, `Value tagging: tag "${tag}" never showed up`);
    }

    await closeCardModalFrom(input);
  }

  // Feature EBC (cont'd): accepts an optional externally-owned state/stop-button instead of always creating its
  // own — used by the "Estimation en masse" button below to share a single stop button across a whole multi-page
  // run rather than spawning a new one for every page. The two original callers below don't pass one, so their
  // own behavior is unchanged.
  // Feature EBC (cont'd): waits for the quick action (Feature TBC) to report how it went. "timeout" means it never
  // did, which isn't treated as a failure: the estimate is simply waited for as usual.
  function waitForQuickActionOutcome(quickActionBtn, state, timeout = 1500) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const result = quickActionBtn.dataset.wmQuickActionResult;
        if (result && result !== "pending") {
          resolve(result);
          return;
        }
        if (state.stopped) {
          resolve("stopped");
          return;
        }
        if (Date.now() - start >= timeout) {
          resolve("timeout");
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  function getEvalMaxAttempts() {
    return getConfigValue(EVAL_MAX_ATTEMPTS_CONFIG_ID);
  }

  function getEvalTimeouts() {
    return getConfigValue(EVAL_TIMEOUTS_CONFIG_ID);
  }

  async function evaluateCollectionCards(button, cards, sharedState) {
    const state = sharedState ?? { stopped: false };
    const stopBtn = sharedState ? null : insertStopEvaluationButton(state);

    // Read once per run (a change applies from the next run, no reload needed)
    const maxAttempts = getEvalMaxAttempts();
    const timeouts = getEvalTimeouts();
    logger(
      CPL.INFO,
      `Evaluating ${cards.length} card(s), ${maxAttempts} attempt(s) per card, estimate wait ${timeouts.first} ms / ${timeouts.retry} ms (first attempt / retries)`,
    );
    const skipped = [];
    for (let i = 0; i < cards.length; i++) {
      if (state.stopped) break;

      const card = cards[i];
      const cardName = card.querySelector("h3")?.textContent.trim();
      const quickActionBtn = card.querySelector(".wm-quick-action");
      if (!cardName || !quickActionBtn) continue;
      if (isFavoriteCollectionCard(card)) {
        // A card can become a favorite while the run is under way
        logger(CPL.LOG, `Favorite card skipped: "${cardName}"`);
        continue;
      }

      const key = `eval-${cardName}`;
      const previousValue = localStorage.getItem(key);
      localStorage.removeItem(key);

      button.textContent = `Évaluation... (${i + 1}/${cards.length})`;
      quickActionBtn.click();

      // A timed-out attempt (estimate not there after timeouts.first ms, then timeouts.retry ms, both configurable) closes the modal and re-opens it, up to maxAttempts attempts (configurable). A card whose quick
      // action reports it can't be sold (no sell button, no image), that left the page, or that still has no
      // estimate after the last attempt is skipped, so one bad card can't hold the whole run up.
      let recorded = false;
      let skipReason = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          logger(
            CPL.WARN,
            `No estimate yet for "${cardName}" (attempt ${attempt - 1}/${maxAttempts}), reopening its modal`,
          );
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (state.stopped) break;
          if (!card.isConnected) {
            skipReason = "the card left the page";
            break;
          }
          (card.querySelector(".wm-quick-action") ?? quickActionBtn).click();
        }

        const outcome = await waitForQuickActionOutcome(quickActionBtn, state);
        if (outcome === "no-image" || outcome === "no-sell-button") {
          skipReason = `quick action: ${outcome}`;
          break;
        }
        if (state.stopped) break;

        recorded = await waitForCardEvaluation(
          cardName,
          state,
          attempt === 1 ? timeouts.first : timeouts.retry,
        );
        if (recorded || state.stopped) break;
      }
      if (!recorded && !state.stopped) {
        skipped.push(cardName);
        logger(
          CPL.WARN,
          `Card skipped: "${cardName}" (${skipReason ?? `no estimate after ${maxAttempts} attempts`})`,
        );
      }
      if (!recorded && previousValue !== null) {
        localStorage.setItem(key, previousValue);
      }

      if (recorded && readFeatureFlags()["feature-tbd"]) {
        if (localStorage.getItem(key) === UNKNOWN_EVAL_VALUE) {
          await tagCardAsToBeDetermined();
        } else {
          const value = getCardEvalValueByName(cardName);
          if (value !== null) await tagCardForValueRanges(value);
        }
      }

      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );

      if (state.stopped) break;
    }

    logger(
      CPL.INFO,
      `Card evaluation ${state.stopped ? "stopped" : "complete"}${skipped.length ? `, ${skipped.length} skipped` : ""}`,
      skipped,
    );
    stopBtn?.remove();
  }

  async function evaluateUnratedCollectionCards(button, otherButton) {
    const cards = getUnevaluatedCollectionCards() ?? [];
    await evaluateCollectionCards(button, cards);

    button.disabled = false;
    otherButton.disabled = false;
    updateEvaluateUnratedButtonLabel(button);
  }

  async function reevaluateAllCollectionCards(button, otherButton) {
    const originalLabel = button.textContent;
    const cards = getEvaluableCollectionCards() ?? [];

    await evaluateCollectionCards(button, cards);

    button.textContent = originalLabel;
    button.disabled = false;
    otherButton.disabled = false;
    updateEvaluateUnratedButtonLabel(otherButton);
  }

  // ============================================================
  // Feature EBC (cont'd): a fourth button, "Estimation en masse" (styled red, unlike its other three siblings
  // which just inherit the site's own filter-button look) — walks every page of the collection in turn, running
  // the same "evaluate unrated cards" pass as the "Estimer les cartes non évaluées" button on each one. A single
  // stop button/state is shared across the whole run (evaluateCollectionCards's sharedState parameter, above)
  // rather than spawning a new one per page. Between pages, the pagination control's second child button
  // (div.gap-2.py-3 — the first is "previous page") is clicked once it stops being disabled: it can briefly stay
  // disabled right after our own last Escape keypress closes a card's modal, so this is polled rather than clicked
  // immediately; staying disabled for the whole poll window instead means there simply is no next page, which ends
  // the run normally rather than erroring. After clicking, the run waits for the grid's first card to actually
  // change before evaluating the newly-loaded page — the site's own transition isn't instant, and evaluating the
  // outgoing page's still-visible cards a second time would waste a full pass for nothing.
  // ============================================================
  function waitUntil(predicate, state, timeout = 8000, interval = 150) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (state.stopped) {
          resolve(false);
          return;
        }
        if (predicate()) {
          resolve(true);
          return;
        }
        if (Date.now() - start >= timeout) {
          resolve(false);
          return;
        }
        setTimeout(check, interval);
      };
      check();
    });
  }

  function getCollectionNextPageButton() {
    const container = document.querySelector("div.gap-2.py-3");
    if (!container) return null;

    return Array.from(container.querySelectorAll(":scope > button"))[1] ?? null;
  }

  function getFirstCollectionCardName() {
    return (
      getAllCollectionCards()?.[0]?.querySelector("h3")?.textContent.trim() ??
      null
    );
  }

  async function evaluateAllCollectionPages(button, otherButtons) {
    const state = { stopped: false };
    const stopBtn = insertStopEvaluationButton(state);

    let page = 1;
    logger(CPL.INFO, "Full-collection evaluation started");
    while (!state.stopped) {
      button.textContent = `Estimation en masse... (page ${page})`;
      logger(CPL.LOG, `Full-collection evaluation: page ${page}`);

      const cards = getUnevaluatedCollectionCards() ?? [];
      await evaluateCollectionCards(button, cards, state);
      if (state.stopped) break;

      const nextBtn = getCollectionNextPageButton();
      if (!nextBtn) break;

      const canAdvance = await waitUntil(() => !nextBtn.disabled, state, 5000);
      if (!canAdvance || state.stopped) break;

      const previousFirstCardName = getFirstCollectionCardName();
      nextBtn.click();
      page++;

      await waitUntil(() => {
        const firstName = getFirstCollectionCardName();
        return firstName !== null && firstName !== previousFirstCardName;
      }, state);
    }

    logger(
      CPL.INFO,
      `Full-collection evaluation ${state.stopped ? "stopped" : "complete"} (${page} page(s))`,
    );
    stopBtn.remove();
    button.textContent = "🗃️📈";
    button.disabled = false;
    otherButtons.forEach((btn) => {
      btn.disabled = false;
    });
  }

  // Reads a card's raw eval value straight from localStorage (not its
  // formatted rarity-tag appendix, which loses precision to "💩"/"X K"),
  // returning null when it's missing or the "?" unknown marker
  function getCardEvalValueByName(cardName) {
    const raw = localStorage.getItem(`eval-${cardName}`);
    if (raw === null || raw === UNKNOWN_EVAL_VALUE) return null;

    const num = parseFloat(raw.replace(/\s/g, "").replace(",", "."));
    return Number.isNaN(num) ? null : num;
  }

  function getCardEvalValue(card) {
    const cardName = card.querySelector("h3")?.textContent.trim();
    if (!cardName) return null;

    return getCardEvalValueByName(cardName);
  }

  function sortCollectionByPriceDescending() {
    const grid = document.querySelector("div.gap-3.justify-center");
    if (!grid) return;

    const sorted = Array.from(grid.children)
      .map((card, index) => ({ card, index, value: getCardEvalValue(card) }))
      .sort((a, b) => {
        if (a.value === null && b.value === null) return a.index - b.index;
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        return b.value - a.value;
      })
      .map((entry) => entry.card);

    grid.append(...sorted);
  }

  // Reads the number of pages left to go off the pagination indicator's whole text ("Page 1 / 92" -> 92 - 1 = 91);
  // null when the indicator isn't on screen (yet) or doesn't read "{current} / {max}".
  const COLLECTION_PAGE_INDICATOR_SELECTOR =
    "span.text-\\[var\\(--color-foreground\\)\\]\\/40";

  function getCollectionPagesLeft() {
    for (const span of document.querySelectorAll(
      COLLECTION_PAGE_INDICATOR_SELECTOR,
    )) {
      const match = span.textContent.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) return parseInt(match[2], 10) - parseInt(match[1], 10) + 1; // +1 because the current
    }
    return null;
  }

  function updateMassButtonLabel(btn) {
    // Disabled while a run is in progress, when the button shows that run's own progress text instead
    if (!btn || btn.disabled) return;

    const pagesLeft = getCollectionPagesLeft();
    const label =
      pagesLeft === null
        ? "Estimation complète 🗃️"
        : `Estimation complète 🗃️ (>${pagesLeft} min)`;
    if (btn.textContent !== label) btn.textContent = label;
  }

  function insertEvaluateUnratedButton() {
    if (!window.location.pathname.startsWith("/collection")) return;

    const filterBar = document.querySelector("div.flex-wrap.gap-2");
    if (!filterBar) return;

    // The action buttons live in a dock (div.wm-eval-dock) pushed to the end of the filter row
    let unratedBtn = filterBar.querySelector(
      ":scope > .wm-eval-dock > .wm-eval-unrated",
    );
    if (!unratedBtn) {
      const referenceBtn = filterBar.querySelector("button");
      const baseClass = referenceBtn
        ? referenceBtn.className.replace("px-3", "px-1")
        : "";

      const reevaluateBtn = document.createElement("button");
      reevaluateBtn.type = "button";
      reevaluateBtn.className = baseClass
        ? `${baseClass} wm-eval-reevaluate-all`
        : "wm-eval-reevaluate-all";
      reevaluateBtn.textContent = "Ré-estimer la page";

      unratedBtn = document.createElement("button");
      unratedBtn.type = "button";
      unratedBtn.className = baseClass
        ? `${baseClass} wm-eval-unrated`
        : "wm-eval-unrated";

      const sortBtn = document.createElement("button");
      sortBtn.type = "button";
      sortBtn.className = baseClass
        ? `${baseClass} wm-eval-sort`
        : "wm-eval-sort";
      sortBtn.textContent = "Ordonner la page par prix";

      const massBtn = document.createElement("button");
      massBtn.type = "button";
      massBtn.className = "wm-eval-mass";
      massBtn.title = "Estimation en masse de toutes les pages";

      reevaluateBtn.addEventListener("click", () => {
        if (reevaluateBtn.disabled) return;
        reevaluateBtn.disabled = true;
        unratedBtn.disabled = true;
        massBtn.disabled = true;
        reevaluateAllCollectionCards(reevaluateBtn, unratedBtn).then(() => {
          massBtn.disabled = false;
        });
      });

      unratedBtn.addEventListener("click", () => {
        if (unratedBtn.disabled) return;
        unratedBtn.disabled = true;
        reevaluateBtn.disabled = true;
        massBtn.disabled = true;
        evaluateUnratedCollectionCards(unratedBtn, reevaluateBtn).then(() => {
          massBtn.disabled = false;
        });
      });

      sortBtn.addEventListener("click", () => {
        sortCollectionByPriceDescending();
      });

      massBtn.addEventListener("click", () => {
        if (massBtn.disabled) return;
        massBtn.disabled = true;
        reevaluateBtn.disabled = true;
        unratedBtn.disabled = true;
        evaluateAllCollectionPages(massBtn, [reevaluateBtn, unratedBtn]);
      });

      const dock = document.createElement("div");
      dock.className = "wm-eval-dock";
      dock.append(massBtn, reevaluateBtn, unratedBtn, sortBtn);
      filterBar.appendChild(dock);
    }

    updateEvaluateUnratedButtonLabel(unratedBtn);
    updateMassButtonLabel(
      filterBar.querySelector(":scope > .wm-eval-dock > .wm-eval-mass"),
    );

    // The site's own rarity filter buttons (button.px-3.py-1.transition-colors) can be (re)inserted after ours —
    // e.g. a new rarity tier showing up appends its filter button at the end of filterBar, past our controls.
    // Move any such button back to where it belongs: grouped with the other filter buttons, ahead of our dock.
    const dock = filterBar.querySelector(":scope > .wm-eval-dock");
    if (dock) {
      Array.from(
        filterBar.querySelectorAll(
          ":scope > button.px-3.py-1.transition-colors",
        ),
      )
        .filter(
          (btn) =>
            dock.compareDocumentPosition(btn) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        )
        .forEach((btn) => filterBar.insertBefore(btn, dock));
    }
  }

  function watchEvaluateUnratedButton() {
    addStyle(`
      .wm-eval-stop {
        position: absolute;
        top: 1rem;
        right: 1rem;
        z-index: 999;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.15rem;
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 0.5rem;
        background: #dc26265f;
        color: #fff;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        opacity: 0.8;
        transition: background-color 0.2s ease, opacity 0.2s ease;
      }
      .wm-eval-stop:hover {
        background: #b91c1c;
        opacity: 1;
      }
      .wm-eval-stop-note {
        font-size: 0.7rem;
        font-weight: 400;
        opacity: 0.85;
      }
      .wm-eval-dock {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        margin-left: auto;
      }
      .wm-eval-mass {
        border: none;
        border-radius: 0.5rem;
        padding: 0.25rem 0.5rem;
        margin-right: 0.25rem;
        background: #8c0606;
        opacity: 0.5;
        color: #fff;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s ease, opacity 0.2s ease;
      }
      .wm-eval-mass:hover {
        background: #b91c1c;
        opacity: 1;
      }
      .wm-eval-mass:disabled {
        cursor: default;
        opacity: 0.6;
      }
    `);

    insertEvaluateUnratedButton();

    const observer = new MutationObserver(() => insertEvaluateUnratedButton());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 20: on /collection and /pulls, inside the card modal (div.card-frame.p-6), when keyboard navigation changes
  // which li in ul.absolute carries aria-selected="true", scroll that item into view so the list's scroll follows the
  // active element
  // ============================================================
  function scrollActiveCardModalListItemIntoView(mutation) {
    if (
      !window.location.pathname.startsWith("/collection") &&
      !window.location.pathname.startsWith("/pulls")
    )
      return;

    if (mutation.attributeName !== "aria-selected") return;

    const target = mutation.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.getAttribute("aria-selected") !== "true") return;
    if (!target.closest("div.card-frame.p-6 ul.absolute")) return;

    target.scrollIntoView({ block: "nearest" });
  }

  function watchCardModalListScroll() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(scrollActiveCardModalListItemIntoView);
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-selected"],
      subtree: true,
    });
  }

  // ============================================================
  // Rule 21: on /collection and /pulls, when the card modal (div.card-frame.p-6) opens, hide
  // p.leading-snug.text-[10px] (the legal mentions paragraph). Hidden via "display: none" rather than removed:
  // React still owns and re-renders this node, so actually detaching it (Node.remove()) races React's own
  // reconciliation and can throw "removeChild: the node to be removed is not a child of this node" the moment
  // React tries to update/unmount it too — the same class of race already called out in Feature TMB. Also, with
  // that paragraph gone, a.inline-flex (the link that used to sit right below it) is left with the gap that
  // paragraph's own margin used to provide — replace it with "m-0 mt-5" so its spacing doesn't collapse.
  // ============================================================
  function hideCardModalLegalMentions() {
    if (
      !window.location.pathname.startsWith("/collection") &&
      !window.location.pathname.startsWith("/pulls")
    )
      return;

    const modal = document.querySelector("div.card-frame.p-6");
    if (!modal || modal.dataset.wmLegalHidden === "true") return;

    modal.dataset.wmLegalHidden = "true";

    setTimeout(() => {
      const legalMentions = modal.querySelector(
        "p.leading-snug.text-\\[10px\\]",
      );
      if (legalMentions) legalMentions.style.display = "none";

      const link = modal.querySelector("a.inline-flex");
      if (link) {
        link.classList.add("m-0", "mt-5");
        link.parentElement?.classList.add("mt-auto");
      }
    }, 250);
  }

  function watchCardModalLegalMentions() {
    hideCardModalLegalMentions();

    const observer = new MutationObserver(() => hideCardModalLegalMentions());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature CNC: append a small copy-to-clipboard button right inside a card name element, in three contexts:
  //   - the card modal (div.card-frame.p-6)'s own name heading (h2.text-xl), on /pulls, /collection and
  //     /global-collection
  //   - the auction modal's name (p.truncate — the same element Feature ETS already reads the card name from),
  //     on /pulls and /collection only
  //   - the bid page's own name heading (h1.flex-1 — the same element Feature BSP's badge group hangs off of),
  //     on /marketplace/{UUID}
  // Clicking either copies that card's name to the clipboard and briefly swaps the icon for a check mark as
  // feedback. The button is always prepended into its name element, ahead of the (often long, truncated) name
  // text. Re-inserted on every mutation rather than guarded by a one-time flag: navigating between cards inside
  // an already-open modal (Rule 20's keyboard navigation), or between bid pages, re-renders the name element's
  // own children, which would otherwise silently drop our button.
  // ============================================================
  function insertCopyButtonInto(nameEl) {
    if (nameEl.querySelector(":scope > .wm-copy-name")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wm-copy-name";
    btn.textContent = "📋";
    btn.title = "Copier le nom de la carte";

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const cardName = Array.from(nameEl.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join("")
        .trim();
      navigator.clipboard.writeText(cardName).then(() => {
        btn.textContent = "✅";
        setTimeout(() => {
          btn.textContent = "📋";
        }, 1000);
      });
    });

    nameEl.prepend(btn);
  }

  function insertCardNameCopyButtons() {
    const onPulls = window.location.pathname.startsWith("/pulls");
    const onCollection = window.location.pathname.startsWith("/collection");
    const onGlobalCollection =
      window.location.pathname.startsWith("/global-collection");

    if (onPulls || onCollection || onGlobalCollection) {
      const modalName = document.querySelector(
        "div.card-frame.p-6 h2.text-xl.pr-10",
      );
      if (modalName) insertCopyButtonInto(modalName);
    }

    if (onPulls || onCollection) {
      const auctionModalName = document.querySelector("p.truncate");
      if (auctionModalName) insertCopyButtonInto(auctionModalName);
    }

    if (MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname)) {
      const bidPageName = document.querySelector("h1.flex-1");
      if (bidPageName) insertCopyButtonInto(bidPageName);
    }
  }

  function watchCardModalNameCopyButton() {
    addStyle(`
      .wm-copy-name {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 0.9rem;
        opacity: 0.75;
        vertical-align: middle;
        transition: opacity 0.15s ease;
      }
      .wm-copy-name:hover {
        opacity: 1;
      }
    `);

    insertCardNameCopyButtons();

    const observer = new MutationObserver(() => insertCardNameCopyButtons());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 22: on all pages, whenever div.animate-spin exists anywhere in the DOM, position it at the exact center
  // of <main>. Also, on a bid page (/marketplace/{UUID}) specifically, whenever a div contains the text "Enchère
  // introuvable", rewrite it (once) to add a line break and a hint to wait a few seconds or refresh the page, and
  // center that div too. That message search used to run unscoped on every page — findInnermostDivContainingText
  // scans the whole document — which meant a stale "Enchère introuvable" fragment left mounted elsewhere by the site's
  // own router (e.g. during a page transition) could get rewritten/repositioned on top of totally unrelated pages,
  // like /pulls. Either target is skipped if it carries the animate-fade-in-up class (the site's own page-entrance
  // wrapper, which also picks up animate-spin during the /pulls loading transition): forcing it into position:absolute
  // pulls it out of the layout it's meant to animate within.
  // ============================================================
  const AUCTION_NOT_FOUND_PHRASE = "Enchère introuvable";

  function centerElementInMain(el) {
    if (el.classList.contains("animate-fade-in-up")) return;

    // Centering via `transform: translate(-50%, -50%)` would collide with
    // div.animate-spin's own `transform: rotate(...)` keyframe animation: both
    // write to the same `transform` property, so the browser interpolates
    // from our translate to the keyframe's rotate instead of just spinning in
    // place, dragging the element away from center over each animation cycle.
    // Margins avoid touching `transform` altogether.
    el.style.position = "absolute";
    el.style.top = "50%";
    el.style.left = "50%";
    el.style.marginTop = `${-el.offsetHeight / 2}px`;
    el.style.marginLeft = `${-el.offsetWidth / 2}px`;
  }

  function findInnermostDivContainingText(text) {
    // Skips the script's own modals (settings, tutorials), whose labels can quote the searched phrase
    const matches = Array.from(document.querySelectorAll("div")).filter(
      (div) =>
        div.textContent.includes(text) && !div.closest(".wm-settings-overlay"),
    );
    return matches.find(
      (div) => !matches.some((other) => other !== div && div.contains(other)),
    );
  }

  function centerSpinnerAndAuctionNotFoundInMain() {
    const main = document.querySelector("main");
    if (!main) return;

    document
      .querySelectorAll("div.animate-spin")
      .forEach((spinner) => centerElementInMain(spinner));

    if (!MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname)) return;

    const auctionNotFoundTextDiv = findInnermostDivContainingText(
      AUCTION_NOT_FOUND_PHRASE,
    );
    if (auctionNotFoundTextDiv) {
      centerElementInMain(auctionNotFoundTextDiv);

      if (auctionNotFoundTextDiv.dataset.wmReloadHintAdded !== "true") {
        auctionNotFoundTextDiv.dataset.wmReloadHintAdded = "true";
        auctionNotFoundTextDiv.textContent = "";
        auctionNotFoundTextDiv.append(
          "Enchère introuvable.",
          document.createElement("br"),
          "Attendez quelques secondes ou rafraîchissez la page.",
        );
      }
    }
  }

  function watchSpinnerAndAuctionNotFoundCentering() {
    addStyle(`
      main {
        position: relative;
      }
    `);

    centerSpinnerAndAuctionNotFoundInMain();

    const observer = new MutationObserver(() =>
      centerSpinnerAndAuctionNotFoundInMain(),
    );
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature FIS: on /pulls (div.text-center.animate-fade-in-up), /friends (div.flex.animate-fade-in-up),
  // /guild (div.animate-fade-in-up.justify-between), and /achievements (div.animate-fade-in-up, no companion
  // class) — same wrapper class, different companion class per page — the page's own load-transition wrapper
  // keeps ending up with an inline style — not one this script deliberately sets on it (Rule 22's own centering
  // logic explicitly skips this class) — so this clears whatever got set on it as soon as it shows up, rather
  // than it drifting out of its normal layout flow. Split out from Rule 22 once the same drift showed up on
  // /friends (then /guild, then /achievements) too: unlike Rule 22, this fix isn't "on all pages" and doesn't
  // belong under its numbering.
  //
  // Feature FIS (cont'd): the same drift hits /profile (own and others'), but there only the div.animate-fade-in-up
  // that contains the page's h1.text-2xl heading is affected — the page's other animate-fade-in-up blocks are left
  // alone.
  // ============================================================
  function clearFadeInUpInlineStyle() {
    const path = window.location.pathname;

    if (path.startsWith("/profile")) {
      document.querySelectorAll("div.animate-fade-in-up").forEach((el) => {
        if (el.querySelector("h1.text-2xl")) el.removeAttribute("style");
      });
      return;
    }

    if (
      !path.startsWith("/pulls") &&
      !path.startsWith("/friends") &&
      !path.startsWith("/guild") &&
      !path.startsWith("/achievements")
    )
      return;

    document
      .querySelectorAll("div.animate-fade-in-up")
      .forEach((el) => el.removeAttribute("style"));
  }

  function watchFadeInUpInlineStyleCleanup() {
    clearFadeInUpInlineStyle();

    const observer = new MutationObserver(() => clearFadeInUpInlineStyle());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 23: replace every link[rel~="icon"] in <head> with a custom favicon. The site keeps re-asserting its own
  // favicon (on load and on route changes), so a one-shot apply gets silently overwritten — this observes <head>
  // and reapplies FAVICON_URI whenever it drifts. Guarded by an equality check so our own href writes (which are
  // themselves mutations) don't retrigger the observer in a loop.
  // ============================================================
  // Embedded as a base64 data URI (from wikimasterbetter-logo.svg) rather than a file:// path: browsers
  // block loading local file:// resources as subresources of an https:// page, so that never actually works.
  const FAVICON_URI =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgMjAwIDIwMCIgeG1sbnM6YzJwYT0iaHR0cDovL2MycGEub3JnL21hbmlmZXN0Ij48bWV0YWRhdGE+PGMycGE6bWFuaWZlc3Q+QUFBV2dtcDFiV0lBQUFBZWFuVnRaR015Y0dFQUVRQVFnQUFBcWdBNG0zRURZekp3WVFBQUFCWmNhblZ0WWdBQUFFZHFkVzFrWXpKdFlRQVJBQkNBQUFDcUFEaWJjUU4xY200Nll6SndZVHBtT1dOaVpqVTNPQzFpTkRFeExUUXhNamt0T1RoaFpDMHdPRFl4TlRZNFpqSTJObUVBQUFBRGwycDFiV0lBQUFBcGFuVnRaR015WVhNQUVRQVFnQUFBcWdBNG0zRURZekp3WVM1aGMzTmxjblJwYjI1ekFBQUFBTHhxZFcxaUFBQUFSR3AxYldSalltOXlBQkVBRUlBQUFLb0FPSnR4RTJNeWNHRXVhVzVuY21Wa2FXVnVkQzUyTXdBQUFBQVlZekp6YUtiSk9tcUNCUDVwRUFWY01tTHpsUEFBQUFCd1kySnZjcU5wWkdNNlptOXliV0YwYldsdFlXZGxMM04yWnl0NGJXeHFhVzV6ZEdGdVkyVkpSSGdzZUcxd09tbHBaRHBrWTJRNU1qa3hZaTAxTVdRekxUUXlZekl0WW1FelpDMWtNalk1TldNMFlqZzJOVGxzY21Wc1lYUnBiMjV6YUdsd2FIQmhjbVZ1ZEU5bUFBQUI0bXAxYldJQUFBQkJhblZ0WkdOaWIzSUFFUUFRZ0FBQXFnQTRtM0VUWXpKd1lTNWhZM1JwYjI1ekxuWXlBQUFBQUJoak1uTm94b2lLZjIrbmtsMTJLVE5vLzFDUXZnQUFBWmxqWW05eW9tZGhZM1JwYjI1emdxSm1ZV04wYVc5dWEyTXljR0V1YjNCbGJtVmthbkJoY21GdFpYUmxjbk9oYTJsdVozSmxaR2xsYm5SemdhSmpkWEpzZUMxelpXeG1JMnAxYldKbVBXTXljR0V1WVhOelpYSjBhVzl1Y3k5ak1uQmhMbWx1WjNKbFpHbGxiblF1ZGpOa2FHRnphRmdnVXA5NjkwK1QxMGljb2VITy94a0xtNUpDcDh2M0NiWVl3cDg0S05OdlpHR2tabUZqZEdsdmJuZ2RZMjl0TG1GdWRHaHliM0JwWXk1amJHRjFaR1V1Y0hKdmRtbGtaV1JxY0dGeVlXMWxkR1Z5YzZGNEgyTnZiUzVoYm5Sb2NtOXdhV011YjNKcFoybHVMV052Ym1acFpHVnVZMlZuZFc1cmJtOTNibXRrWlhOamNtbHdkR2x2Ym5obVEyeGhkV1JsSUhCeWIzWnBaR1ZrSUhSb2FYTWdabWxzWlNCaGRDQjBhR1VnY21WeGRXVnpkQ0J2WmlCaElIVnpaWElnWVc1a0lHMWhlU0JvWVhabElHTnlaV0YwWldRZ2IzSWdiVzlrYVdacFpXUWdkR2hsSUdacGJHVWdZMjl1ZEdWdWRITXViWE52Wm5SM1lYSmxRV2RsYm5TaFpHNWhiV1ZtUTJ4aGRXUmxjbUZzYkVGamRHbHZibk5KYm1Oc2RXUmxaUFVBQUFESWFuVnRZZ0FBQUVCcWRXMWtZMkp2Y2dBUkFCQ0FBQUNxQURpYmNSTmpNbkJoTG1oaGMyZ3VaR0YwWVFBQUFBQVlZekp6YUVGeit3QUNJdVhxOStkVUVSaUtrQ1lBQUFDQVkySnZjcVZqWVd4blpuTm9ZVEkxTm1Od1lXUk5BQUFBQUFBQUFBQUFBQUFBQUdSb1lYTm9XQ0FuYUw1b2N3MzNFcjRVVDZSZjVScCtFdjRtM3dkTGcwYWN2VUpsT2YzYkpXUnVZVzFsYm1wMWJXSm1JRzFoYm1sbVpYTjBhbVY0WTJ4MWMybHZibk9Cb21WemRHRnlkQmlXWm14bGJtZDBhQmtlQkFBQUFqNXFkVzFpQUFBQUoycDFiV1JqTW1Oc0FCRUFFSUFBQUtvQU9KdHhBMk15Y0dFdVkyeGhhVzB1ZGpJQUFBQUNEMk5pYjNLbFkyRnNaMlp6YUdFeU5UWnBjMmxuYm1GMGRYSmxlRTF6Wld4bUkycDFiV0ptUFM5ak1uQmhMM1Z5Ympwak1uQmhPbVk1WTJKbU5UYzRMV0kwTVRFdE5ERXlPUzA1T0dGa0xUQTROakUxTmpobU1qWTJZUzlqTW5CaExuTnBaMjVoZEhWeVpXcHBibk4wWVc1alpVbEVlQ3g0YlhBNmFXbGtPalEwWXpFNVlURTNMVGszT1dNdE5EWmlaUzA1TkdOakxUZGlaR1l6WWpGak9USTNOSEpqY21WaGRHVmtYMkZ6YzJWeWRHbHZibk9Eb21OMWNteDRMWE5sYkdZamFuVnRZbVk5WXpKd1lTNWhjM05sY25ScGIyNXpMMk15Y0dFdWFXNW5jbVZrYVdWdWRDNTJNMlJvWVhOb1dDQlNuM3IzVDVQWFNKeWg0YzcvR1F1YmtrS255L2NKdGhqQ256Z28wMjlrWWFKamRYSnNlQ3B6Wld4bUkycDFiV0ptUFdNeWNHRXVZWE56WlhKMGFXOXVjeTlqTW5CaExtRmpkR2x2Ym5NdWRqSmthR0Z6YUZnZ3NZOGZOU3ZaempmWUFkYmd4WE95OXB4N3NuYWVFcFBKM3BMQzJkT1AwK3FpWTNWeWJIZ3BjMlZzWmlOcWRXMWlaajFqTW5CaExtRnpjMlZ5ZEdsdmJuTXZZekp3WVM1b1lYTm9MbVJoZEdGa2FHRnphRmdna20wSVhUcmRrOW9lSkRQMm9xZ1lmQjVTSXpQYjV1dUFaR3dITUhRWjYzZDBZMnhoYVcxZloyVnVaWEpoZEc5eVgybHVabStqWkc1aGJXVnZRVzUwYUhKdmNHbGpJRVpwYkdWelozWmxjbk5wYjI1bE1TNHdMakJyYzNCbFkxWmxjbk5wYjI1bE1pNDBMakFBQUJBNGFuVnRZZ0FBQUNocWRXMWtZekpqY3dBUkFCQ0FBQUNxQURpYmNRTmpNbkJoTG5OcFoyNWhkSFZ5WlFBQUFCQUlZMkp2Y3RLRVdRSVNvZ0VtR0NGWkFnb3dnZ0lHTUlJQmphQURBZ0VDQWhSQTVhQUs3c0k1MEw2NGcvb0dRZ1U5WjFVVEFEQUtCZ2dxaGtqT1BRUURBekJKTVJjd0ZRWURWUVFLRXc1QmJuUm9jbTl3YVdNc0lGQkNRekV1TUN3R0ExVUVBeE1sUVc1MGFISnZjR2xqSUVOdmJuUmxiblFnUTNKbFpHVnVkR2xoYkhNZ1VtOXZkQ0JEUVRBZUZ3MHlOakE0TURjeE9EUXpOVFphRncweU9EQTRNRFl4T1RRek5UWmFNRVF4RnpBVkJnTlZCQW9URGtGdWRHaHliM0JwWXl3Z1VFSkRNU2t3SndZRFZRUURFeUJCYm5Sb2NtOXdhV01nUTJ4aGRXUmxJRU52Ym5SbGJuUWdVMmxuYm1sdVp6QlpNQk1HQnlxR1NNNDlBZ0VHQ0NxR1NNNDlBd0VIQTBJQUJKaDZDbXZMVUJnRkZOVTB2VUtsT1Z0RTZkamQxN0w1U3V3WDBMZW1GaXNCTTNka2QvM2N5anhGQTNRbzVTNDZmWDAvaWhZMFZaN21mYjlLRjcwM3Q1T2pXREJXTUE0R0ExVWREd0VCL3dRRUF3SUhnREFWQmdOVkhTVUVEakFNQmdvckJnRUVBWVBvWGdJQk1Bd0dBMVVkRXdFQi93UUNNQUF3SHdZRFZSMGpCQmd3Rm9BVXpsSGlCSUZPWkZzaitPUEV6NW8rbk1IWFhNSXdDZ1lJS29aSXpqMEVBd01EWndBd1pBSXdNWE1kRko0QmV0TExWWTdPUnVFOW5vcWJiQVpPWm4vYUFyWHlUd0ZBWmZLclB6eEYydlBvSk5mMStVQ2RnMVhHQWpCd1gxemQ5V0dxWWtxbUw1U0ZxdzFReVNqcjF6SmZwSk05KzFyZER3U1BMTU9QT2pLdWlYam9VL3BVVWVHOVJ3bWhZM0JoWkZrTm5nQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBUFpZUU9zOVlaUWFVcXA2VUJFUjJJQWo1blZWUXBvNkswOEh4MjlVam1uNFI1UmJVN0hBWHJPUGpTM2RsUEc3MWc1a2gxTVBsejZpQm5Fb2FGNWtpU01Tem1nPTwvYzJwYTptYW5pZmVzdD48L21ldGFkYXRhPgo8ZGVmcz48Y2xpcFBhdGggaWQ9ImMiPjxwYXRoIGQ9Ik01MiA0NUg4Ni43NzFBMjAgMjAgMCAxIDEgMTEzLjIyOSA0NUgxNDhBNyA3IDAgMCAxIDE1NSA1MlY4Ni43NzFBMjAgMjAgMCAxIDEgMTU1IDExMy4yMjlWMTQ4QTcgNyAwIDAgMSAxNDggMTU1SDExMy4yMjlBMjAgMjAgMCAxIDEgODYuNzcxIDE1NUg1MkE3IDcgMCAwIDEgNDUgMTQ4VjExMy4yMjlBMjAgMjAgMCAxIDEgNDUgODYuNzcxVjUyQTcgNyAwIDAgMSA1MiA0NVoiPjwvcGF0aD48L2NsaXBQYXRoPjwvZGVmcz4KPHBhdGggZD0iTTUyIDQ1SDg2Ljc3MUEyMCAyMCAwIDEgMSAxMTMuMjI5IDQ1SDE0OEE3IDcgMCAwIDEgMTU1IDUyVjg2Ljc3MUEyMCAyMCAwIDEgMSAxNTUgMTEzLjIyOVYxNDhBNyA3IDAgMCAxIDE0OCAxNTVIMTEzLjIyOUEyMCAyMCAwIDEgMSA4Ni43NzEgMTU1SDUyQTcgNyAwIDAgMSA0NSAxNDhWMTEzLjIyOUEyMCAyMCAwIDEgMSA0NSA4Ni43NzFWNTJBNyA3IDAgMCAxIDUyIDQ1WiIgZmlsbD0iI2M3OWI0NSIgc3Ryb2tlPSIjYzc5YjQ1IiBzdHJva2Utd2lkdGg9IjEyIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48L3BhdGg+CjxwYXRoIGQ9Ik01MiA0NUg4Ni43NzFBMjAgMjAgMCAxIDEgMTEzLjIyOSA0NUgxNDhBNyA3IDAgMCAxIDE1NSA1MlY4Ni43NzFBMjAgMjAgMCAxIDEgMTU1IDExMy4yMjlWMTQ4QTcgNyAwIDAgMSAxNDggMTU1SDExMy4yMjlBMjAgMjAgMCAxIDEgODYuNzcxIDE1NUg1MkE3IDcgMCAwIDEgNDUgMTQ4VjExMy4yMjlBMjAgMjAgMCAxIDEgNDUgODYuNzcxVjUyQTcgNyAwIDAgMSA1MiA0NVoiIGZpbGw9IiMwZTBlMGUiIHN0cm9rZT0iIzBlMGUwZSIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48L3BhdGg+CjxwYXRoIGQ9Ik01MiA0NUg4Ni43NzFBMjAgMjAgMCAxIDEgMTEzLjIyOSA0NUgxNDhBNyA3IDAgMCAxIDE1NSA1MlY4Ni43NzFBMjAgMjAgMCAxIDEgMTU1IDExMy4yMjlWMTQ4QTcgNyAwIDAgMSAxNDggMTU1SDExMy4yMjlBMjAgMjAgMCAxIDEgODYuNzcxIDE1NUg1MkE3IDcgMCAwIDEgNDUgMTQ4VjExMy4yMjlBMjAgMjAgMCAxIDEgNDUgODYuNzcxVjUyQTcgNyAwIDAgMSA1MiA0NVoiIGZpbGw9IiNmN2YyZTciPjwvcGF0aD4KPGcgY2xpcC1wYXRoPSJ1cmwoI2MpIiBmaWxsPSIjMGUwZTBlIj48cGF0aCBkPSJNODcuMjMgMTAwLjgwTDY3LjQ3IDQwLjIwTDYwLjU5IDQwLjIwTDYwLjU5IDQwLjAwTDExOS41NSA0MC4wMEwxMTkuNTUgNDAuMjBMOTkuMTEgNDAuMjBMMTE0LjU1IDg4LjE2TDEzMi4xMSA0MC4yMEwxMjMuNTEgNDAuMjBMMTIzLjUxIDQwLjAwTDEzOS40NyA0MC4wMEwxMzkuNDcgNDAuMjBMMTMyLjM5IDQwLjIwTDExMC4xOSAxMDAuODBMMTA5LjQzIDEwMC44MEw4OS43OSA0MC4yMEw3Ny4xOSA0MC4yMEw5Mi43OSA4OC4xNkwxMDAuNTEgNjcuODhMMTAwLjYzIDY4LjI0TDg4LjMxIDEwMC44MFpNMTA1LjUxIDYyLjIwTDEwNS4zMSA2MS45MkwxMTIuOTEgNDAuMDhMMTEzLjIzIDQwLjA4WiI+PC9wYXRoPjxwYXRoIGQ9Ik05Ni4yMiAxNjQuODBMNzMuOTggMTA0LjAwTDgyLjk4IDEwNC4wMEwxMDAuNzAgMTUxLjgwTDExNy42NiAxMDQuMDBMMTE3Ljg2IDEwNC4wMEw5Ni40MiAxNjQuODBaTTc0LjEwIDEwNC4wMEw3NC4xMCAxNjMuODBMODAuMzAgMTYzLjgwTDgwLjMwIDE2NC4wMEw2OC4xNCAxNjQuMDBMNjguMTQgMTYzLjgwTDczLjkwIDE2My44MEw3My45MCAxMDQuMjBMNjcuNzQgMTA0LjIwTDY3Ljc0IDEwNC4wMFpNMTMyLjMwIDEwNC4wMEwxMzIuMzAgMTA0LjIwTDEyNi43NCAxMDQuMjBMMTI2Ljc0IDE2My44MEwxMzIuMzAgMTYzLjgwTDEzMi4zMCAxNjQuMDBMMTExLjM0IDE2NC4wMEwxMTEuMzQgMTYzLjgwTDExNy43OCAxNjMuODBMMTE3Ljc4IDEwNC4wMFoiPjwvcGF0aD48L2c+CjxwYXRoIGQ9Ik0xMDAgOTJMMTAzIDEwMUwxMTIgMTA0TDEwMyAxMDdMMTAwIDExNkw5NyAxMDdMODggMTA0TDk3IDEwMVoiIGZpbGw9IiNjNzliNDUiIHN0cm9rZT0iI2Y3ZjJlNyIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHBhaW50LW9yZGVyPSJzdHJva2UiPjwvcGF0aD4KPC9zdmc+";

  function replaceFavicon() {
    const existingIcons = document.querySelectorAll("link[rel~='icon']");

    if (!existingIcons.length) {
      const link = document.createElement("link");
      link.rel = "icon";
      link.href = FAVICON_URI;
      document.head.appendChild(link);
      return;
    }

    existingIcons.forEach((link) => {
      if (link.href !== FAVICON_URI) link.href = FAVICON_URI;
    });
  }

  function watchFaviconReplacement() {
    replaceFavicon();

    const observer = new MutationObserver(() => replaceFavicon());
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "rel"],
    });
  }

  // ============================================================
  // Rule 24: on /collection, whenever ul.rounded-xl (a card's tag list) enters the DOM, give it
  // "width: auto; max-height: 80vh" so it sizes to its content instead of whatever fixed width it inherits, and
  // stops overflowing the viewport once a card has a lot of tags. Each tag's usage count loads in asynchronously
  // after the list itself renders, appended to its name in span > span.inline-flex > span.min-w-0.truncate as
  // "{tag name} ({amount})" — that middle span.inline-flex (the tag's colored pill) is what distinguishes an
  // actual tag <li> from the list's two non-tag entries ("Toutes les étiquettes" first, "Gérer les étiquettes..."
  // last), which only nest two levels deep (span > span.block.min-w-0.truncate) and never carry a count — so
  // they're excluded from consideration entirely, rather than forever blocking the "every entry has its count"
  // check the way they used to. Once every actual tag has its count (i.e. the list is fully loaded), the tag
  // <li>s are moved into sorted (descending amount) order via a placeholder anchor, leaving the two non-tag
  // entries pinned in their original first/last spots. Guarded by a dataset flag so it isn't re-sorted on every
  // later mutation (which would otherwise also just re-fire from our own reordering).
  //
  // Rule 24 (cont'd): once the page has loaded, every span.truncate.leading-none on /collection gets
  // "line-height: initial" (its own line-height was clipping). The tags list's pill text
  // (span.min-w-0.truncate inside each tag's span.inline-flex, and the two non-tag entries' text) doesn't
  // carry the leading-none class, so it's missed by that broad rule — the same fix is applied to it directly,
  // as soon as the list itself enters the DOM.
  // ============================================================
  const TAG_COUNT_REGEX = /\((\d+)\)\s*$/;

  function fixTruncateLineHeight() {
    document.querySelectorAll("span.truncate.leading-none").forEach((el) => {
      el.style.lineHeight = "initial";
    });
  }

  function sortUserTagListByCount(ul) {
    if (ul.dataset.wmTagsSorted === "true") return;

    const tagEntries = Array.from(ul.children)
      .map((item) => {
        const countEl = item.querySelector(
          "span > span.inline-flex > span.min-w-0.truncate",
        );
        if (!countEl) return null;

        const match = countEl.textContent.match(TAG_COUNT_REGEX);
        return { item, count: match ? parseInt(match[1], 10) : null };
      })
      .filter((entry) => entry !== null);

    if (!tagEntries.length || tagEntries.some(({ count }) => count === null))
      return;

    ul.dataset.wmTagsSorted = "true";

    const anchor = document.createComment("wm-tags-sort-anchor");
    ul.insertBefore(anchor, tagEntries[0].item);

    tagEntries
      .sort((a, b) => b.count - a.count)
      .forEach(({ item }) => ul.insertBefore(item, anchor));

    anchor.remove();
  }

  function styleUserTagList() {
    if (!window.location.pathname.startsWith("/collection")) return;

    fixTruncateLineHeight();

    document.querySelectorAll("ul.rounded-xl").forEach((el) => {
      el.style.width = "auto";
      el.style.maxHeight = "80vh";
      sortUserTagListByCount(el);

      el.querySelectorAll("span.truncate").forEach((textEl) => {
        textEl.style.lineHeight = "initial";
      });
    });
  }

  function watchUserTagListSizing() {
    styleUserTagList();

    const observer = new MutationObserver(() => styleUserTagList());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 28: on /collection, embed a "✕" button inside the card search field (input.rounded-lg) to clear its
  // value. The input is moved into a new wrapper div (position: relative) placed right where the input used to
  // sit, and the clear button is appended into that wrapper, absolutely positioned over the input's right edge,
  // shown only while the input holds text. Clearing goes through HTMLInputElement.prototype's native value
  // setter — bypassing the site's own controlled-input setter — before dispatching an "input" event, so the
  // site's own filtering logic picks up the change exactly like a real keystroke would.
  // ============================================================
  const NATIVE_INPUT_VALUE_SETTER = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;

  function clearCollectionSearchInput(input) {
    NATIVE_INPUT_VALUE_SETTER.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function insertCollectionSearchClearButton(input) {
    if (input.dataset.wmClearButtonInserted === "true") return;
    input.dataset.wmClearButtonInserted = "true";

    const wrapper = document.createElement("div");
    wrapper.className = "wm-search-clear-wrapper";
    input.replaceWith(wrapper);
    wrapper.appendChild(input);
    input.classList.add("wm-search-clear-padding");

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "wm-search-clear-btn";
    clearBtn.textContent = "✕";
    clearBtn.title = "Effacer la recherche";

    const updateVisibility = () => {
      clearBtn.classList.toggle("wm-search-clear-btn-visible", !!input.value);
    };

    clearBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearCollectionSearchInput(input);
      input.focus();
      updateVisibility();
    });

    input.addEventListener("input", updateVisibility);
    updateVisibility();

    wrapper.appendChild(clearBtn);
  }

  function updateCollectionSearchClearButton() {
    if (!window.location.pathname.startsWith("/collection")) return;

    const input = document.querySelector("input.rounded-lg");
    if (!input) return;

    insertCollectionSearchClearButton(input);
  }

  function watchCollectionSearchClearButton() {
    addStyle(`
      .wm-search-clear-wrapper {
        position: relative;
        width: 100%;
      }
      .wm-search-clear-padding {
        padding-right: 1.75rem;
      }
      .wm-search-clear-btn {
        position: absolute;
        top: 50%;
        right: 0.75rem;
        transform: translateY(-50%);
        display: none;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0.5;
        font-size: 0.8rem;
        line-height: 1;
        padding: 0;
      }
      .wm-search-clear-btn:hover {
        opacity: 1;
      }
      .wm-search-clear-btn-visible {
        display: flex;
      }
    `);

    updateCollectionSearchClearButton();

    const observer = new MutationObserver(() =>
      updateCollectionSearchClearButton(),
    );
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 30: on /collection, whenever the multi-tagging modal ("Appliquer une étiquette", div.max-w-md) enters the
  // DOM, widen it from max-w-md to max-w-xl for more room, then on its tag list (the modal's max-h-64 child) give
  // it the "wm-multi-tag-list" class — CSS-driven (rather than inline styles) so the layout is easy to tweak in
  // one place — which forces "max-height: 50vh" (taller than the site's own fixed max-h-64) and turns it from a
  // single vertical column into a wrapped flex list. Each tag is rendered as a <button> that otherwise carries its
  // own "width: 100%" utility class, which would still stack them one per row even once their container wraps —
  // so every button under that class is forced to "width: auto" too, letting them actually flow left-to-right.
  // Renaming the modal's own class away from "max-w-md" doubles as the guard against re-processing it on every
  // later mutation, since it then stops matching the selector this runs on.
  //
  // Rule 30 (cont'd): the same tag list is reused for the bulk UN-tagging modal, distinguishable by each of its
  // buttons carrying a span.text-[var(--color-foreground)]/45 with a number (how many of the selected cards
  // currently carry that tag). When every direct <button> child has one, the list is re-sorted (descending by that
  // number) — the tags affecting the most selected cards surface first. Guarded by a dataset flag so it isn't
  // re-sorted on every later mutation (which would otherwise also just re-fire from our own reordering); until
  // every button has a computable count (they can load in after the list itself renders) or on the "Appliquer une
  // étiquette" variant (which never carries that span), it's simply left in the site's own order.
  // ============================================================
  function styleMultiTagModal() {
    if (!window.location.pathname.startsWith("/collection")) return;

    document.querySelectorAll("div.max-w-md").forEach((modal) => {
      modal.classList.remove("max-w-md");
      modal.classList.add("max-w-xl");

      modal.querySelector(".max-h-64")?.classList.add("wm-multi-tag-list");
    });
  }

  function sortUntagButtonsByCount(tagList) {
    if (tagList.dataset.wmUntagSorted === "true") return;

    const buttons = Array.from(tagList.querySelectorAll(":scope > button"));
    if (buttons.length === 0) return;

    const entries = buttons.map((button) => {
      const countEl = button.querySelector(
        "span.text-\\[var\\(--color-foreground\\)\\]\\/45",
      );
      if (!countEl) return null;

      const count = parseInt(countEl.textContent.trim(), 10);
      return Number.isNaN(count) ? null : { button, count };
    });

    if (entries.some((entry) => entry === null)) return;

    tagList.dataset.wmUntagSorted = "true";

    const anchor = document.createComment("wm-untag-sort-anchor");
    tagList.insertBefore(anchor, buttons[0]);

    entries
      .sort((a, b) => b.count - a.count)
      .forEach(({ button }) => tagList.insertBefore(button, anchor));

    anchor.remove();
  }

  function processMultiTagModal() {
    styleMultiTagModal();

    document
      .querySelectorAll(".wm-multi-tag-list")
      .forEach((tagList) => sortUntagButtonsByCount(tagList));
  }

  function watchMultiTagModalSizing() {
    addStyle(`
      .wm-multi-tag-list {
        max-height: 50vh !important;
        display: flex !important;
        flex-wrap: wrap !important;
        align-content: flex-start !important;
      }

      .wm-multi-tag-list button {
        width: auto !important;
        flex: 0 0 auto !important;
      }
    `);

    processMultiTagModal();

    const observer = new MutationObserver(() => processMultiTagModal());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature OWL: on /pulls, while a pulled card is shown large (guarded the same way as Feature AKP's E shortcut:
  // a span reading "Carte" is present in main), pressing W (ignored while focus is inside an <input>, same guard
  // as Feature AKP's E/V) does what E followed by clicking the card's Wikipedia link would: opens the card modal
  // (by clicking main img.scale-[1.8], same as E) then, 50ms later — the same delay Feature AKP already uses for
  // its own V shortcut's sell button, to let the modal render — clicks its outward link (a.inline-flex) for you.
  // No on-screen button any more: Feature AKP's own legend (its "W" row) explains the shortcut instead.
  // ============================================================
  function watchPulledCardWikiLinkShortcut() {
    document.addEventListener("keydown", (event) => {
      if (!window.location.pathname.startsWith("/pulls")) return;
      if (event.key !== "w" && event.key !== "W") return;
      if (event.target instanceof HTMLInputElement) return;

      const hasCardSpan = Array.from(
        document.querySelectorAll("main span"),
      ).some((span) => span.textContent.trim() === "Carte");
      if (!hasCardSpan) return;

      const cardImg = document.querySelector("main img.scale-\\[1\\.8\\]");
      if (!cardImg) return;

      event.preventDefault();
      cardImg.click();

      setTimeout(() => {
        document.querySelector("div.card-frame.p-6 a.inline-flex")?.click();
      }, 50);
    });
  }

  // ============================================================
  // Rule 34: on /collection, every time the tag filter's popover (ul.rounded-xl[role="listbox"], the same list
  // Rule 24 already sizes/sorts) is mounted, give it real keyboard navigation. Its "Toutes les étiquettes" trigger
  // button keeps DOM focus after opening the popover — aria-haspopup/aria-expanded toggle correctly, but focus
  // never moves into the list — so ArrowDown/ArrowUp land on the page itself (scrolling it) instead of the list.
  // As soon as the list is mounted, focus moves onto its currently selected option
  // (button[role="option"][aria-selected="true"], or the first option if none is selected yet). From there,
  // ArrowDown/ArrowUp/Home/End roving-focus between the option <button>s (each one is already natively focusable
  // and already handles Enter/Space to pick itself, so only the focus movement needed adding), wrapping past
  // either end. Typing any other printable character runs a standard listbox typeahead: characters typed within
  // 500ms of each other accumulate into a search string, and focus jumps to the next option (search starting
  // right after the currently focused one, wrapping back to the top) whose label starts with it — matched
  // against the tag's own name, with its leading "#" and trailing " (count)" stripped (the latter via
  // TAG_COUNT_REGEX, the same pattern Rule 24 uses to read it), so e.g. "a" reaches "#Art 🎨" / "#Animo 🐒" rather
  // than only ever matching entries literally starting with "#a". Guarded by a dataset flag so the listener is
  // wired once per freshly-portalled list instance, not once per mutation.
  // ============================================================
  function normalizedTagOptionLabel(option) {
    return option.textContent
      .trim()
      .replace(TAG_COUNT_REGEX, "")
      .trim()
      .replace(/^#/, "")
      .trim()
      .toLowerCase();
  }

  function focusTagOptionAtDelta(options, delta) {
    if (!options.length) return;

    const currentIndex = options.indexOf(document.activeElement);
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : options.length - 1
        : (currentIndex + delta + options.length) % options.length;

    options[nextIndex].focus();
  }

  function setUpTagFilterListKeyboardNav(list) {
    if (list.dataset.wmKeyboardNav === "true") return;

    const getOptions = () =>
      Array.from(list.querySelectorAll('button[role="option"]'));

    const options = getOptions();
    if (!options.length) return;

    list.dataset.wmKeyboardNav = "true";

    const selected = options.find(
      (option) => option.getAttribute("aria-selected") === "true",
    );
    (selected ?? options[0]).focus();

    let typeaheadSearch = "";
    let typeaheadResetTimer = null;

    list.addEventListener("keydown", (event) => {
      const currentOptions = getOptions();
      if (!currentOptions.length) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusTagOptionAtDelta(currentOptions, 1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        focusTagOptionAtDelta(currentOptions, -1);
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        currentOptions[0].focus();
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        currentOptions[currentOptions.length - 1].focus();
        return;
      }

      if (
        event.key.length !== 1 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;

      event.preventDefault();

      clearTimeout(typeaheadResetTimer);
      typeaheadSearch += event.key.toLowerCase();
      typeaheadResetTimer = setTimeout(() => {
        typeaheadSearch = "";
      }, 500);

      const currentIndex = Math.max(
        currentOptions.indexOf(document.activeElement),
        0,
      );
      const searchOrder = [
        ...currentOptions.slice(currentIndex + 1),
        ...currentOptions.slice(0, currentIndex + 1),
      ];

      const match = searchOrder.find((option) =>
        normalizedTagOptionLabel(option).startsWith(typeaheadSearch),
      );
      if (match) match.focus();
    });
  }

  function processTagFilterListKeyboardNav() {
    if (!window.location.pathname.startsWith("/collection")) return;

    document
      .querySelectorAll('ul.rounded-xl[role="listbox"]')
      .forEach(setUpTagFilterListKeyboardNav);
  }

  function watchTagFilterListKeyboardNav() {
    addStyle(`
      ul.rounded-xl[role="listbox"] button[role="option"]:focus-visible {
        outline: none;
        background-color: var(--color-surface-light);
        box-shadow: inset 0 0 0 1px var(--color-accent);
      }
    `);

    processTagFilterListKeyboardNav();

    const observer = new MutationObserver(() =>
      processTagFilterListKeyboardNav(),
    );
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 35: on /collection, a "Top {limit}" text button appended to the h1 inside div.gap-3.animate-fade-in-up
  // (right after the heading's text) opens a modal listing the largest eval prices (as many as getTopLimit(): the "Taille des classements « Top »" setting of Feature CFG, default 40) cached under
  // "eval-{name}" (Feature ETS), as a 3-column grid sorted by descending value. Entries whose cached value is the
  // "?" placeholder (or otherwise non-numeric) are left out. Each entry has a "✕" button that removes that eval
  // from localStorage and grays the entry out, the same way the "✕" on /profile's sold-prices grid (Feature BSP)
  // does. The highest eval is pulled out of the grid and showcased above it with a golden pulsating glow
  // (wm-top-eval-glow). Reuses the settings modal's overlay/header/close styling (.wm-settings-*), fading in on open
  // (wm-top-evals-fade-in); closes on Escape, overlay click or its own close button.
  //
  // Rule 35 (cont'd): with a big cache, reading every "eval-" entry takes a while, so the last result is buffered in
  // localStorage under "wm-top-evals-cache" (the TOP_LIMIT_MAX (100) best ones, as { cardName, value }, whatever the configured size: it is sliced to it when drawn, so a larger setting never needs a recompute to be filled). Opening the modal draws that
  // buffer at once, while the list is recomputed in chunks (yielding to the page between them) and a small
  // "Actualisation..." shows in the header; once finished, the buffer is replaced with the new result and the modal is
  // redrawn if it differs (an entry cleared meanwhile stays out). Without a buffer the modal opens on "Calcul en
  // cours...". The buffer is derived data: it isn't part of the export, and "Vider le cache" removes it.
  // ============================================================
  // The configured size of the Top lists (Rule 35's estimates, Feature BBS's best trades), read when each acts
  function getTopLimit() {
    return getConfigValue(TOP_LIMIT_CONFIG_ID);
  }

  const EVAL_KEY_PREFIX = "eval-";
  const TOP_EVALS_CACHE_KEY = "wm-top-evals-cache";
  const TOP_EVALS_CHUNK_SIZE = 1500;

  function collectTopEvals() {
    const names = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(EVAL_KEY_PREFIX))
        names.push(key.slice(EVAL_KEY_PREFIX.length));
    }

    return names
      .map((cardName) => ({
        cardName,
        value: getCardEvalValueByName(cardName),
      }))
      .filter((entry) => entry.value !== null)
      .sort((a, b) => b.value - a.value)
      .slice(0, TOP_LIMIT_MAX);
  }

  function readTopEvalsCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TOP_EVALS_CACHE_KEY));
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(
        (entry) =>
          entry &&
          typeof entry.cardName === "string" &&
          typeof entry.value === "number",
      );
    } catch {
      return null;
    }
  }

  function writeTopEvalsCache(list) {
    try {
      localStorage.setItem(TOP_EVALS_CACHE_KEY, JSON.stringify(list));
    } catch (error) {
      logger(CPL.WARN, "Top evals buffer not saved", error);
    }
  }

  // Same result as collectTopEvals, but without holding the page up: the entries are read in chunks, with a pause
  // between them, keeping only the best ones so far: always TOP_LIMIT_MAX of them (the buffer), the configured size
  // only trims what is shown
  async function computeTopEvalsAsync() {
    let best = [];
    const total = localStorage.length;
    logger(CPL.LOG, `Top evals: computing the ${TOP_LIMIT_MAX} best`);

    for (let from = 0; from < total; from += TOP_EVALS_CHUNK_SIZE) {
      const names = [];
      const to = Math.min(from + TOP_EVALS_CHUNK_SIZE, total);
      for (let i = from; i < to; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(EVAL_KEY_PREFIX))
          names.push(key.slice(EVAL_KEY_PREFIX.length));
      }

      names.forEach((cardName) => {
        const value = getCardEvalValueByName(cardName);
        if (value !== null) best.push({ cardName, value });
      });
      best = best.sort((a, b) => b.value - a.value).slice(0, TOP_LIMIT_MAX);

      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return best;
  }

  // Shared by Rule 35 and Feature BBS's /profile button: builds the Top-list modal from already-sorted entries
  // ({ cardName, valueText, badgeText?, badgeHint?, score?, onClear }), the first one showcased above the grid. Each
  // entry reads: its rank in the list as shown (dimmed; a re-order re-numbers), the name, the value, then its "✕". A badgeText
  // gets its own span, docked to the top edge of the entry, whose tooltip is badgeHint followed by the text. With a sortToggle ({ label, compare, storageKey }), a switch in
  // the header re-orders the entries with `compare` instead of the given order (re-showcasing whichever comes
  // first); the choice is remembered in localStorage under storageKey, and an entry cleared before a re-order stays
  // grayed out.
  function buildTopListModal({
    title: titleText,
    emptyText,
    loadingText,
    entries: initialEntries,
    sortToggle,
  }) {
    let entries = initialEntries;
    let loading = false;
    const overlay = document.createElement("div");
    overlay.className = "wm-settings-overlay wm-top-evals-overlay";

    const modal = document.createElement("div");
    modal.className = "wm-settings-modal wm-top-evals-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", titleText);

    const header = document.createElement("div");
    header.className = "wm-settings-header";

    const title = document.createElement("h2");
    title.className = "wm-settings-title";
    title.textContent = titleText;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "wm-settings-close";
    closeBtn.setAttribute("aria-label", "Fermer");
    closeBtn.textContent = "✕";

    header.append(title);

    const loadingEl = document.createElement("span");
    loadingEl.className = "wm-top-evals-loading";
    loadingEl.textContent = "Actualisation...";
    loadingEl.hidden = true;
    header.append(loadingEl);

    let sortBtn = null;
    if (sortToggle) {
      sortBtn = document.createElement("button");
      sortBtn.type = "button";
      sortBtn.className = "wm-top-evals-sort";
      sortBtn.textContent = sortToggle.label;
      sortBtn.title = sortToggle.label;
      header.append(sortBtn);
    }
    header.append(closeBtn);

    const grid = document.createElement("div");
    grid.className = "wm-top-evals-grid";

    const clearedEntries = new Set();

    const buildEntry = (entry, rank) => {
      const { cardName, valueText, badgeText, badgeHint, score, onClear } =
        entry;
      const entryEl = document.createElement("div");
      entryEl.className = "wm-top-evals-entry";
      // The entry's score, when it has a finite one, is exposed as a data-score metadatum (rounded to 2 decimals)
      if (Number.isFinite(score)) entryEl.dataset.score = score.toFixed(2);

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "wm-top-evals-clear";
      clearBtn.setAttribute("aria-label", `Effacer ${cardName}`);
      clearBtn.textContent = "✕";

      // The entry's place in the list as shown (a re-order re-numbers it), dimmed, where the cross used to be
      const rankCell = document.createElement("span");
      rankCell.className = "wm-top-evals-rank";
      rankCell.textContent = String(rank);

      const nameCell = document.createElement("span");
      nameCell.className = "wm-top-evals-name";
      nameCell.title = cardName;
      nameCell.textContent =
        cardName.length < 42 ? cardName : cardName.trim().slice(0, 42) + "...";

      const valueCell = document.createElement("span");
      valueCell.className = "wm-top-evals-value";
      valueCell.textContent = valueText;

      clearBtn.addEventListener("click", () => {
        onClear();
        clearedEntries.add(entry);
        clearBtn.remove();
        entryEl.classList.add("wm-top-evals-entry-cleared");
      });

      if (clearedEntries.has(entry)) {
        clearBtn.remove();
        entryEl.classList.add("wm-top-evals-entry-cleared");
      }

      entryEl.append(rankCell, nameCell, valueCell, clearBtn);

      if (badgeText) {
        const formattedBadgeText = badgeText.replace(".", ",");
        const badge = document.createElement("span");
        badge.className = "wm-top-evals-badge";
        badge.textContent = formattedBadgeText;
        badge.title = (badgeHint ?? "") + formattedBadgeText;
        entryEl.appendChild(badge);
      }
      return entryEl;
    };

    let topEl = null;
    const render = () => {
      topEl?.remove();
      topEl = null;
      grid.replaceChildren();

      if (entries.length === 0) {
        const empty = document.createElement("p");
        empty.className = "wm-settings-hint";
        empty.textContent = loading && loadingText ? loadingText : emptyText;
        grid.appendChild(empty);
        return;
      }

      const sorted =
        sortBtn?.getAttribute("aria-pressed") === "true"
          ? [...entries].sort(sortToggle.compare)
          : entries;

      // The first entry is pulled out of the grid and showcased above it.
      const [topEntry, ...otherEntries] = sorted;
      topEl = buildEntry(topEntry, 1);
      topEl.classList.add("wm-top-evals-max");
      grid.before(topEl);
      otherEntries.forEach((entry, index) =>
        grid.appendChild(buildEntry(entry, index + 2)),
      );
    };

    if (sortBtn) {
      let pressed = false;
      try {
        pressed = localStorage.getItem(sortToggle.storageKey) === "true";
      } catch {
        // localStorage unavailable: the switch just starts off
      }
      sortBtn.setAttribute("aria-pressed", String(pressed));

      sortBtn.addEventListener("click", () => {
        const next = sortBtn.getAttribute("aria-pressed") !== "true";
        sortBtn.setAttribute("aria-pressed", String(next));
        localStorage.setItem(sortToggle.storageKey, String(next));
        logger(CPL.LOG, `${sortToggle.storageKey}: ${next}`);
        render();
      });
    }

    modal.append(header, grid);
    overlay.appendChild(modal);
    render();

    // Lets the caller swap the entries once a slower computation has finished, and show that it is under way
    overlay.wmTopList = {
      setEntries: (next) => {
        entries = next;
        render();
      },
      setLoading: (value) => {
        loading = value;
        loadingEl.hidden = !value;
        if (entries.length === 0) render();
      },
    };

    const onKeydown = (event) => {
      if (event.key === "Escape") close();
    };
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKeydown);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", onKeydown);

    return overlay;
  }

  function buildTopEvalEntries(list) {
    return list.map(({ cardName, value }) => ({
      cardName,
      valueText: formatEvalValue(String(value)),
      onClear: () => {
        logger(CPL.INFO, `Estimate cleared: "${cardName}"`);
        localStorage.removeItem(`${EVAL_KEY_PREFIX}${cardName}`);
        const buffered = readTopEvalsCache();
        if (buffered)
          writeTopEvalsCache(buffered.filter((e) => e.cardName !== cardName));
      },
    }));
  }

  function topEvalsKey(list) {
    return list.map(({ cardName, value }) => `${cardName}=${value}`).join("|");
  }

  // Opens at once on the buffered list (if any), then swaps in the freshly computed one
  function openTopEvalsModal() {
    const limit = getTopLimit();
    // The buffer holds TOP_LIMIT_MAX entries: only the configured number of them is drawn
    const buffered = readTopEvalsCache()?.slice(0, limit) ?? null;
    let shown = buffered ?? [];
    logger(
      CPL.LOG,
      buffered
        ? `Top evals: drawing the buffer (${buffered.length})`
        : "Top evals: no buffer, computing",
    );

    const overlay = buildTopListModal({
      title: `🏆 Les ${limit} plus grosses estimations de votre collection`,
      emptyText: "Aucune estimation en cache pour le moment.",
      loadingText: "Calcul en cours...",
      entries: buildTopEvalEntries(shown),
    });
    document.body.appendChild(overlay);
    overlay.wmTopList.setLoading(true);

    const start = performance.now();
    computeTopEvalsAsync().then((fresh) => {
      // An estimate cleared while this was running must not come back
      const current = fresh.filter(
        ({ cardName }) => getCardEvalValueByName(cardName) !== null,
      );
      writeTopEvalsCache(current);
      logger(
        CPL.INFO,
        `Top evals recomputed in ${Math.round(performance.now() - start)} ms (${current.length} buffered, ${limit} shown)`,
      );

      if (!overlay.isConnected) return;
      overlay.wmTopList.setLoading(false);
      const display = current.slice(0, limit);
      if (topEvalsKey(display) === topEvalsKey(shown)) return;
      shown = display;
      overlay.wmTopList.setEntries(buildTopEvalEntries(display));
    });
  }

  function setTopEvalsButtonLabel(btn) {
    const limit = getTopLimit();
    if (btn.dataset.wmLimit === String(limit)) return;

    btn.dataset.wmLimit = String(limit);
    btn.textContent = `Top ${limit}`;
    btn.title = `Afficher les ${limit} plus grosses estimations de votre collection`;
    logger(CPL.LOG, `Top evals button labelled for ${limit}`);
  }

  function insertTopEvalsButton() {
    if (!window.location.pathname.startsWith("/collection")) return;

    const heading = document.querySelector("div.gap-3.animate-fade-in-up h1");
    if (!heading) return;

    // Already there: only keep its label in line with the configured size
    const existing = heading.querySelector(":scope > .wm-top-evals-btn");
    if (existing) {
      setTopEvalsButtonLabel(existing);
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wm-top-evals-btn";
    setTopEvalsButtonLabel(btn);
    btn.setAttribute("aria-haspopup", "dialog");

    btn.addEventListener("click", () => {
      if (document.querySelector(".wm-settings-overlay")) return;
      openTopEvalsModal();
    });

    heading.appendChild(btn);
  }

  // ============================================================
  // Rule 36: on /collection, once the catalog has finished loading (no div.animate-spin, and the page indicator
  // COLLECTION_PAGE_INDICATOR_SELECTOR reads "{current} / {max}"), that indicator becomes clickable. Clicking it
  // hides it and shows a number <input> (1..max) in its place; Enter jumps to that page, Escape or losing focus
  // puts the indicator back untouched. The indicator is hidden rather than removed since React owns it. The jump
  // is performed with the indicator's two sibling buttons (previous - indicator - next): the matching one is
  // clicked once per page to cross, waiting for the indicator to change between clicks.
  // ============================================================
  let collectionPageJumpRunning = false;

  function readCollectionPageIndicator(span) {
    const match = span.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    return match ? { current: +match[1], max: +match[2] } : null;
  }

  function findCollectionPageIndicator() {
    return (
      Array.from(
        document.querySelectorAll(COLLECTION_PAGE_INDICATOR_SELECTOR),
      ).find((span) => readCollectionPageIndicator(span)) ?? null
    );
  }

  function isCollectionPageLoaded() {
    return (
      window.location.pathname.startsWith("/collection") &&
      !document.querySelector("div.animate-spin") &&
      findCollectionPageIndicator() !== null
    );
  }

  async function jumpToCollectionPage(target) {
    if (collectionPageJumpRunning) return;
    collectionPageJumpRunning = true;

    try {
      for (;;) {
        const span = findCollectionPageIndicator();
        const state = span && readCollectionPageIndicator(span);
        if (!state || state.current === target) return;

        const btn =
          target > state.current
            ? span.nextElementSibling
            : span.previousElementSibling;
        if (!(btn instanceof HTMLButtonElement) || btn.disabled) return;

        btn.click();

        let changed = false;
        for (let waited = 0; waited < 15000 && !changed; waited += 50) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          const now = findCollectionPageIndicator();
          const nowState = now && readCollectionPageIndicator(now);
          changed = nowState !== null && nowState.current !== state.current;
        }
        if (!changed) return;
      }
    } finally {
      collectionPageJumpRunning = false;
    }
  }

  function openCollectionPageInput(span) {
    if (span.nextElementSibling?.classList.contains("wm-page-jump-input"))
      return;

    const state = readCollectionPageIndicator(span);
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = String(state.max);
    input.value = String(state.current);
    input.className = "wm-page-jump-input";
    input.title =
      "Cliquer pour définir manuellement une page à laquelle vous rendre";
    input.setAttribute("aria-label", "Aller à la page");

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      input.remove();
      span.style.display = "";
    };

    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        close();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const target = Math.min(
          state.max,
          Math.max(1, parseInt(input.value, 10) || state.current),
        );
        close();
        jumpToCollectionPage(target);
      }
    });
    input.addEventListener("blur", close);

    span.style.display = "none";
    span.after(input);
    input.focus();
    input.select();
  }

  function updateCollectionPageIndicatorClickable() {
    const span = findCollectionPageIndicator();
    if (!span) return;
    span.classList.toggle("wm-page-jump", isCollectionPageLoaded());
  }

  function watchCollectionPageJump() {
    addStyle(`
      .wm-page-jump {
        cursor: pointer;
        transition: scale 0.1s ease;
      }
      .wm-page-jump:hover {
        scale: 1.05;
      }
      .wm-page-jump-input {
        width: 4.5rem;
        padding: 0.1rem 0.4rem;
        border: 1px solid currentColor;
        border-radius: 0.4rem;
        background: transparent;
        color: inherit;
        text-align: center;
      }
    `);

    document.addEventListener("click", (event) => {
      const span = event.target.closest?.(".wm-page-jump");
      if (span && isCollectionPageLoaded()) openCollectionPageInput(span);
    });

    updateCollectionPageIndicatorClickable();
    const observer = new MutationObserver(() =>
      updateCollectionPageIndicatorClickable(),
    );
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Injected once, whichever of Rule 35 / Feature BBS's /profile button (both rely on it) is enabled first
  let topListStylesInjected = false;
  function injectTopListStyles() {
    if (topListStylesInjected) return;
    topListStylesInjected = true;

    addStyle(`
      .wm-top-evals-btn {
        margin-left: 0.75rem;
        padding: 0.2rem 0.6rem;
        border: 1px solid #ffd700;
        border-radius: 0.5rem;
        background: transparent;
        color: #ffd700;
        font-size: 0.8rem;
        font-weight: 600;
        vertical-align: middle;
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 0.2s ease, background-color 0.2s ease;
      }
      .wm-top-evals-btn:hover {
        opacity: 1;
        background: rgba(255, 215, 0, 0.1);
      }
      .wm-top-evals-loading {
        margin-left: 0.75rem;
        font-size: 0.75rem;
        opacity: 0.6;
      }
      .wm-top-evals-overlay {
        animation: wm-top-evals-fade-in 0.5s ease-out;
      }
      @keyframes wm-top-evals-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .wm-top-evals-modal {
        width: 80vw;
      }
      .wm-top-evals-grid {
        max-height: 80vh;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.5rem 0.75rem;
        overflow-y: auto;
        padding-top: 0.5rem;
        padding-right: 0.25rem;
      }
      .wm-top-evals-grid > p {
        grid-column: 1 / -1;
      }
      .wm-top-evals-entry {
        position: relative;
        display: flex;
        align-items: center;
        padding: 0.5rem 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 0.5rem;
        transition: opacity 0.2s ease;
      }
      .wm-top-evals-sort {
        margin-left: auto;
        margin-right: 0.75rem;
        padding: 0.2rem 0.6rem;
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 999px;
        background: transparent;
        color: var(--color-foreground);
        font-size: 0.75rem;
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 0.2s ease, background-color 0.2s ease;
      }
      .wm-top-evals-sort:hover {
        opacity: 1;
      }
      .wm-top-evals-sort[aria-pressed="true"] {
        opacity: 1;
        border-color: #ffd700;
        color: #ffd700;
        background: rgba(255, 215, 0, 0.12);
      }
      .wm-top-evals-badge {
        position: absolute;
        top: 0;
        right: 0.75rem;
        transform: translateY(-50%);
        padding: 0 0.4rem;
        border-radius: 0.5rem;
        background: var(--color-surface, #1a1a1a);
        border: 1px solid rgba(255, 255, 255, 0.25);
        color: #ffd700;
        font-size: 0.65rem;
        font-weight: 700;
        line-height: 1.2;
      }
      .wm-top-evals-entry-cleared {
        opacity: 0.35;
      }
      .wm-top-evals-max {
        min-width: 40%;
        max-width: 50%;
        margin-inline: auto;
        padding: 0.75rem;
        border: 1px solid rgba(255, 215, 0, 0.6);
        background-color: rgba(255, 215, 0, 0.2);
        color: #fff4cc;
        animation: wm-top-eval-glow 3s ease-in-out infinite;
      }
      .wm-top-evals-max .wm-top-evals-clear {
        margin-left: 0.25rem;
      }
      .wm-top-evals-max .wm-top-evals-name,
      .wm-top-evals-max .wm-top-evals-value {
        font-size: 1.1rem;
      }
      /* overflow: hidden clips the inherited text-shadow to the span's box, so the box is padded to leave the glow
         room (and the padding cancelled by a negative margin) while the ellipsis prevents horizontal overflow */
      .wm-top-evals-max .wm-top-evals-name {
        padding: 0.4rem;
        margin: -0.4rem;
      }
      .wm-top-evals-max .wm-top-evals-value {
        color: #ffd700;
      }
      @keyframes wm-top-eval-glow {
        0%, 100% {
          box-shadow: 0 0 3px rgba(255, 215, 0, 0.5), 0 0 6px rgba(255, 215, 0, 0.25);
          text-shadow: 0 0 3px rgba(255, 215, 0, 0.6);
        }
        50% {
          box-shadow: 0 0 9px rgba(255, 215, 0, 1), 0 0 18px rgba(255, 195, 0, 0.75),
            0 0 28px rgba(255, 215, 0, 0.4);
          text-shadow: 0 0 6px rgba(255, 240, 150, 1), 0 0 14px rgba(255, 215, 0, 0.9);
        }
      }
      .wm-top-evals-rank {
        flex-shrink: 0;
        min-width: 1.6rem;
        font-size: 0.75rem;
        font-variant-numeric: tabular-nums;
        opacity: 0.35;
      }
      .wm-top-evals-name {
        min-width: 0;
        font-size: 0.825rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .wm-top-evals-value {
        flex-shrink: 0;
        margin-left: auto;
        width: max-content;
        color: #8db600;
        font-size: 0.85rem;
        font-weight: 600;
      }
      .wm-top-evals-clear {
        border: none;
        background: transparent;
        margin-left: 0.5rem;
        color: var(--color-foreground);
        opacity: 0.5;
        cursor: pointer;
        line-height: 1;
        transition: opacity 0.2s ease, color 0.2s ease;
      }
      .wm-top-evals-clear:hover {
        opacity: 1;
        color: #ef2222;
      }
    `);
  }

  function watchTopEvalsButton() {
    injectTopListStyles();

    insertTopEvalsButton();

    const observer = new MutationObserver(() => insertTopEvalsButton());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature BBS (cont'd): on your own profile (/profile), one button per BEST_TRADE_KINDS entry is inserted after
  // the "Ma Collection" anchor of div.grid.grid-cols-2 (so, in order, between it and "Mes Amis"; the grid then
  // gets one column per child), cloning the anchors' look. Each opens the same modal as Rule 35's Top list
  // (buildTopListModal), listing that kind's cache — the biggest trade showcased first — with each amount shown in
  // full (no "K" abbreviation), with the trade's cutoff from its eval, when it has one, as a "+223%" / "-21%" badge docked to the top of the entry; the cache is
  // refreshed (refreshBestTradeCutoffs) as the modal opens. An entry's "✕" removes that trade from the cache (its stored "{amount}-{tag}" value
  // being unique to that trade).
  // ============================================================
  function buildBestTradesModal(kind) {
    const config = BEST_TRADE_KINDS[kind];
    refreshBestTradeCutoffs(kind);
    // The cache holds up to TOP_LIMIT_MAX trades; the configured size only decides how many of the biggest are shown
    const trades = sortBestTradesByAmount(
      readBestTrades(kind).filter(
        (entry) => entry && typeof entry === "object",
      ),
    ).slice(0, getTopLimit());

    return buildTopListModal({
      title: config.modalTitle(),
      emptyText: config.emptyText,
      sortToggle: {
        label: "Trier par bonne affaire",
        // New key: the old one remembered a switch that sorted by something else
        storageKey: `wm-best-${kind}-sort-by-deal`,
        // Default order is by amount; switched on, best score first (BEST_TRADE_KINDS' score); trades with none come last, in their usual order (sort
        // is stable)
        compare: (a, b) => {
          const aMissing = Number.isNaN(a.score);
          const bMissing = Number.isNaN(b.score);
          if (aMissing || bMissing) return Number(aMissing) - Number(bMissing);
          return b.score - a.score;
        },
      },
      entries: trades.map((entry) => {
        const cardName = Object.keys(entry)[0];
        const raw = String(entry[cardName]);
        const { amount, cutoff } = parseBestTradeValue(raw);
        const amountText = (amount || 0).toLocaleString("fr-FR");
        return {
          cardName,
          valueText: amountText,
          badgeText: cutoff ? formatBestTradeCutoff(cutoff) : undefined,
          badgeHint: config.cutoffHint,
          score: config.score(cardName, amount),
          onClear: () => {
            localStorage.setItem(
              config.key,
              JSON.stringify(
                readBestTrades(kind).filter(
                  (e) => !(e && String(e[cardName]) === raw),
                ),
              ),
            );
          },
        };
      }),
    });
  }

  function insertBestTradesButtons() {
    if (!/^\/profile\/?$/.test(window.location.pathname)) return;

    const collectionLink = document.querySelector(
      'div.grid.grid-cols-2 > a[href="/collection"]',
    );
    const grid = collectionLink?.parentElement;
    if (!grid || grid.querySelector(".wm-best-trades-btn")) return;

    let previous = collectionLink;
    Object.entries(BEST_TRADE_KINDS).forEach(([kind, config]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `${collectionLink.className} wm-best-trades-btn cursor-pointer`;
      btn.title = config.modalTitle().replace(/^\S+\s/, "");
      btn.setAttribute("aria-haspopup", "dialog");

      const icon = document.createElement("span");
      icon.className = "text-3xl leading-none";
      icon.textContent = config.buttonIcon;
      const label = document.createElement("span");
      label.className = "text-sm font-medium";
      label.textContent = config.buttonLabel;
      btn.append(icon, label);

      btn.addEventListener("click", () => {
        if (document.querySelector(".wm-settings-overlay")) return;
        document.body.appendChild(buildBestTradesModal(kind));
      });

      previous.after(btn);
      previous = btn;
    });

    grid.style.gridTemplateColumns = `repeat(${grid.children.length}, 1fr)`;
  }

  function watchBestTradesButtons() {
    injectTopListStyles();

    insertBestTradesButtons();

    const observer = new MutationObserver(() => insertBestTradesButtons());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature FOL: on another user's profile (/profile/{username}), a "follow" eye button is added to the top-right
  // row (div.-mt-0.5) holding the "Signaler" button, right before it, styled after that button (eye icon + "Suivre"
  // / "Suivi" label). That row is there on every other user's profile, friend or not, unlike the message / trade
  // buttons. Clicking it adds the user to — or removes them from — the followed list kept in localStorage under FOLLOWED_USERS_KEY (a
  // JSON array of usernames), and the button turns red while the user is followed. On a bid page
  // (/marketplace/{UUID}), a red eye icon (span.wm-follow-eye) is then appended at the end of every followed user's
  // name span, inside it (so it can't wrap away from the name: the span is made nowrap and the eye starts with a word
  // joiner). The site's framework may rewrite that span's text and drop the eye, which the next pass puts back:
  // the seller (p.text-sm.mt-1 span), each bidder of ul.card-frame (the first span of the entry) and the leading
  // bidder (div.card-frame p.text-xs span). The icon holds no text, so the span's textContent still reads as the
  // bare name. Icons of users no longer followed are removed.
  //
  // Feature FOL (cont'd): on your own profile (/profile), the followed users are listed in a block placed right after
  // Feature BSP's div.wm-bsp-dump (or after div.grid when that one isn't there), sorted alphabetically, each as a
  // link to their profile with a "✕" that unfollows them and grays the entry out, like the dump's own entries. It
  // reuses none of the dump's classes — wm-bsp-dump in particular is how Feature BSP spots its own block. Nothing is
  // shown while nobody is followed. Each entry also shows the player's personal description (Feature UDS), if any,
  // muted under their name.
  // ============================================================
  const FOLLOWED_USERS_KEY = "wm-followed-users";
  const FOLLOW_EYE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle></svg>';

  function readFollowedUsers() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(FOLLOWED_USERS_KEY) ?? "[]",
      );
      return Array.isArray(parsed)
        ? parsed.filter((u) => typeof u === "string")
        : [];
    } catch {
      return [];
    }
  }

  function setUserFollowed(username, followed) {
    const users = readFollowedUsers().filter((u) => u !== username);
    if (followed) users.push(username);
    localStorage.setItem(FOLLOWED_USERS_KEY, JSON.stringify(users));
    logger(CPL.INFO, `${followed ? "Following" : "Unfollowed"} ${username}`);
  }

  function getViewedProfileUsername() {
    const match = window.location.pathname.match(/^\/profile\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function updateFollowButtonState(btn, username) {
    const followed = readFollowedUsers().includes(username);
    btn.setAttribute("aria-pressed", String(followed));
    const label = btn.querySelector(".wm-follow-btn-label");
    if (label) label.textContent = followed ? "Suivi" : "Suivre";
    btn.title = followed ? `Ne plus suivre ${username}` : `Suivre ${username}`;
  }

  function insertFollowButton() {
    const username = getViewedProfileUsername();
    if (!username) return;

    const reportBtn = document.querySelector(
      'div.-mt-0\\.5 button[title^="Signaler"]',
    );
    const row = reportBtn?.parentElement;
    if (!reportBtn || !row) return;

    const existing = row.querySelector(":scope > .wm-follow-btn");
    if (existing) {
      // The viewed profile can change without the row being rebuilt
      if (existing.dataset.wmFollowUser !== username) {
        existing.dataset.wmFollowUser = username;
        updateFollowButtonState(existing, username);
      }
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${reportBtn.className.replace("wm-profile-btn", "").trim()} wm-follow-btn`;
    btn.dataset.wmFollowUser = username;
    btn.innerHTML = `${FOLLOW_EYE_SVG}<span class="wm-follow-btn-label"></span>`;
    btn
      .querySelector("svg")
      .setAttribute("class", "size-2.5 shrink-0 opacity-80");
    updateFollowButtonState(btn, username);

    btn.addEventListener("click", () => {
      const user = btn.dataset.wmFollowUser;
      setUserFollowed(user, !readFollowedUsers().includes(user));
      updateFollowButtonState(btn, user);
    });

    reportBtn.before(btn);
  }

  function createFollowEye(username) {
    const eye = document.createElement("span");
    eye.className = "wm-follow-eye";
    eye.dataset.wmFollowName = username;
    eye.title = `Vous suivez ${username}`;
    eye.innerHTML = FOLLOW_EYE_SVG;
    return eye;
  }

  function updateFollowEyes() {
    if (!MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname)) return;

    const followed = new Set(readFollowedUsers());

    const nameSpans = new Set();
    const sellerSpan = document.querySelector("p.text-sm.mt-1 span");
    if (sellerSpan) nameSpans.add(sellerSpan);
    document
      .querySelectorAll("div.card-frame p.text-xs span")
      .forEach((span) => nameSpans.add(span));
    document.querySelectorAll("ul.card-frame > *").forEach((entry) => {
      const span = Array.from(entry.children).find(
        (child) =>
          child.tagName === "SPAN" &&
          !child.classList.contains("wm-follow-eye"),
      );
      if (span) nameSpans.add(span);
    });

    nameSpans.forEach((span) => {
      const name = span.textContent.trim();
      const eye = span.querySelector(":scope > .wm-follow-eye");

      if (!followed.has(name)) {
        eye?.remove();
        span.classList.remove("wm-follow-name");
      } else if (!eye || eye.dataset.wmFollowName !== name) {
        eye?.remove();
        span.classList.add("wm-follow-name");
        span.appendChild(createFollowEye(name));
        traceOnce(`[FOL] eye shown next to followed player ${name}`);
      }
    });

    // Eyes whose name span changed to someone else, or is gone
    document.querySelectorAll(".wm-follow-eye").forEach((eye) => {
      const nameSpan = eye.parentElement;
      const name = nameSpan?.textContent.trim();
      if (!name || name !== eye.dataset.wmFollowName || !followed.has(name)) {
        nameSpan?.classList.remove("wm-follow-name");
        eye.remove();
      }
    });
  }

  function renderFollowedUsersList() {
    if (window.location.pathname !== "/profile") return;

    const grid = document.querySelector("div.grid");
    if (!grid) return;

    const anchor = document.querySelector(".wm-bsp-dump") ?? grid;
    const existing = document.querySelector(".wm-followed-dump");
    if (existing) {
      // Feature BSP's dump can show up after this block was inserted
      if (anchor.nextElementSibling !== existing) anchor.after(existing);
      return;
    }

    const users = readFollowedUsers().sort((a, b) => a.localeCompare(b));
    if (users.length === 0) return;

    const list = document.createElement("div");
    list.className = "wm-followed-dump";

    const title = document.createElement("h2");
    title.className = "wm-followed-dump-title";
    title.textContent = "👁️ Joueurs suivis";
    list.appendChild(title);

    users.forEach((username) => {
      const entryEl = document.createElement("div");
      entryEl.className = "wm-followed-dump-entry";

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "wm-followed-dump-clear";
      clearBtn.setAttribute("aria-label", `Ne plus suivre ${username}`);
      clearBtn.textContent = "✕";

      const nameLink = document.createElement("a");
      nameLink.className = "wm-followed-dump-name";
      nameLink.href = `/profile/${encodeURIComponent(username)}`;
      nameLink.textContent = username;

      clearBtn.addEventListener("click", () => {
        setUserFollowed(username, false);
        clearBtn.remove();
        entryEl.classList.add("wm-followed-dump-entry-cleared");
      });

      const textEl = document.createElement("div");
      textEl.className = "wm-followed-dump-text";
      textEl.appendChild(nameLink);
      const description = readUserDescription(username);
      if (description) {
        const descEl = document.createElement("span");
        descEl.className = "wm-user-desc";
        descEl.textContent = description;
        descEl.title = description;
        textEl.appendChild(descEl);
      }

      entryEl.append(clearBtn, textEl);
      list.appendChild(entryEl);
    });

    anchor.after(list);
  }

  function watchFollowedUsers() {
    addStyle(`
      .wm-followed-dump {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
        margin-top: 1rem;
        padding: 0.75rem 1rem;
        border-radius: 0.75rem;
        border: 1px solid var(--color-border);
      }
      .wm-followed-dump-title {
        grid-column: 1 / -1;
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
      }
      .wm-followed-dump-entry {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 0.5rem;
        transition: opacity 0.2s ease;
      }
      .wm-followed-dump-entry-cleared {
        opacity: 0.35;
      }
      .wm-followed-dump-text {
        min-width: 0;
        display: flex;
        gap: 0.5rem;
      }
      .wm-followed-dump-name {
        font-size: 0.825rem;
        font-weight: 600;
        text-decoration: none;
      }
      .wm-followed-dump-name:hover {
        text-decoration: underline;
      }
      .wm-followed-dump-clear {
        border: none;
        background: transparent;
        color: var(--color-foreground);
        opacity: 0.5;
        cursor: pointer;
        line-height: 1;
        transition: opacity 0.2s ease, color 0.2s ease;
      }
      .wm-followed-dump-clear:hover {
        opacity: 1;
        color: #ef2222;
      }
      .wm-follow-btn {
        margin-right: 0.5rem;
      }
      .wm-follow-btn[aria-pressed="true"],
      .wm-follow-btn[aria-pressed="true"]:not(:hover) {
        color: #ef4444 !important;
      }
      .wm-follow-name {
        white-space: nowrap;
      }
      .wm-follow-eye {
        display: inline;
        white-space: nowrap;
        vertical-align: middle;
        margin-top: 2px;
        margin-left: 0.25rem;
        color: #ef4444;
      }
      .wm-follow-eye::before {
        /* Word joiner: no line break between the name and its eye */
        content: "\\2060";
      }
      .wm-follow-eye svg {
        display: inline-block;
        vertical-align: central;
        width: 1em;
        height: 1em;
      }
    `);

    const update = () => {
      insertFollowButton();
      updateFollowEyes();
      renderFollowedUsersList();
    };
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 37: on /collection, whenever the bulk-action popover (div.bottom-4) is in the DOM, hide every <button> inside it
  // whose text contains "favori" ("Mettre en favori (N)" and "Retirer des favoris (N)"). Matched on the text rather
  // than on a class, since the site gives those buttons no stable hook; re-applied on every mutation because the popover
  // re-renders its buttons whenever the selection changes. /global-collection is left alone (the path check is a prefix
  // match on "/collection", which that route doesn't share).
  // ============================================================
  function hideBulkActionFavoriteButtons() {
    if (!window.location.pathname.startsWith("/collection")) return;

    document.querySelectorAll("div.bottom-4 button").forEach((btn) => {
      if (btn.style.display === "none") return;
      if (btn.textContent.includes("favori")) btn.style.display = "none";
    });
  }

  function watchBulkActionFavoriteButtons() {
    hideBulkActionFavoriteButtons();

    const observer = new MutationObserver(() =>
      hideBulkActionFavoriteButtons(),
    );
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 38: on /collection, a toggle button is appended right after Rule 35's "Top {limit}" button (.wm-top-evals-btn,
  // or at the end of the heading when that rule is off). While on, every card of the page that has no eval gets a
  // light red halo. "No eval" means no "eval-{name}" localStorage entry (Feature ETS): a stored "?" is an eval and
  // does not count. Cards are re-flagged (debounced) on every DOM mutation, since evals get recorded as cards are
  // opened; the halo itself is driven by a body attribute, so flipping the toggle needs no re-scan. The toggle
  // state is persisted in localStorage under "wm-no-eval-halo".
  // ============================================================
  const NO_EVAL_HALO_KEY = "wm-no-eval-halo";

  function readNoEvalHaloState() {
    try {
      return localStorage.getItem(NO_EVAL_HALO_KEY) === "true";
    } catch {
      return false;
    }
  }

  function applyNoEvalHaloState(on) {
    document.body.toggleAttribute("data-wm-no-eval-halo", on);
  }

  function flagCardsWithoutEval() {
    if (!window.location.pathname.startsWith("/collection")) return;

    const grid = document.querySelector("div.gap-3.justify-center");
    if (!grid) return;

    Array.from(grid.children).forEach((card) => {
      const cardName = card.querySelector("h3")?.textContent.trim();
      if (!cardName) return;

      const hasEval = !!localStorage.getItem(`eval-${cardName}`);
      card.classList.toggle("wm-no-eval-card", !hasEval);
    });
  }

  function insertNoEvalHaloToggle() {
    if (!window.location.pathname.startsWith("/collection")) return;

    const heading = document.querySelector("div.gap-3.animate-fade-in-up h1");
    if (!heading || heading.querySelector(":scope > .wm-no-eval-toggle"))
      return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wm-no-eval-toggle";
    btn.textContent = "Sans estimation";
    btn.title = "Entourer d'un halo rouge les cartes sans estimation";

    const sync = () => {
      const on = readNoEvalHaloState();
      btn.setAttribute("aria-pressed", String(on));
      btn.classList.toggle("wm-no-eval-toggle-on", on);
      applyNoEvalHaloState(on);
    };
    btn.addEventListener("click", () => {
      try {
        const next = !readNoEvalHaloState();
        localStorage.setItem(NO_EVAL_HALO_KEY, String(next));
        logger(CPL.LOG, `No-estimate halo: ${next}`);
      } catch {
        logger(CPL.ERROR, "Failed to save no-estimate halo state");
      }
      sync();
    });
    sync();

    const topBtn = heading.querySelector(":scope > .wm-top-evals-btn");
    if (topBtn) topBtn.after(btn);
    else heading.appendChild(btn);
  }

  function watchNoEvalHalo() {
    addStyle(`
      .wm-no-eval-toggle {
        margin-left: 0.5rem;
        padding: 0.2rem 0.6rem;
        border: 1px solid #ff8080;
        border-radius: 0.5rem;
        background: transparent;
        color: #ff8080;
        font-size: 0.8rem;
        font-weight: 600;
        vertical-align: middle;
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 0.2s ease, background-color 0.2s ease;
      }
      .wm-no-eval-toggle:hover,
      .wm-no-eval-toggle-on {
        opacity: 1;
        background: rgba(255, 128, 128, 0.15);
      }
      body[data-wm-no-eval-halo] .wm-no-eval-card {
        z-index: 2;
        box-shadow: 0 0 14px 4px rgba(255, 128, 128, 0.55);
        border-radius: 1rem;
      }
    `);

    applyNoEvalHaloState(readNoEvalHaloState());

    let debounceId = null;
    const update = () => {
      insertNoEvalHaloToggle();
      clearTimeout(debounceId);
      debounceId = setTimeout(flagCardsWithoutEval, 300);
    };
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature UDS: a short, personal description for other players, to remember what they are after, etc. On another
  // user's profile (/profile/{username}), a "Description" button (pencil icon) is added to the top-right row
  // (div.-mt-0.5), right before Feature FOL's follow button (or the "Signaler" one when that feature is off) and
  // styled after "Signaler". It opens a modal with a textarea holding the description, saved with the "Enregistrer"
  // button or Enter (an empty text deletes it); Escape, a click outside or the "✕" close the modal. The description
  // is kept in localStorage under "desc-{username}", must be max. 128 characters (the textarea's max length is
  // 127, a live counter is shown) and is single-line (line breaks are turned into spaces).
  //
  // Feature UDS (cont'd): the description is displayed, muted and not truncated, right after the username: on that
  // profile (div.flex-1.min-w-0 > h1.truncate) and on /friends (each friend's a[href^="/profile/"] > div.min-w-0 >
  // p.truncate). It is a span.wm-user-desc inserted as a sibling of the name element (the site's framework owns the
  // name's content); the name's parent becomes a wrapping flex row (wm-user-desc-host) so both sit on one line,
  // wrapping the description below the name when it doesn't fit.
  // ============================================================
  const USER_DESC_KEY_PREFIX = "desc-";
  const USER_DESC_MAX_LENGTH = 128;
  const USER_DESC_PENCIL_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path><path d="m15 5 4 4"></path></svg>';

  function readUserDescription(username) {
    try {
      return localStorage.getItem(`${USER_DESC_KEY_PREFIX}${username}`) ?? "";
    } catch {
      return "";
    }
  }

  // Returns whether the description could be persisted
  function writeUserDescription(username, text) {
    const key = `${USER_DESC_KEY_PREFIX}${username}`;
    const clean = text
      .replace(/\s*[\r\n]+\s*/g, " ")
      .trim()
      .slice(0, USER_DESC_MAX_LENGTH);
    try {
      if (clean) localStorage.setItem(key, clean);
      else localStorage.removeItem(key);
      logger(
        CPL.INFO,
        `Description ${clean ? "saved" : "deleted"} for ${username}`,
      );
      return true;
    } catch (error) {
      // Storage blocked, or its quota exhausted
      logger(CPL.ERROR, `Description not saved for ${username}`, error);
      return false;
    }
  }

  function syncUserDescription(nameEl, username) {
    const host = nameEl.parentElement;
    if (!host || !username) return;

    const text = readUserDescription(username);
    const existing = host.querySelector(":scope > .wm-user-desc");

    if (!text) {
      existing?.remove();
      host.classList.remove("wm-user-desc-host");
      return;
    }

    host.classList.add("wm-user-desc-host");
    if (existing) {
      if (existing.textContent !== text) existing.textContent = text;
      existing.title = text;
      return;
    }

    const span = document.createElement("span");
    span.className = "wm-user-desc";
    span.textContent = text;
    span.title = text;
    nameEl.after(span);
  }

  function updateUserDescriptions() {
    const path = window.location.pathname;

    if (path.startsWith("/profile/")) {
      const username = getViewedProfileUsername();
      const nameEl = document.querySelector("div.flex-1.min-w-0 > h1.truncate");
      if (username && nameEl && nameEl.textContent.trim() === username) {
        syncUserDescription(nameEl, username);
      }
    }

    if (path.startsWith("/friends")) {
      document
        .querySelectorAll('a[href^="/profile/"] > div.min-w-0 > p.truncate')
        .forEach((nameEl) => {
          const href = nameEl.closest("a").getAttribute("href");
          const username = decodeURIComponent(href.slice("/profile/".length));
          syncUserDescription(nameEl, username);
        });
    }
  }

  function buildUserDescriptionModal(username, onSave) {
    const overlay = document.createElement("div");
    overlay.className = "wm-settings-overlay";

    const modal = document.createElement("div");
    modal.className = "wm-settings-modal wm-user-desc-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", `Description de ${username}`);

    const header = document.createElement("div");
    header.className = "wm-settings-header";

    const title = document.createElement("h2");
    title.className = "wm-settings-title";
    title.textContent = `✏️ Description de ${username}`;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "wm-settings-close";
    closeBtn.setAttribute("aria-label", "Fermer");
    closeBtn.textContent = "✕";

    header.append(title, closeBtn);

    const textarea = document.createElement("textarea");
    textarea.className = "wm-user-desc-input";
    textarea.rows = 3;
    textarea.maxLength = USER_DESC_MAX_LENGTH;
    textarea.placeholder = "Ce qu'il cherche, ce qu'il propose...";
    textarea.setAttribute(
      "aria-label",
      `Description personnelle de ${username}`,
    );
    textarea.value = readUserDescription(username);

    const error = document.createElement("p");
    error.className = "wm-user-desc-error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    error.textContent =
      "Impossible d'enregistrer : le stockage du navigateur est indisponible ou plein.";

    const footer = document.createElement("div");
    footer.className = "wm-user-desc-footer";

    const counter = document.createElement("span");
    counter.className = "wm-user-desc-counter";
    const updateCounter = () => {
      counter.textContent = `${textarea.value.length} / ${USER_DESC_MAX_LENGTH}`;
    };
    updateCounter();
    textarea.addEventListener("input", () => {
      updateCounter();
      error.hidden = true;
    });

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "wm-user-desc-save";
    saveBtn.textContent = "Enregistrer";

    footer.append(counter, saveBtn);
    modal.append(header, textarea, error, footer);
    overlay.appendChild(modal);

    const onKeydown = (event) => {
      if (event.key === "Escape") close();
    };
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKeydown);
    };
    const save = () => {
      if (!writeUserDescription(username, textarea.value)) {
        // Keep the modal open with the edit intact, and say that nothing was saved
        error.hidden = false;
        return;
      }
      onSave();
      close();
    };

    textarea.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      save();
    });
    saveBtn.addEventListener("click", save);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", onKeydown);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 0);

    return overlay;
  }

  function insertUserDescriptionButton() {
    const username = getViewedProfileUsername();
    if (!username) return;

    const reportBtn = document.querySelector(
      'div.-mt-0\\.5 button[title^="Signaler"]',
    );
    const row = reportBtn?.parentElement;
    if (!reportBtn || !row) return;

    const existing = row.querySelector(":scope > .wm-user-desc-btn");
    if (existing) {
      // The viewed profile can change without the row being rebuilt
      existing.dataset.wmDescUser = username;
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${reportBtn.className.replace("wm-profile-btn", "").trim()} wm-user-desc-btn`;
    btn.dataset.wmDescUser = username;
    btn.title = "Modifier la description de ce joueur";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.innerHTML = `${USER_DESC_PENCIL_SVG}<span>Description</span>`;
    btn
      .querySelector("svg")
      .setAttribute("class", "size-2.5 shrink-0 opacity-80");

    btn.addEventListener("click", () => {
      if (document.querySelector(".wm-settings-overlay")) return;
      document.body.appendChild(
        buildUserDescriptionModal(
          btn.dataset.wmDescUser,
          updateUserDescriptions,
        ),
      );
    });

    (row.querySelector(":scope > .wm-follow-btn") ?? reportBtn).before(btn);
  }

  function watchUserDescriptions() {
    addStyle(`
      .wm-user-desc-host {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: 0.5rem;
      }
      .wm-user-desc-host > h1 ~ p {
        flex-basis: 100%;
      }
      .wm-user-desc {
        align-self: center;
        font-size: 0.75rem;
        font-weight: 400;
        color: var(--color-foreground);
        opacity: 0.5;
        overflow-wrap: anywhere;
      }
      .wm-user-desc-modal {
        width: min(28rem, 90vw);
      }
      .wm-user-desc-input {
        width: 100%;
        resize: vertical;
        padding: 0.5rem 0.75rem;
        border-radius: 0.5rem;
        border: 1px solid var(--color-border);
        background-color: var(--color-surface);
        color: var(--color-foreground);
        font: inherit;
        font-size: 0.875rem;
      }
      .wm-user-desc-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 0.5rem;
      }
      .wm-user-desc-error {
        margin: 0.5rem 0 0;
        font-size: 0.75rem;
        color: #ef4444;
      }
      .wm-user-desc-counter {
        font-size: 0.75rem;
        opacity: 0.6;
      }
      .wm-user-desc-save {
        padding: 0.3rem 0.9rem;
        border: 1px solid var(--color-accent);
        border-radius: 0.5rem;
        background: transparent;
        color: var(--color-accent);
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }
      .wm-user-desc-save:hover {
        background: rgba(255, 255, 255, 0.08);
      }
    `);

    const update = () => {
      insertUserDescriptionButton();
      updateUserDescriptions();
    };
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 39: on /achievements, every 10 seconds, look for a div.mt-2 (an achievement's progress bar, rendered once the
  // list has loaded). As soon as there is one, every div.mt-2 of the page is pinned to the bottom right of its card
  // ("position: absolute; bottom: 1rem; width: 50%; right: 1rem; margin: 0") and its first child gets "margin: 0".
  // The styles are inline and applied once per visit: the check is only repeated after leaving /achievements and
  // coming back (the site re-renders the list, so the elements are new ones).
  // ============================================================
  const ACHIEVEMENT_BARS_POLL_MS = 100;

  function pinAchievementProgressBars() {
    const bars = document.querySelectorAll("div.mt-2");
    if (bars.length === 0) return false;

    bars.forEach((bar) => {
      bar.style.cssText +=
        "position: absolute; bottom: 1rem; width: 40%; right: 1rem; margin: 0;";
      if (bar.firstElementChild) bar.firstElementChild.style.margin = "0";
    });
    return true;
  }

  function watchAchievementProgressBars() {
    let applied = false;

    const check = () => {
      if (!window.location.pathname.startsWith("/achievements")) {
        applied = false;
        return;
      }
      if (applied) return;
      applied = pinAchievementProgressBars();
    };

    check();
    setInterval(check, ACHIEVEMENT_BARS_POLL_MS);
  }

  // ============================================================
  // Feature WAT: watch auctions to find them back later. On an auction page (/marketplace/{UUID}), a "Surveiller"
  // button is added right after the back button (button.text-sm.gap-1\.5); clicking it stores the entry
  // "watched-{auction id}-{epoch in ms}-{card name}" in the array kept in localStorage under "wm-saved" (the button
  // then reads "Surveillée"; clicking it again removes the auction from the array). On the marketplace's list page,
  // a "Surveillées" button is appended to h1.text-2xl.gap-2: it opens a popover listing the watched auctions,
  // newest first, each a link to its page with how long ago it was watched and a "✕" to stop watching it. Every
  // time /profile is reached, the watched entries whose epoch is older than the "Suppression auto." delay of the
  // Configuration tab (Feature CFG, default 7 days), counted from the auction's end (or that can't be read) are
  // removed from the array; any other entry of "wm-saved" is left alone.
  //
  // Feature WAT (cont'd): on the marketplace's list page, every card (div[id^="marketplace-auction-"], whose id ends
  // with the auction's UUID) also gets a small pin button docked at its top right corner (button.wm-card-pin)
  // that watches / un-watches that auction the same way, without opening the card (its click is stopped before it
  // reaches the card). The pin is filled while the auction is watched.
  //
  // Feature WAT (cont'd): visiting a watched auction that is over un-watches it automatically. "Over" is: the page has
  // finished loading (no div.animate-spin, h1.flex-1 and span.text-2xl present, and the DOM has been quiet for a
  // second, so a page still hydrating isn't mistaken for an ended auction) and the "time left" span
  // (span.tabular-nums.font-medium, same as Feature PNB's) is absent.
  //
  // Feature WAT (cont'd): the entry's epoch is the auction's END, not the moment it was watched: "watched-{auction
  // id}-{end epoch in ms}-{card name}" (the end is estimated as now + the countdown, "Se termine dans 1h 44m"; "???"
  // when it isn't known yet, e.g. a pin on a list card showing no countdown). It lets the popover sort the watched
  // auctions by end date, soonest first. The legacy format held the watch epoch in that same slot. Both are told
  // apart by a hardcoded reference, WATCHED_LEGACY_REFERENCE_EPOCH (the moment the new format shipped): a number up
  // to it is a legacy watch epoch (no new entry can have an end before the reference), a larger one is an end. At
  // startup every legacy entry is sanitized in place — rewritten with "???" as its end epoch, same id and name, so
  // nothing is destroyed — and a "???" entry gets its real end the next time its auction page is displayed while
  // running; the end is also corrected when it drifts by more than 2 minutes (e.g. a last-seconds bid extends it).
  // The profile cleanup (Feature CFG's "Suppression auto." delay) now counts from the END of the auction, and keeps
  // the "???" entries.
  //
  // Feature WAT (cont'd): at the top of the popover's rows, a centered "Ouvrir les enchères terminées (n)" pill opens
  // every watched auction whose end epoch is known and past in its own background tab at once (GM_openInTab, which
  // popup blockers leave alone, with window.open as a fallback). Each opened auction is then unwatched by the
  // auto-unwatch of ended auctions. Disabled while none has expired.
  //
  // Feature WAT (cont'd): bidding on an auction watches it automatically. On a bid page, once it has finished loading
  // (same readiness checks as the auto-unwatch above) and is still running (the "time left" span is there), the
  // auction is watched as soon as your pseudo (Feature CFG's "Votre pseudo WikiMasters") is the current leader (Rule 33's isMyUsernameLeadingBid) or appears in
  // the bids history (a.hover:underline linking to /profile/{your pseudo} inside ul.card-frame's li). It is a
  // one-way action: an auction already watched is left alone, and each auction is only evaluated once per page
  // load (wmAutoWatchedIds), so stopping to watch it by hand sticks until the next reload.
  // ============================================================
  const WATCHED_KEY = "wm-saved";
  const WATCHED_PREFIX = "watched-";
  const WATCHED_ENTRY_REGEX =
    /^watched-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d+|\?\?\?)-(.*)$/is;
  const WATCHED_END_DRIFT_MS = 2 * 60 * 1000;
  const WATCHED_UNKNOWN_END = "???";
  // Moment the "end epoch" format shipped: a numeric epoch up to it is a legacy watch epoch
  const WATCHED_LEGACY_REFERENCE_EPOCH = 1792679868375;

  function readSavedEntries() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WATCHED_KEY) ?? "[]");
      return Array.isArray(parsed)
        ? parsed.filter((entry) => typeof entry === "string")
        : [];
    } catch (error) {
      logger(CPL.WARN, `${WATCHED_KEY} unreadable, treated as empty`, error);
      return [];
    }
  }

  function writeSavedEntries(entries) {
    try {
      localStorage.setItem(WATCHED_KEY, JSON.stringify(entries));
      return true;
    } catch (error) {
      logger(CPL.ERROR, `${WATCHED_KEY} not saved`, error);
      return false;
    }
  }

  function parseWatchedEntry(entry) {
    const match = entry.match(WATCHED_ENTRY_REGEX);
    if (!match) return null;
    const epoch =
      match[2] === WATCHED_UNKNOWN_END ? null : parseInt(match[2], 10);
    const isLegacy = epoch !== null && epoch <= WATCHED_LEGACY_REFERENCE_EPOCH;
    return {
      entry,
      id: match[1],
      name: match[3],
      isLegacy,
      endEpoch: epoch === null || isLegacy ? null : epoch,
    };
  }

  function buildWatchedEntry(id, endEpoch, name) {
    return `${WATCHED_PREFIX}${id}-${endEpoch ?? WATCHED_UNKNOWN_END}-${name}`;
  }

  // Rewrites every legacy entry with "???" as its end epoch (nothing is removed)
  function sanitizeLegacyWatchedEntries() {
    const entries = readSavedEntries();
    let sanitized = 0;
    const next = entries.map((entry) => {
      if (!entry.startsWith(WATCHED_PREFIX)) return entry;
      const watched = parseWatchedEntry(entry);
      if (!watched?.isLegacy) return entry;
      sanitized++;
      return buildWatchedEntry(watched.id, null, watched.name);
    });
    if (sanitized === 0) return;
    if (writeSavedEntries(next))
      logger(
        CPL.INFO,
        `Watched auctions: ${sanitized} legacy entr${sanitized > 1 ? "ies" : "y"} sanitized (end epoch set to "${WATCHED_UNKNOWN_END}")`,
      );
  }

  // "1h 44m", "2j 3h", "45s"... (j or d for days, min or m for minutes) -> milliseconds, null when it isn't one
  const TIME_LEFT_TOKEN_REGEX = /(\d+)\s*(j|d|h|min|m|s)(?![a-zà-ÿ])/gi;
  const TIME_LEFT_UNIT_MS = {
    j: 86400000,
    d: 86400000,
    h: 3600000,
    min: 60000,
    m: 60000,
    s: 1000,
  };

  function parseTimeLeftMs(text) {
    const tokens = Array.from(text.matchAll(TIME_LEFT_TOKEN_REGEX));
    if (tokens.length === 0) return null;
    return tokens.reduce(
      (sum, [, amount, unit]) =>
        sum + parseInt(amount, 10) * TIME_LEFT_UNIT_MS[unit.toLowerCase()],
      0,
    );
  }

  function endEpochFromTimeLeft(text) {
    const remaining = parseTimeLeftMs(text);
    if (remaining === null) return null;
    return Math.round((Date.now() + remaining) / 1000) * 1000;
  }

  function getBidPageEndEpoch() {
    const span = document.querySelector("span.tabular-nums.font-medium");
    const text = span?.textContent.trim() ?? "";
    if (!/dans\s/i.test(text)) return null;
    return endEpochFromTimeLeft(text.replace(/^.*?dans\s/i, ""));
  }

  // List cards: the countdown is the card's leaf element made only of time tokens, optionally after "dans"
  const CARD_TIME_LEFT_REGEX =
    /^(?:se termine\s+)?(?:dans\s+)?(?:\d+\s*(?:j|d|h|min|m|s)\s*)+$/i;

  function getCardEndEpoch(card) {
    for (const el of card.querySelectorAll("span, p, div")) {
      if (el.children.length > 0) continue;
      const text = el.textContent.trim();
      if (text && CARD_TIME_LEFT_REGEX.test(text))
        return endEpochFromTimeLeft(text.replace(/^.*?dans\s/i, ""));
    }
    return null;
  }

  function formatWatchEnd(endEpoch) {
    const minutes = Math.ceil((endEpoch - Date.now()) / 60000);
    if (minutes <= 0) return "terminée";
    if (minutes < 60) return `dans ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `dans ${hours} h ${minutes % 60} min`;
    return `dans ${Math.floor(hours / 24)} j ${hours % 24} h`;
  }

  // Running auctions first (soonest end first), then unknown ends, then finished ones (oldest end first)
  function watchedSortRank(watched) {
    if (watched.endEpoch === null) return 1;
    return watched.endEpoch > Date.now() ? 0 : 2;
  }

  function compareWatchedByEnd(a, b) {
    const rank = watchedSortRank(a) - watchedSortRank(b);
    if (rank !== 0) return rank;
    if (a.endEpoch !== null && b.endEpoch !== null)
      return a.endEpoch - b.endEpoch;
    return a.name.localeCompare(b.name);
  }

  function readWatchedAuctions() {
    return readSavedEntries()
      .filter((entry) => entry.startsWith(WATCHED_PREFIX))
      .map(parseWatchedEntry)
      .filter((watched) => watched !== null);
  }

  function getBidPageCardName() {
    const nameEl = document.querySelector("h1.flex-1");
    if (!nameEl) return "";
    return Array.from(nameEl.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim();
  }

  // Watches the auction, or stops watching it when it already is. Returns whether it is now watched, or null when
  // nothing could be done (no card name to store, or storage refused the write).
  function toggleWatchedAuction(id, name, endEpoch = null) {
    const entries = readSavedEntries();

    if (readWatchedAuctions().some((w) => w.id === id)) {
      const kept = entries.filter(
        (entry) => parseWatchedEntry(entry)?.id !== id,
      );
      if (!writeSavedEntries(kept)) return null;
      logger(CPL.INFO, `Auction unwatched: "${name}" (${id})`);
      return false;
    }

    if (!name) {
      logger(CPL.WARN, `Auction ${id} not watched: card name not found`);
      return null;
    }
    const entry = buildWatchedEntry(id, endEpoch, name);
    if (!writeSavedEntries([...entries, entry])) return null;
    logger(
      CPL.INFO,
      `Auction watched: "${name}" (${id}), ends ${endEpoch ? new Date(endEpoch).toISOString() : "at an unknown time"}`,
    );
    return true;
  }

  function setWatchButtonState(btn, watched) {
    btn.setAttribute("aria-pressed", String(watched));
    btn.textContent = watched ? "📌 Surveillée" : "📌 Surveiller";
    btn.title = watched
      ? "Ne plus surveiller cette enchère"
      : "Surveiller cette enchère";
  }

  function ensureWatchButton() {
    const existing = document.querySelector(".wm-watch-btn");
    const match = window.location.pathname.match(MARKETPLACE_BID_PATH_REGEX);
    if (!match) {
      existing?.remove();
      return;
    }

    const id = match[1];
    const backBtn = document.querySelector("button.text-sm.gap-1\\.5");
    if (!backBtn) return;

    if (existing && existing.dataset.wmWatchId !== id) existing.remove();
    let btn = existing?.dataset.wmWatchId === id ? existing : null;
    const isWatched = readWatchedAuctions().some((w) => w.id === id);

    if (btn) {
      if (btn.getAttribute("aria-pressed") !== String(isWatched))
        setWatchButtonState(btn, isWatched);
      return;
    }

    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wm-watch-btn";
    btn.dataset.wmWatchId = id;
    setWatchButtonState(btn, isWatched);

    btn.addEventListener("click", () => {
      const watchedNow = toggleWatchedAuction(
        id,
        getBidPageCardName(),
        getBidPageEndEpoch(),
      );
      if (watchedNow !== null) setWatchButtonState(btn, watchedNow);
    });

    backBtn.after(btn);
  }

  function closeWatchPopover() {
    document.querySelector(".wm-watch-popover")?.remove();
  }

  function renderWatchPopover(popover) {
    popover.textContent = "";

    const watched = readWatchedAuctions().sort(compareWatchedByEnd);
    if (watched.length === 0) {
      const empty = document.createElement("p");
      empty.className = "wm-watch-empty";
      empty.textContent = "Aucune enchère surveillée.";
      popover.appendChild(empty);
      return;
    }

    const expired = watched.filter(
      (w) => w.endEpoch !== null && w.endEpoch <= Date.now(),
    );
    const openExpiredBtn = document.createElement("button");
    openExpiredBtn.type = "button";
    openExpiredBtn.className = "wm-watch-open-expired";
    openExpiredBtn.textContent = `Ouvrir les enchères terminées (${expired.length})`;
    openExpiredBtn.disabled = expired.length === 0;
    openExpiredBtn.addEventListener("click", () => {
      logger(CPL.INFO, `Opening ${expired.length} expired watched auction(s)`);
      expired.forEach(({ id, name }) => {
        const url = `${window.location.origin}/marketplace/${id}`;
        logger(CPL.LOG, `Expired watched auction opened: "${name}" (${id})`);
        if (typeof GM_openInTab === "function")
          GM_openInTab(url, { active: false, insert: true });
        else window.open(url, "_blank");
      });
    });
    popover.appendChild(openExpiredBtn);

    watched.forEach(({ entry, id, name, endEpoch }) => {
      const row = document.createElement("div");
      row.className = "wm-watch-row";

      const link = document.createElement("a");
      link.className = "wm-watch-link";
      link.href = `/marketplace/${id}`;
      link.textContent = name;
      link.title = name;
      link.addEventListener("click", () =>
        logger(CPL.INFO, `Watched auction opened: "${name}" (${id})`),
      );

      const age = document.createElement("span");
      age.className = "wm-watch-age";
      age.textContent =
        endEpoch !== null ? formatWatchEnd(endEpoch) : "fin inconnue";
      age.title =
        endEpoch !== null
          ? `Fin : ${new Date(endEpoch).toLocaleString()}`
          : "Fin inconnue : elle sera enregistrée à la prochaine visite de l'enchère";

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "wm-watch-remove";
      removeBtn.setAttribute("aria-label", `Ne plus surveiller ${name}`);
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        const kept = readSavedEntries().filter((saved) => saved !== entry);
        if (!writeSavedEntries(kept)) return;
        logger(CPL.INFO, `Auction unwatched: "${name}" (${id})`);
        renderWatchPopover(popover);
        updateWatchListButtonCount();
      });

      row.append(link, age, removeBtn);
      popover.appendChild(row);
    });
  }

  function updateWatchListButtonCount() {
    const btn = document.querySelector(".wm-watch-list-btn");
    if (!btn) return;
    const label = `📌 Surveillées (${readWatchedAuctions().length})`;
    if (btn.textContent !== label) btn.textContent = label;
  }

  function openWatchPopover(btn) {
    const popover = document.createElement("div");
    popover.className = "wm-watch-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Enchères surveillées");
    renderWatchPopover(popover);
    document.body.appendChild(popover);

    const rect = btn.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 8}px`;
    popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 8))}px`;
    logger(
      CPL.LOG,
      `Watched auctions popover opened (${popover.querySelectorAll(".wm-watch-row").length})`,
    );

    const dismiss = (event) => {
      // Closed another way (the button toggles it): stop listening
      if (!popover.isConnected) {
        document.removeEventListener("click", dismiss, true);
        document.removeEventListener("keydown", dismiss);
        return;
      }
      const outside =
        event.type === "keydown"
          ? event.key === "Escape"
          : !popover.contains(event.target) && !btn.contains(event.target);
      if (!outside) return;
      closeWatchPopover();
      document.removeEventListener("click", dismiss, true);
      document.removeEventListener("keydown", dismiss);
    };
    document.addEventListener("click", dismiss, true);
    document.addEventListener("keydown", dismiss);
  }

  function ensureWatchListButton() {
    const isListPage =
      window.location.pathname.startsWith("/marketplace") &&
      !MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname);
    const existing = document.querySelector(".wm-watch-list-btn");
    if (!isListPage) {
      existing?.remove();
      closeWatchPopover();
      return;
    }

    const h1 = document.querySelector("h1.text-2xl.gap-2");
    if (!h1) return;

    if (existing && existing.parentElement === h1) {
      updateWatchListButtonCount();
      return;
    }
    existing?.remove();

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wm-watch-list-btn";
    btn.title = "Enchères surveillées";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.addEventListener("click", () => {
      if (document.querySelector(".wm-watch-popover")) {
        closeWatchPopover();
        logger(CPL.LOG, "Watched auctions popover closed (button clicked)");
        return;
      }
      openWatchPopover(btn);
    });
    h1.appendChild(btn);
    updateWatchListButtonCount();
  }

  const WATCH_PIN_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>';
  const WATCH_CARD_ID_PREFIX = "marketplace-auction-";

  function setCardPinState(pin, watched) {
    pin.setAttribute("aria-pressed", String(watched));
    pin.title = watched
      ? "Ne plus surveiller cette enchère"
      : "Surveiller cette enchère";
  }

  function ensureCardPins() {
    const pins = document.querySelectorAll(".wm-card-pin");
    const isListPage =
      window.location.pathname.startsWith("/marketplace") &&
      !MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname);
    if (!isListPage) {
      pins.forEach((pin) => pin.remove());
      return;
    }

    const watchedIds = new Set(readWatchedAuctions().map((w) => w.id));
    let added = 0;

    document
      .querySelectorAll(`div[id^="${WATCH_CARD_ID_PREFIX}"]`)
      .forEach((card) => {
        const id = card.id.slice(WATCH_CARD_ID_PREFIX.length);
        if (!/^[0-9a-f-]{36}$/i.test(id)) return;

        const existing = card.querySelector(":scope > .wm-card-pin");
        if (existing) {
          const isWatched = watchedIds.has(id);
          if (existing.getAttribute("aria-pressed") !== String(isWatched))
            setCardPinState(existing, isWatched);
          return;
        }

        if (getComputedStyle(card).position === "static")
          card.style.position = "relative";

        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "wm-card-pin";
        pin.innerHTML = WATCH_PIN_SVG;
        setCardPinState(pin, watchedIds.has(id));
        // The card itself opens the auction on click: keep this click for the pin
        pin.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const name = card.querySelector("h3")?.textContent.trim() ?? "";
          const watchedNow = toggleWatchedAuction(
            id,
            name,
            getCardEndEpoch(card),
          );
          if (watchedNow === null) return;
          setCardPinState(pin, watchedNow);
          updateWatchListButtonCount();
          const popover = document.querySelector(".wm-watch-popover");
          if (popover) renderWatchPopover(popover);
        });
        card.appendChild(pin);
        added++;
      });

    if (added > 0) traceOnce(`[WAT] pin added on ${added} marketplace card(s)`);
  }

  const WATCH_OVER_CHECK_DELAY_MS = 1000;
  let watchOverCheckTimerId = null;

  function unwatchAuctionIfOver() {
    const match = window.location.pathname.match(MARKETPLACE_BID_PATH_REGEX);
    if (!match) return;

    const id = match[1];
    if (!readWatchedAuctions().some((w) => w.id === id)) return;

    // Still loading: the countdown isn't there yet either
    if (document.querySelector("div.animate-spin")) return;
    if (!document.querySelector("h1.flex-1")) return;
    if (!document.querySelector("span.text-2xl")) return;

    if (document.querySelector("span.tabular-nums.font-medium")) return;

    logger(CPL.INFO, `Watched auction is over, un-watching it (${id})`);
    if (toggleWatchedAuction(id, getBidPageCardName()) === false)
      ensureWatchButton();
  }

  function scheduleUnwatchAuctionIfOver() {
    clearTimeout(watchOverCheckTimerId);
    if (!MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname)) return;
    watchOverCheckTimerId = setTimeout(
      unwatchAuctionIfOver,
      WATCH_OVER_CHECK_DELAY_MS,
    );
  }

  // Adds the end epoch to a watched auction displayed while running (legacy entry), or corrects it when it drifted
  function refreshWatchedEndEpoch() {
    const match = window.location.pathname.match(MARKETPLACE_BID_PATH_REGEX);
    if (!match) return;

    const watched = readWatchedAuctions().find((w) => w.id === match[1]);
    if (!watched) return;

    const endEpoch = getBidPageEndEpoch();
    if (endEpoch === null) return;
    if (
      watched.endEpoch !== null &&
      Math.abs(endEpoch - watched.endEpoch) <= WATCHED_END_DRIFT_MS
    )
      return;

    const entries = readSavedEntries();
    const index = entries.indexOf(watched.entry);
    if (index < 0) return;
    entries[index] = buildWatchedEntry(watched.id, endEpoch, watched.name);
    if (writeSavedEntries(entries))
      logger(
        CPL.INFO,
        `Watched auction end ${watched.endEpoch === null ? "recorded" : "corrected"}: "${watched.name}" (${watched.id}), ends ${new Date(endEpoch).toISOString()}`,
      );
  }

  const wmAutoWatchedIds = new Set();

  function isMyUsernameInBidHistory() {
    const me = getMyUsername();
    if (me === "") return false;

    return Boolean(
      document.querySelector(
        `ul.card-frame li a[href="/profile/${encodeURIComponent(me)}"]`,
      ),
    );
  }

  function watchAuctionIfBidding() {
    const match = window.location.pathname.match(MARKETPLACE_BID_PATH_REGEX);
    if (!match) return;

    const id = match[1];
    if (wmAutoWatchedIds.has(id)) return;

    // Still loading, or over: nothing to watch
    if (document.querySelector("div.animate-spin")) return;
    if (!document.querySelector("h1.flex-1")) return;
    if (!document.querySelector("span.text-2xl")) return;
    if (!document.querySelector("span.tabular-nums.font-medium")) return;

    const isLeading = isMyUsernameLeadingBid();
    if (!isLeading && !isMyUsernameInBidHistory()) return;

    wmAutoWatchedIds.add(id);
    if (readWatchedAuctions().some((w) => w.id === id)) {
      logger(CPL.LOG, `Auction already watched, nothing to do (${id})`);
      return;
    }
    logger(
      CPL.INFO,
      `You bid on this auction (${isLeading ? "leading" : "in the history"}), watching it (${id})`,
    );
    if (
      toggleWatchedAuction(id, getBidPageCardName(), getBidPageEndEpoch()) ===
      true
    )
      ensureWatchButton();
  }

  let watchedCleanedForVisit = false;

  function cleanupWatchedAuctions() {
    if (!/^\/profile\/?$/.test(window.location.pathname)) {
      watchedCleanedForVisit = false;
      return;
    }
    if (watchedCleanedForVisit) return;
    watchedCleanedForVisit = true;

    const entries = readSavedEntries();
    const maxAge = readConfig()[WATCHED_MAX_AGE_CONFIG_ID];
    const limit = Date.now() - WATCHED_MAX_AGE_OPTIONS_MS[maxAge];
    logger(CPL.LOG, `Watched auctions cleanup: max age is ${maxAge}`);
    const kept = entries.filter((entry) => {
      if (!entry.startsWith(WATCHED_PREFIX)) return true;
      const watched = parseWatchedEntry(entry);
      if (!watched) {
        logger(CPL.WARN, `Unreadable watched entry removed: ${entry}`);
        return false;
      }
      return watched.endEpoch === null || watched.endEpoch >= limit;
    });

    if (kept.length === entries.length) {
      logger(CPL.LOG, "Watched auctions cleanup: nothing to remove");
      return;
    }
    if (writeSavedEntries(kept))
      logger(
        CPL.INFO,
        `Watched auctions cleanup: ${entries.length - kept.length} removed, ${kept.length} kept`,
      );
  }

  function watchWatchedAuctions() {
    addStyle(`
      .wm-watch-btn,
      .wm-watch-list-btn {
        font-size: 0.9rem;
        margin-left: 0.75rem;
        padding: 0.5rem 0.75rem;
        border-radius: 0.5rem;
        line-height: 1;
        border: none;
        background: #ffffff0f;
        color: var(--color-foreground);
        cursor: pointer;
        transition: background 0.2s ease, color 0.2s ease;
      }
      .wm-watch-btn:hover,
      .wm-watch-list-btn:hover {
        background: #ffffff3f;
      }
      .wm-watch-btn[aria-pressed="true"] {
        color: var(--color-accent);
      }
      .wm-card-pin {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        z-index: 30;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        padding: 0;
        border: none;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
        opacity: 0.7;
        cursor: pointer;
        transition: opacity 0.2s ease, color 0.2s ease, background 0.2s ease;
      }
      .wm-card-pin:hover {
        opacity: 1;
        background: rgba(0, 0, 0, 0.8);
      }
      .wm-card-pin svg {
        width: 1rem;
        height: 1rem;
      }
      .wm-card-pin[aria-pressed="true"] {
        opacity: 1;
        color: var(--color-accent);
      }
      .wm-card-pin[aria-pressed="true"] svg {
        fill: currentColor;
      }
      .wm-watch-popover {
        position: fixed;
        z-index: 9998;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: min(30rem, 25vw);
        max-width: 50vw;
        max-height: 80vh;
        overflow-y: auto;
        padding: 0.5rem;
        border-radius: 0.75rem;
        border: 1px solid var(--color-border);
        background-color: var(--color-surface-light);
        color: var(--color-foreground);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      }
      .wm-watch-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.35rem 0.5rem;
        border-radius: 0.5rem;
      }
      .wm-watch-row:hover {
        background: #ffffff0f;
      }
      .wm-watch-link {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.85rem;
        font-weight: 600;
        text-decoration: none;
      }
      .wm-watch-link:hover {
        text-decoration: underline;
      }
      .wm-watch-age {
        margin-left: 0.5rem;
        flex-shrink: 0;
        font-size: 0.75rem;
        opacity: 0.55;
      }
      .wm-watch-remove {
        border: none;
        background: transparent;
        color: var(--color-foreground);
        opacity: 0.5;
        cursor: pointer;
        line-height: 1;
        transition: opacity 0.2s ease, color 0.2s ease;
      }
      .wm-watch-remove:hover {
        opacity: 1;
        color: #ef2222;
      }
      .wm-watch-open-expired {
        align-self: center;
        margin-block: 0.25rem;
        padding: 0.25rem 0.75rem;
        border: 2px solid var(--color-accent);
        border-radius: 100vw;
        background: transparent;
        color: var(--color-accent);
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s ease;
      }
      .wm-watch-open-expired:hover:not(:disabled) {
        background: color-mix(in srgb, var(--color-accent) 20%, transparent);
      }
      .wm-watch-open-expired:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .wm-watch-empty {
        margin: 0;
        padding: 0.5rem;
        font-size: 0.85rem;
        opacity: 0.6;
      }
    `);

    const update = () => {
      ensureWatchButton();
      ensureWatchListButton();
      ensureCardPins();
      cleanupWatchedAuctions();
      scheduleUnwatchAuctionIfOver();
      watchAuctionIfBidding();
      refreshWatchedEndEpoch();
    };
    sanitizeLegacyWatchedEntries();
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature CFG (cont'd): the pseudo is detected so that nobody has to type it. On your own profile (/profile), the
  // name heading (div.flex-1.min-w-0 > h1.truncate, own text nodes only: other features add elements inside it) is
  // read, and when the "Votre pseudo WikiMasters" setting is still empty it is filled with it. A pseudo that is already
  // set is never overwritten (a different one found on the page is only reported as a warning), so a wrong guess of
  // this reading can't replace one already detected. The setting's field is read-only: the detection is the only way
  // it gets its value. Always on, like the settings button: it is what the sales/purchases
  // features rely on.
  // ============================================================
  function detectMyUsername() {
    if (!/^\/profile\/?$/.test(window.location.pathname)) return;

    const nameEl = document.querySelector("div.flex-1.min-w-0 > h1.truncate");
    if (!nameEl) return;

    const detected = Array.from(nameEl.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim();
    if (!detected || detected.length > CONFIG_TEXT_MAX_LENGTH) return;

    const configured = getMyUsername();
    if (configured === "") {
      writeConfigValue(MY_USERNAME_CONFIG_ID, detected);
      logger(CPL.INFO, `Pseudo detected on your profile: ${detected}`);
    } else if (configured !== detected) {
      traceOnce(
        `[CFG] the profile reads "${detected}" but the pseudo setting is "${configured}": left as set`,
      );
    }
  }

  function watchMyUsernameDetection() {
    detectMyUsername();

    const observer = new MutationObserver(() => detectMyUsername());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 40: on /marketplace, on the "Parcourir" tab only, a switch is appended to the row of rarity filter buttons
  // (the div.flex-wrap.gap-2 holding button.rounded-full, in the search bar's div.space-y-3), styled after those
  // buttons, as /collection's action buttons are (Feature EBC). It sits in a div (wm-dim-up-dock) pushed to the end
  // of that row with an auto left margin, so it stays docked at its right whatever the number of filter buttons. It
  // is also kept as the row's last child: the "Réinitialiser" button the site appends once a filter is picked is moved
  // back in front of it (see keepDimUpDockLast). While it is on, the cards whose price arrow points
  // up (▲, Feature MPA: the price is at or above the reference, i.e. not a bargain) are dimmed to 50% opacity. MPA
  // flags such cards with data-wm-mpa-up; the dimming itself is driven by a body attribute
  // (data-wm-dim-up, only set while the switch is on AND "Parcourir" is the active tab), so flipping the switch or
  // changing tab needs no re-scan. The state is persisted in localStorage under "wm-dim-up-cards". The switch is
  // removed from the page when leaving the tab.
  // ============================================================
  const DIM_UP_CARDS_KEY = "wm-dim-up-cards";
  const DIM_UP_CARDS_OPACITY = 0.2;

  function readDimUpCardsState() {
    try {
      return localStorage.getItem(DIM_UP_CARDS_KEY) === "true";
    } catch {
      return false;
    }
  }

  function isParcourirTabActive() {
    return Array.from(
      document.querySelectorAll("div.overflow-x-auto button"),
    ).some(
      (btn) =>
        btn.textContent.trim().startsWith(MPA_TAB_LABELS[0]) &&
        btn.classList.contains("border-b-2"),
    );
  }

  // The rarity filter buttons' row of the marketplace search bar
  function findMarketplaceFilterRow() {
    return (
      Array.from(document.querySelectorAll("div.flex-wrap.gap-2")).find((row) =>
        row.querySelector(":scope > button.rounded-full"),
      ) ?? null
    );
  }

  function syncDimUpCardsAttribute(on) {
    const active =
      on &&
      window.location.pathname.startsWith("/marketplace") &&
      isParcourirTabActive();
    document.body.toggleAttribute("data-wm-dim-up", active);
  }

  // Keeps the dock the very last child of the row: once a rarity filter is picked, the site appends its own
  // "Réinitialiser" button at the end of the row, past our dock, so whatever follows the dock is moved back in
  // front of it. That button is pushed to the right by an auto margin of its own (ml-auto), and two auto margins
  // would split the free space between them: when a previous sibling has one, the dock only gets a small margin and
  // follows it instead.
  function keepDimUpDockLast(row, dock) {
    Array.from(row.children)
      .filter(
        (child) =>
          child !== dock &&
          dock.compareDocumentPosition(child) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      )
      .forEach((child) => row.insertBefore(child, dock));

    const followsAutoMargin = Array.from(row.children).some(
      (child) => child !== dock && child.classList.contains("ml-auto"),
    );
    dock.classList.toggle("wm-dim-up-dock-tight", followsAutoMargin);
  }

  function updateDimUpCardsSwitch() {
    // The switch lives in a dock (div.wm-dim-up-dock) pushed to the end of the row: both go away together
    const existing = document.querySelector(".wm-dim-up-dock");
    const onParcourir =
      window.location.pathname.startsWith("/marketplace") &&
      isParcourirTabActive();
    syncDimUpCardsAttribute(readDimUpCardsState());

    if (!onParcourir) {
      existing?.remove();
      return;
    }

    const row = findMarketplaceFilterRow();
    if (!row) return;
    if (existing && existing.parentElement === row) {
      keepDimUpDockLast(row, existing);
      return;
    }
    existing?.remove();

    // Styled after the row's own buttons, so it blends in; the colors are ours (those are set inline per rarity)
    const referenceBtn = row.querySelector(":scope > button.rounded-full");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${referenceBtn.className} wm-dim-up-switch`;
    btn.textContent = "▲ Estomper";
    btn.title = `Estomper à ${Math.round(DIM_UP_CARDS_OPACITY * 100)} % les cartes dont la flèche pointe vers le haut`;
    btn.setAttribute("role", "switch");

    const sync = () => {
      const on = readDimUpCardsState();
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-checked", String(on));
      syncDimUpCardsAttribute(on);
    };
    btn.addEventListener("click", () => {
      const next = !readDimUpCardsState();
      try {
        localStorage.setItem(DIM_UP_CARDS_KEY, String(next));
        logger(CPL.LOG, `Dim cards with a rising price: ${next}`);
      } catch (error) {
        logger(CPL.ERROR, "Dim switch state not saved", error);
      }
      sync();
    });
    sync();

    const dock = document.createElement("div");
    dock.className = "wm-dim-up-dock";
    dock.appendChild(btn);
    row.appendChild(dock);
    keepDimUpDockLast(row, dock);
  }

  function watchDimUpCardsSwitch() {
    addStyle(`
      .wm-dim-up-dock {
        display: flex;
        margin-left: auto;
      }
      .wm-dim-up-dock-tight {
        margin-left: 0.5rem;
      }
      .wm-dim-up-switch {
        border: 1px solid #fbbf24;
        background-color: transparent;
        color: #fbbf24;
      }
      .wm-dim-up-switch[aria-pressed="true"] {
        opacity: 1 !important;
        background-color: rgba(251, 191, 36, 0.2);
      }
      div[id^="marketplace-auction-"] {
        transition: opacity 0.2s ease;
      }
      body[data-wm-dim-up] div[id^="marketplace-auction-"][data-wm-mpa-up="true"] {
        opacity: ${DIM_UP_CARDS_OPACITY};
      }
    `);

    updateDimUpCardsSwitch();

    // Class changes too: switching tab can be nothing more than the tab buttons' classes changing
    const observer = new MutationObserver(() => updateDimUpCardsSwitch());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  // ============================================================
  // Rule 41: remembers the names of your tags. On /collection, whenever the tag filter's popover (ul.rounded-xl
  // [role="listbox"], the list Rules 24 and 34 work on) is open, the label of each of its options that starts with
  // "#" is read (without that "#" and without the trailing " (count)", via TAG_COUNT_REGEX) and the names are
  // stored as a JSON array in localStorage under "wm-tags", in the site's order. The list shows every tag you have, so
  // the stored array is replaced by what is read (a deleted tag disappears); it is only written when it changed.
  // The "Étiquette « TBD »" setting of Feature CFG offers these names. Not part of the export: it is rebuilt by
  // opening the list.
  // ============================================================
  const KNOWN_TAGS_KEY = "wm-tags";

  function readKnownTagNames() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KNOWN_TAGS_KEY) ?? "[]");
      return Array.isArray(parsed)
        ? parsed.filter((name) => typeof name === "string" && name !== "")
        : [];
    } catch {
      return [];
    }
  }

  function rememberTagNamesFrom(list) {
    const names = [];
    list.querySelectorAll('button[role="option"]').forEach((option) => {
      const label = option.textContent
        .trim()
        .replace(TAG_COUNT_REGEX, "")
        .trim();
      if (!label.startsWith("#")) return;

      const name = label.slice(1).trim();
      if (name && !names.includes(name)) names.push(name);
    });
    if (names.length === 0) return;

    if (JSON.stringify(names) === JSON.stringify(readKnownTagNames())) return;
    try {
      localStorage.setItem(KNOWN_TAGS_KEY, JSON.stringify(names));
      logger(CPL.INFO, `Tag names remembered (${names.length})`);
    } catch (error) {
      logger(CPL.ERROR, "Tag names not saved", error);
    }
  }

  function processTagNamesRecording() {
    if (!window.location.pathname.startsWith("/collection")) return;

    document
      .querySelectorAll('ul.rounded-xl[role="listbox"]')
      .forEach(rememberTagNamesFrom);
  }

  function watchTagNamesRecording() {
    processTagNamesRecording();

    const observer = new MutationObserver(() => processTagNamesRecording());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 42: in the owned card modal (div.card-frame.p-6), hitting Backspace in the tag input while it is empty moves
  // the focus to the remove button of the card's last tag (the chips are those of Feature TBD:
  // CARD_TAG_CHIPS_SELECTOR). The button is marked (data-wm-tag-nav) while it holds the focus: once it is clicked
  // (mouse, Enter or Space), the focus moves to the previous tag's button, or back to the input when none is left.
  // Nothing is removed by Backspace itself, and a held key (repeat) is ignored.
  // ============================================================
  const TAG_NAV_ATTRIBUTE = "data-wm-tag-nav";

  function getTagRemoveButtons() {
    return Array.from(document.querySelectorAll(CARD_TAG_CHIPS_SELECTOR))
      .map((chip) => chip.querySelector("button"))
      .filter(Boolean);
  }

  function handleTagInputBackspace(event) {
    if (event.key !== "Backspace" || event.repeat) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return;
    }

    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.value !== "") return;
    if (!input.matches("div.relative input")) return;
    if (!input.closest("div.card-frame.p-6")) return;

    const buttons = getTagRemoveButtons();
    if (buttons.length === 0) return;

    event.preventDefault();
    const last = buttons[buttons.length - 1];
    last.setAttribute(TAG_NAV_ATTRIBUTE, "");
    last.focus();
    logger(CPL.DEBUG, `Tag navigation: focus on last tag (${buttons.length})`);
  }

  async function handleTagRemoveClick(event) {
    const button =
      event.target instanceof Element
        ? event.target.closest(`button[${TAG_NAV_ATTRIBUTE}]`)
        : null;
    if (!button) return;

    const before = getTagRemoveButtons();
    const index = before.indexOf(button);
    const inputSelector = "div.card-frame.p-6 div.relative input";

    // The chips re-render once the tag is gone: wait for one fewer, then pick the previous one by its position
    const removed = await waitUntil(
      () => getTagRemoveButtons().length < before.length,
      { stopped: false },
    );
    if (!removed) return;

    const after = getTagRemoveButtons();
    const target = index > 0 ? after[index - 1] : null;
    if (target) {
      target.setAttribute(TAG_NAV_ATTRIBUTE, "");
      target.focus();
      logger(CPL.DEBUG, "Tag navigation: focus on previous tag");
    } else {
      document.querySelector(inputSelector)?.focus();
      logger(CPL.DEBUG, "Tag navigation: focus back on the tag input");
    }
  }

  function watchTagInputBackspace() {
    document.addEventListener("keydown", handleTagInputBackspace, true);
    document.addEventListener("click", handleTagRemoveClick, true);
    document.addEventListener(
      "focusout",
      (event) => {
        if (event.target instanceof Element) {
          event.target.removeAttribute(TAG_NAV_ATTRIBUTE);
        }
      },
      true,
    );
  }

  // ============================================================
  // Rule 43: hides the cards that are NOT in your wishlist (the "unwanted" ones) from /marketplace's "Parcourir" tab. The names come from
  // /global-collection: with its "wishlist only" toggle on (Rule 25's isWishlistOnlyToggleChecked), the names (h3)
  // of the cards of its list (div.gap-3.justify-center) are read, and only when the user clicks the "Feuilleter (WMB)"
  // button added next to the toggle (shown while it is on). That list is paginated (50 per page, "Page X / Y"),
  // and right after a load the site still shows the whole catalog (thousands of pages) before applying the toggle,
  // so a page is only read once two ticks in a row (WISHLIST_SETTLE_DELAY_MS apart) read the same page and Y is plausible (WISHLIST_MAX_PAGES at
  // most); the pages are then walked with the site's own "Suivant"/"Précédent" buttons until every one of them has
  // been read (a change of Y restarts the walk), and the page the visit started on is restored. Only a complete walk
  // replaces the names stored as a JSON array in localStorage under "wm-wishlist-names". On the marketplace, a
  // "Cacher indésirables" switch is added to Rule 40's dock, right before its "Estomper" one; the cards whose name is
  // not stored get data-wm-unwanted (nothing is flagged while no name is stored), and the hiding itself is driven by a body attribute (data-wm-hide-wished, only set
  // while the switch is on AND "Parcourir" is the active tab). The switch state is persisted under
  // "wm-hide-wished-cards". It needs Rule 40's dock, hence Rule 40 enabled.
  // ============================================================
  const WISHLIST_NAMES_KEY = "wm-wishlist-names";
  const HIDE_WISHED_CARDS_KEY = "wm-hide-wished-cards";
  const WISHLIST_MAX_PAGES = 30;
  const WISHLIST_SETTLE_DELAY_MS = 800;
  let wishlistWalk = null;
  let wishlistScanTimer = null;
  let wishlistLastSignature = "";

  function readWishlistNames() {
    try {
      const names = JSON.parse(
        localStorage.getItem(WISHLIST_NAMES_KEY) ?? "[]",
      );
      return new Set(Array.isArray(names) ? names : []);
    } catch (error) {
      logger(CPL.WARN, "Stored wishlist names unreadable, reset", error);
      return new Set();
    }
  }

  function clickWishlistPager(label) {
    const btn = Array.from(document.querySelectorAll("main button")).find((b) =>
      b.textContent.includes(label),
    );
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }

  function scanWishlistNames() {
    if (
      !window.location.pathname.startsWith("/global-collection") ||
      !isWishlistOnlyToggleChecked()
    ) {
      if (wishlistWalk) logger(CPL.LOG, "Wishlist browse cancelled");
      wishlistWalk = null;
      updateBrowseWishlistButton();
      return;
    }
    // Nothing is read on its own: only the "Feuilleter (WMB)" button starts a walk
    if (!wishlistWalk) return;

    const cardList = document.querySelector("div.gap-3.justify-center");
    const pageMatch = document
      .querySelector("main")
      ?.innerText.match(/Page (\d+) \/ (\d+)/);
    if (!cardList || !pageMatch) return;
    const page = Number(pageMatch[1]);
    const total = Number(pageMatch[2]);
    if (total > WISHLIST_MAX_PAGES) {
      logger(
        CPL.DEBUG,
        `Wishlist scan waits: ${total} pages is not a wishlist yet`,
      );
      if (wishlistWalk.waits++ >= 10) {
        logger(CPL.WARN, `Wishlist browse aborted: ${total} pages`);
        wishlistWalk = null;
        updateBrowseWishlistButton();
      } else {
        scheduleWishlistScan();
      }
      return;
    }

    const names = Array.from(cardList.children)
      .map(getWishlistCardName)
      .filter(Boolean);
    if (names.length === 0) return;

    // Settled once two ticks in a row read the same page: the site's own timers keep the DOM busy, so waiting for
    // it to go quiet could never end
    const signature = `${total}|${page}|${names.join("|")}`;
    if (signature !== wishlistLastSignature) {
      wishlistLastSignature = signature;
      scheduleWishlistScan();
      return;
    }

    if (wishlistWalk.total !== total) {
      wishlistWalk.total = total;
      wishlistWalk.startPage = page;
      wishlistWalk.pages = new Map();
    }
    wishlistWalk.pages.set(page, names);
    updateBrowseWishlistButton();

    const read = wishlistWalk.pages;
    const missing = Array.from({ length: total }, (_, i) => i + 1).filter(
      (n) => !read.has(n),
    );
    const moved = (label) => {
      if (clickWishlistPager(label)) return;
      logger(CPL.WARN, `Wishlist browse aborted: no "${label}" button`);
      wishlistWalk = null;
      updateBrowseWishlistButton();
    };
    if (missing.some((n) => n > page)) {
      moved("Suivant");
    } else if (missing.length > 0) {
      moved("Précédent");
    } else {
      const all = new Set([...read.values()].flat());
      try {
        const stored = JSON.stringify([...all]);
        if (localStorage.getItem(WISHLIST_NAMES_KEY) !== stored) {
          localStorage.setItem(WISHLIST_NAMES_KEY, stored);
          logger(
            CPL.INFO,
            `Wishlist names stored: ${all.size} over ${total} page(s)`,
          );
        }
      } catch (error) {
        logger(CPL.ERROR, "Wishlist names not saved", error);
      }
      if (page !== wishlistWalk.startPage) {
        clickWishlistPager(
          page < wishlistWalk.startPage ? "Suivant" : "Précédent",
        );
      }
      wishlistWalk = null;
      updateBrowseWishlistButton();
    }
  }

  function updateBrowseWishlistButton() {
    const btn = document.querySelector(".wm-browse-wishlist");
    if (!btn) return;
    btn.disabled = !!wishlistWalk;
    btn.textContent = wishlistWalk
      ? `Feuilletage… (${wishlistWalk.pages?.size ?? 0}/${wishlistWalk.total ?? "?"})`
      : "Feuilleter (WMB)";
  }

  function updateBrowseWishlistButtonVisibility() {
    const onWishlist =
      window.location.pathname.startsWith("/global-collection");
    const toggle = document.querySelector("button.gap-1\\.5:nth-child(1)");
    let btn = document.querySelector(".wm-browse-wishlist");
    if (!onWishlist || !toggle || !isWishlistOnlyToggleChecked()) {
      btn?.remove();
      return;
    }
    if (btn) return;

    btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${toggle.className} wm-browse-wishlist`;
    btn.title =
      "Parcourt toutes les pages de votre liste de souhaits pour mémoriser les noms des cartes (utilisés par « Cacher indésirables » sur le marché)";
    btn.addEventListener("click", () => {
      if (wishlistWalk) return;
      logger(CPL.INFO, "Wishlist browse started");
      wishlistWalk = {
        total: null,
        startPage: null,
        pages: new Map(),
        waits: 0,
      };
      wishlistLastSignature = "";
      updateBrowseWishlistButton();
      scheduleWishlistScan();
    });
    (document.querySelector(".wm-wishlist-cleanup") ?? toggle).after(btn);
    updateBrowseWishlistButton();
  }

  function scheduleWishlistScan() {
    if (!window.location.pathname.startsWith("/global-collection")) return;
    if (wishlistScanTimer) return;
    wishlistScanTimer = setTimeout(() => {
      wishlistScanTimer = null;
      scanWishlistNames();
    }, WISHLIST_SETTLE_DELAY_MS);
  }

  function readHideWishedState() {
    try {
      return localStorage.getItem(HIDE_WISHED_CARDS_KEY) === "true";
    } catch {
      return false;
    }
  }

  function markWishedCards() {
    const onParcourir =
      window.location.pathname.startsWith("/marketplace") &&
      isParcourirTabActive();
    document.body.toggleAttribute(
      "data-wm-hide-wished",
      onParcourir && readHideWishedState(),
    );
    if (!onParcourir) return;

    const names = readWishlistNames();
    document
      .querySelectorAll('div[id^="marketplace-auction-"]')
      .forEach((card) => {
        const name = card.querySelector("h3")?.textContent.trim();
        const unwanted = !!name && names.size > 0 && !names.has(name);
        if (card.hasAttribute("data-wm-unwanted") !== unwanted) {
          card.toggleAttribute("data-wm-unwanted", unwanted);
        }
      });
  }

  function updateHideWishedSwitch() {
    const dock = document.querySelector(".wm-dim-up-dock");
    if (!dock) return;
    if (dock.querySelector(".wm-hide-wished-switch")) return;

    const referenceBtn = dock.querySelector(".wm-dim-up-switch");
    if (!referenceBtn) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${referenceBtn.className} wm-hide-wished-switch`;
    btn.textContent = "Cacher indésirables";
    btn.title =
      "Cacher les cartes hors de votre liste de souhaits (noms lus sur /global-collection, liste de souhaits seule)";
    btn.setAttribute("role", "switch");

    const sync = () => {
      const on = readHideWishedState();
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-checked", String(on));
      markWishedCards();
      const known = readWishlistNames().size;
      const plural = known > 1 ? "s" : "";
      const hidden = document.querySelectorAll("[data-wm-unwanted]").length;
      btn.title = `Cacher les cartes hors de votre liste de souhaits (${known} nom${plural} mémorisé${plural}, ${hidden} carte${plural} cachée${plural} sur la page). Les noms se lisent sur /global-collection, liste de souhaits seule activée.`;
      if (on && known === 0) {
        logger(
          CPL.WARN,
          "Hide unwanted cards is on but no wishlist name is stored: open /global-collection with the wishlist-only toggle on",
        );
      }
    };
    btn.addEventListener("click", () => {
      const next = !readHideWishedState();
      try {
        localStorage.setItem(HIDE_WISHED_CARDS_KEY, String(next));
        logger(CPL.LOG, `Hide unwanted cards: ${next}`);
      } catch (error) {
        logger(CPL.ERROR, "Hide switch state not saved", error);
      }
      sync();
    });
    sync();
    dock.insertBefore(btn, referenceBtn);
  }

  // Rule 43 (cont'd): on /global-collection, clicking the card modal's wishlist button ("Ajouter à la liste de
  // souhaits" / "Retirer...") adds the card's name to, or removes it from, the stored names. Nothing is written while
  // no names are stored yet (a lone name would start hiding every other card on the marketplace: only a complete
  // walk may create the list).
  function syncWishlistNamesOnToggle(event) {
    if (!window.location.pathname.startsWith("/global-collection")) return;
    const btn = event.target.closest?.("div.card-frame.p-6 button");
    if (!btn || !/liste de souhaits|^\s*retirer/i.test(btn.textContent)) return;

    const nameEl = btn
      .closest("div.card-frame.p-6")
      .querySelector("h2.text-xl.pr-10");
    const cardName = Array.from(nameEl?.childNodes ?? [])
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim();
    if (!cardName) {
      logger(CPL.WARN, "Wishlist toggled but the card name was not found");
      return;
    }
    if (localStorage.getItem(WISHLIST_NAMES_KEY) === null) return;

    const adding = /^\s*ajouter/i.test(btn.textContent);
    const names = readWishlistNames();
    if (adding === names.has(cardName)) return;
    if (adding) names.add(cardName);
    else names.delete(cardName);
    try {
      localStorage.setItem(WISHLIST_NAMES_KEY, JSON.stringify([...names]));
      logger(
        CPL.INFO,
        `Wishlist names: "${cardName}" ${adding ? "added" : "removed"} (${names.size} stored)`,
      );
    } catch (error) {
      logger(CPL.ERROR, "Wishlist names not saved", error);
    }
  }

  function watchWishlistedCardsHiding() {
    document.addEventListener("click", syncWishlistNamesOnToggle, true);

    addStyle(`
      .wm-dim-up-dock {
        gap: 0.5rem;
      }
      body[data-wm-hide-wished] div[id^="marketplace-auction-"][data-wm-unwanted] {
        display: none;
      }
    `);

    const update = () => {
      if (wishlistWalk) scheduleWishlistScan();
      updateBrowseWishlistButtonVisibility();
      updateHideWishedSwitch();
      markWishedCards();
    };
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  // ============================================================
  // Rule 44: on /trades, in the trade detail modal (div.max-w-4xl, titled "Détail de l'échange"), a dark green
  // "(total {value})" span is appended to the "En échange de" paragraph: the sum of the cached ETS evals
  // (getCardEvalValueByName) of the cards listed under it (the h3 of the div following that paragraph). When at
  // least one of them has no usable eval, the sum of the others is followed by "+?" ("{value}+?", or just "?" when
  // none is known). The span (data-wm-trade-total) is rewritten in place when the sum changes and re-created if the
  // site's re-render drops it.
  // ============================================================
  const TRADE_TOTAL_ATTRIBUTE = "data-wm-trade-total";

  function computeTradeTotalLabel(cardsRow) {
    const names = Array.from(cardsRow.querySelectorAll("h3"))
      .map((h3) => h3.textContent.trim())
      .filter(Boolean);
    let sum = 0;
    let known = 0;
    names.forEach((name) => {
      const value = getCardEvalValueByName(name);
      if (value === null) return;
      sum += value;
      known++;
    });
    const missing = names.length - known;
    const amount = Math.round(sum).toLocaleString("fr-FR");
    let label;
    if (missing === 0) label = amount;
    else label = known === 0 ? "?" : `${amount}+?`;
    return { label, names: names.length, missing };
  }

  function updateTradeTotal() {
    if (!window.location.pathname.startsWith("/trades")) return;

    const modal = document.querySelector("div.max-w-4xl");
    if (!modal) return;

    const heading = Array.from(modal.querySelectorAll("p")).find(
      (p) => p.firstChild?.textContent.trim() === "En échange de",
    );
    const cardsRow = heading?.nextElementSibling;
    if (!heading || !cardsRow) return;

    const { label, names, missing } = computeTradeTotalLabel(cardsRow);
    if (names === 0) return;

    let span = heading.querySelector(`span[${TRADE_TOTAL_ATTRIBUTE}]`);
    const text = `(total ${label})`;
    if (span?.textContent === text) return;

    if (!span) {
      span = document.createElement("span");
      span.setAttribute(TRADE_TOTAL_ATTRIBUTE, "");
      span.style.cssText =
        "color:#15803d;margin-left:0.5rem;text-transform:none;font-weight:700;";
      heading.appendChild(span);
    }
    span.textContent = text;
    logger(
      CPL.LOG,
      `Trade total: ${label} (${names} card(s), ${missing} without estimate)`,
    );
  }

  function watchTradeTotal() {
    updateTradeTotal();

    const observer = new MutationObserver(() => updateTradeTotal());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 45 (started on every path, see startNavbarButtons): nav div.mb-8 gets a margin-bottom of 0.25rem (the site's own is 2rem), tightening the sidebar
  // ============================================================
  function applyNavBlockSpacing() {
    addStyle(`
      nav div.mb-8 {
        margin-bottom: 0.5rem !important;
      }
    `);
    logger(CPL.LOG, "Navigation block spacing applied");
  }

  // ============================================================
  // Init
  // ============================================================
  function main() {
    const flags = readFeatureFlags();
    logger(CPL.INFO, "Initialization start");
    const run = (id, fn) => {
      if (!flags[id]) {
        logger(CPL.DEBUG, `${id} is disabled, skipped`);
        return;
      }
      logger(CPL.DEBUG, `${id} starting (${fn.name})`);
      // One failing feature must not keep the following ones from starting: trackFeature reports it and moves on
      trackFeature(id, fn, "start")();
    };

    run("rule-1a", applyCardFrameMaxHeight);
    run("rule-1b", watchShrinkButtons);
    run("rule-2", watchAccentSiblings);
    run("rule-3", watchNavForTitleChanges);
    run("rule-4", watchFriendsGrid);
    run("rule-5", watchActionButtonLabels);
    run("rule-6", watchSidebarFold);
    run("rule-6", watchCardFrameDocking);
    run("rule-7", watchMarkAllReadTrigger);
    run("rule-7", watchMarkAllReadButtonStyle);
    run("feature-tbc", watchCollectionQuickActionButtons);
    run("rule-10", watchItemButtonIndexDisplay);
    run("rule-11", watchPullsOpacity);
    run("feature-pnp", watchPullsCounterNotification);
    run("rule-12", watchProfileButtonColor);
    run("rule-13", watchNotificationBoardArrival);
    run("feature-tmb", watchAuctionGroupToggle);
    run("rule-9", watchAuctionsTabArrival);
    run("feature-cme", watchPullsModalEscape);
    run("feature-pnb", watchBidTimerNotification);
    run("feature-car", watchClaimAllButton);
    run("feature-akp", watchPullsArrowNavigation);
    run("feature-akp", watchPullsTutorialPanel);
    run("feature-sat", watchSelectUntaggedButton);
    run("feature-lbd", watchStartingBidEnterKey);
    run("rule-14", watchWishlistToastWrap);
    run("rule-15", watchMarketplaceBackButtonLabel);
    run("rule-16", watchUnreadNotificationScrollOnCardFrameArrival);
    run("feature-bsp", watchSoldBidPriceRecording);
    run("feature-bsp", watchSnipableBadge);
    run("feature-bsp", watchStoredBidPricesGrid);
    run("feature-ets", watchTabularNumsRecording);
    run("feature-ets", watchRarityEvalTags);
    run("rule-17", watchNotificationContainerFirstChildSpacing);
    if (flags["rule-18"] || flags["rule-18b"]) {
      watchCollectionModalInputFocus(flags);
    }
    run("rule-19", watchNotificationRewrites);
    run("feature-ebc", watchEvaluateUnratedButton);
    run("rule-20", watchCardModalListScroll);
    run("feature-gcp", watchGlobalCollectionFriendProfileLinks);
    run("rule-21", watchCardModalLegalMentions);
    run("rule-22", watchSpinnerAndAuctionNotFoundCentering);
    run("rule-23", watchFaviconReplacement);
    run("feature-fis", watchFadeInUpInlineStyleCleanup);
    run("rule-24", watchUserTagListSizing);
    run("rule-25", watchWishlistOwnedCardCount);
    run("feature-cnc", watchCardModalNameCopyButton);
    run("rule-26", watchTradesHistoryGrid);
    run("rule-27", watchTradesHistoryFilter);
    run("rule-28", watchCollectionSearchClearButton);
    run("feature-owl", watchPulledCardWikiLinkShortcut);
    run("rule-29", watchPullsReloadTimer);
    run("rule-30", watchMultiTagModalSizing);
    run("rule-31", watchNotificationFilterButtons);
    run("rule-32", watchBidTimerUrgency);
    run("rule-33", watchOwnBidButtonColor);
    run("rule-34", watchTagFilterListKeyboardNav);
    run("rule-35", watchTopEvalsButton);
    run("rule-36", watchCollectionPageJump);
    run("feature-bbs", watchBestTradeRecording);
    run("feature-bbs", watchBestTradesButtons);
    run("feature-fol", watchFollowedUsers);
    run("rule-37", watchBulkActionFavoriteButtons);
    run("rule-38", watchNoEvalHalo);
    run("feature-uds", watchUserDescriptions);
    run("rule-39", watchAchievementProgressBars);
    run("feature-mpa", watchMarketplaceArrows);
    run("feature-dad", watchDefaultAuctionDuration);
    run("feature-wat", watchWatchedAuctions);
    run("rule-40", watchDimUpCardsSwitch);
    run("rule-41", watchTagNamesRecording);
    run("rule-42", watchTagInputBackspace);
    run("rule-43", watchWishlistedCardsHiding);
    run("rule-44", watchTradeTotal);

    watchMyUsernameDetection();
    logger(CPL.LOG, "Initialization complete");
  }

  // The navbar buttons (pin, settings, tutorials) and Rule 45's navbar spacing are the only things started on an
  // excluded path, and are exempt from the exclusion: the navbar has to look the same everywhere
  function startNavbarButtons() {
    exemptFromExclusion = true;
    try {
      if (readFeatureFlags()["feature-npn"]) {
        trackFeature("feature-npn", watchNavFoldToggle, "start")();
      }
      watchFeatureConfigButton();
      watchTutorialButton();
      if (readFeatureFlags()["rule-45"]) {
        trackFeature("rule-45", applyNavBlockSpacing, "start")();
      }
    } finally {
      exemptFromExclusion = false;
    }
  }

  // Nothing else is initialized while on an excluded path: the start waits (cheap polling, the SPA changes path
  // without a reload) for the first path where WMB is allowed to act
  function startWhenAllowed() {
    startNavbarButtons();
    syncFeatureStyles();

    if (!isExcludedPath()) {
      main();
      return;
    }

    logger(
      CPL.INFO,
      `Excluded path ${window.location.pathname}: initialization deferred`,
    );
    const waiting = nativeSetInterval(() => {
      if (isExcludedPath()) return;
      window.clearInterval(waiting);
      logger(CPL.INFO, "Allowed path reached, initialization starts");
      main();
    }, 500);
  }

  startWhenAllowed();
})();
