// ==UserScript==
// @name         Wiki-MasterBetter
// @namespace    http://tampermonkey.net
// @version      0.19.8
// @description  A collection of features and tweaks to improve the user experience on wiki-masters.com
// @author       https://github.com/QuentindiMeo
// @match        https://www.wiki-masters.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// ==/UserScript==
//! Regarde Naïm, c'est comme ça qu'on vibe-claude.

/**
 * ? DOCUMENTATION - Overview of rules and features implemented in the script | by order of first introduction
 * * Rule 1a: make the notifications list larger
 * * Rule 1b: hide the market analysis button
 * * Rule 2: mark all notifications earlier than the one that's clicked as read
 * * Rule 3: append a suffix to the page title
 * * Rule 4: arrange friends list into a 3-column grid
 * * Rule 5: reduce message/trade buttons on friends grid
 * * Rule 6: navbar is folded by default, expanded on hover
 * * Feature NPN: the navbar can be pinned (expands on hover vs. always expanded)
 * * Rule 7: clicking the first notification marks all as read
 * . Rule 8 was merged into feature NPN
 * * Rule 9: auto-click the "Mes enchères" market tab on arrival on marketplace
 * * Feature TBC: add a trading button to the cards on collection page
 * * Rule 10: clicking a notification updates the counter accordingly
 * * Rule 11: reduce opacity of Pro incentive when 0 pack left to open
 * * Rule 12: improve visibility of action buttons on user profiles
 * * Feature PNP: send push notifications when there are a lot of packs to open
 * * Rule 13: if all notifications are read, only display 20; display all on scroll to bottom
 * * Feature TMB: add a toggler to group market bids by status
 * * Feature CME: allow the Escape key to close modals
 * * Feature PNB: send a push notification when a bid is about to expire (30 seconds left)
 * * Feature CAR: add a "claim all" button summing unclaimed achievement rewards
 * * Feature AKP: give control to keyboard hits on /pulls
 * * Feature SAT: add a "select all except tagged" button next to "Tout sélectionner (page)" on /collection
 * * Feature LBD: on /collection, pressing Enter inside the minimal bid input launches the auction
 * * Rule 14: rewrite wishlist'ed item on auction notifications
 * * Rule 15: on a marketplace item page, relabel the back button "Retour en arrière"
 * * Feature PLB: on a bid page, add an "@" profile link after each card-frame entry's name and the username
 * * Rule 16: smooth-scroll to the last unread notification when the card frame opens
 * * Feature BSP: record sold bids' prices in localStorage; flag the card on the marketplace depending on how good a deal it is (or, on the user's own completed sales, how good a sale it was); recorded data is dumped at /profile, with import/export
 * * Rule 17: bring "Mark all as read" notification button to the left
 * * Rule 18: on /collection and /pulls, focus tags input when the card modal opens; also focus the search input on arrival on /collection
 * * Feature ETS: on /pulls and /collection, store market value evaluation in localStorage; on /collection, append cached eval prices to each card's rarity tag
 * * Feature FCP: feature flipping is available through the button near the navbar pin; choices stored in localStorage, applies after a page reload
 * * Rule 19: single-pass rewrite of notification labels
 * * Feature EBC: on /collection, add buttons to bulk-evaluate every card (or just those missing it); cancellable via a stop button; plus a button to sort the page by descending eval price; keeps the site's own rarity filter buttons grouped ahead of these when one is (re)inserted
 * * Rule 20: on /collection and /pulls, the card modal's tag list scrolls to follow the keyboard-focused item
 * * Feature GCP: on /global-collection, clicking a card's friend-owner username opens that friend's profile
 * * Rule 21: on /collection and /pulls, hide the legal mentions paragraph of the card modal
 * * Rule 22: on all pages, center loading spinner; on a bid page, also rewrite and center the "Enchère introuvable" message
 * * Rule 23: replace the site's favicon
 * * Feature FIS: center the loading spinner
 * * Feature TUT: a "❓" button next to the settings wheel opens a modal with short tutorials for the script's less-obvious features
 * * Rule 24: enlarge tag list on collection page; sort the list by descending count
 * * Rule 25: add a button to bulk-remove every owned card from the wishlist
 * * Feature CNC: add a copy-to-clipboard button next to the card name, in the card modal (/pulls, /collection, /global-collection) and the auction modal (/pulls, /collection)
 * * Rule 26: show trade history as a two-column grid
 * * Rule 27: filter trades history by trading partner
 * * Rule 28: add a clear button inside the collection search field
 */

const MY_USERNAME = "xxx";

(function () {
  "use strict";

  // ============================================================
  // Rule 1a: give div.overflow-hidden.card-frame.shadow-xl a max-height of 80vh and a width of 50vw
  // ============================================================
  function applyCardFrameMaxHeight() {
    GM_addStyle(`
      div.overflow-hidden.card-frame.shadow-xl {
        max-height: 60vh !important;
        width: 50vw !important;
      }
    `);
  }

  // ============================================================
  // Rule 1b: hide button.relative.shrink-0.h-9
  // ============================================================
  function hideShrinkButton() {
    GM_addStyle(`
      button.relative.shrink-0.h-9 {
        display: none !important;
      }
    `);
  }

  // ============================================================
  // Rule 2: if a button.w-full.items-start has no
  // bg-[var(--color-accent)]/5 styling:
  //   - strip that class from all of its NEXT siblings (previous siblings are untouched)
  //   - hide (display: none) every div.w-2.h-2 found inside those next siblings
  // ============================================================
  const ACCENT_CLASS = "bg-[var(--color-accent)]/5";
  function stripAccentFromFollowingSiblings() {
    document.querySelectorAll("button.w-full.items-start").forEach((btn) => {
      if (btn.classList.contains(ACCENT_CLASS)) return;

      let sibling = btn.nextElementSibling;
      while (sibling) {
        if (sibling.classList && sibling.classList.contains(ACCENT_CLASS)) {
          sibling.classList.remove(ACCENT_CLASS);
        }

        sibling.querySelectorAll("div.w-2.h-2").forEach((dot) => {
          dot.style.display = "none";
        });

        sibling = sibling.nextElementSibling;
      }
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
        let itemLabel = document.querySelector("h1.flex-1")?.textContent.trim();
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
  function rearrangeFriendsGrid() {
    if (!window.location.pathname.startsWith("/friends")) return;

    const searchWrapper = document
      .querySelector("#friend-list-search")
      ?.closest(".relative");
    if (!searchWrapper) return;

    const container = searchWrapper.parentElement;
    if (!container) return;

    let grid = container.querySelector(":scope > .friend-list-grid");
    if (!grid) {
      grid = document.createElement("div");
      grid.className = "friend-list-grid";
      searchWrapper.after(grid);
    }

    Array.from(container.children).forEach((el) => {
      if (el !== searchWrapper && el !== grid && el.tagName !== "H2") {
        grid.appendChild(el);
      }
    });
  }

  function watchFriendsGrid() {
    GM_addStyle(`
      .friend-list-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem;
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
    GM_addStyle(`
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
  // Rule 7: clicking the first <button> inside div.min-h-0.flex-1 also clicks the button labelled "Tout marquer lu"
  // ============================================================
  function findMarkAllReadButton() {
    return Array.from(document.querySelectorAll("button")).find(
      (btn) =>
        btn.textContent.trim() === "Tout marquer lu" ||
        btn.getAttribute("aria-label") === "Tout marquer lu",
    );
  }

  function watchMarkAllReadTrigger() {
    document.addEventListener("click", (event) => {
      const container = document.querySelector("div.min-h-0.flex-1");
      if (!container) return;

      const firstButton = container.querySelector("button");
      if (!firstButton) return;
      if (event.target !== firstButton && !firstButton.contains(event.target))
        return;

      const markAllReadBtn = findMarkAllReadButton();
      if (markAllReadBtn && markAllReadBtn !== firstButton) {
        markAllReadBtn.click();
      }
    });
  }

  // ============================================================
  // Rule 7 (cont'd): give the "Tout marquer lu" button a "text-box: alphabetic" style (trims its box to the
  // font's alphabetic edge)
  // ============================================================
  function styleMarkAllReadButton() {
    findMarkAllReadButton()?.classList.add("wm-mark-all-read-btn");
  }

  function watchMarkAllReadButtonStyle() {
    GM_addStyle(`
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
        isolateDiv.querySelector("img.scale-\\[1\\.8\\]")?.click();
        requestAnimationFrame(() => {
          document.querySelector("button.flex-1.font-semibold")?.click();
        });
      });

      justifyBetween.insertBefore(btn, justifyBetween.children[1] ?? null);
    });
  }

  function watchCollectionQuickActionButtons() {
    GM_addStyle(`
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
  // Feature LBD: on /collection, pressing Enter while focus is inside the <input aria-label="Mise de départ"> clicks
  // the button labelled "Lancer l'enchère"
  // ============================================================
  function watchStartingBidEnterKey() {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if (!window.location.pathname.startsWith("/collection")) return;

      const input = event.target;
      if (
        !(input instanceof HTMLInputElement) ||
        input.getAttribute("aria-label") !== "Mise de départ"
      )
        return;

      const launchBtn = Array.from(document.querySelectorAll("button")).find(
        (btn) => btn.textContent.trim() === "Lancer l'enchère",
      );
      if (!launchBtn) return;

      event.preventDefault();
      launchBtn.click();
    });
  }

  // ============================================================
  // Rule 9: on /marketplace, click the "Mes enchères" tab as soon as it appears in the DOM
  // ============================================================
  function clickAuctionsTabOnArrival() {
    if (!window.location.pathname.startsWith("/marketplace")) return;

    const btn = findAuctionsTabButton();
    if (!btn || btn.dataset.wmAutoClicked === "true") return;

    btn.dataset.wmAutoClicked = "true";
    btn.click();
  }

  function watchAuctionsTabArrival() {
    clickAuctionsTabOnArrival();

    const observer = new MutationObserver(() => clickAuctionsTabOnArrival());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Rule 10: clicking a button.w-full.items-start updates the first span.absolute in the document with the number of
  // button.w-full.items-start PREVIOUS siblings it has
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
      const btn = event.target.closest("button.w-full.items-start");
      if (!btn) return;

      const span = document.querySelector("span.absolute");
      if (!span) return;

      span.textContent = String(
        countPreviousSiblingsMatching(btn, "button.w-full.items-start"),
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
  // Rule 12: on /profile/*, give buttons inside div.-mt-0\.5 a color of #ccc, but only while they're not hovered
  // ============================================================
  function updateProfileButtonColor() {
    const onProfile = window.location.pathname.startsWith("/profile/");
    document.querySelectorAll("div.-mt-0\\.5 button").forEach((btn) => {
      btn.classList.toggle("wm-profile-btn", onProfile);
    });
  }

  function watchProfileButtonColor() {
    GM_addStyle(`
      .wm-profile-btn:not(:hover) {
        color: #ccc;
      }
    `);

    updateProfileButtonColor();

    const observer = new MutationObserver(() => updateProfileButtonColor());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature PNP: on /pulls, once div.text-lg > span.text-[var(--color-accent)]'s count reaches ~69% of the max
  // pile size (10), send a push notification on every further increase; once it hits the max, re-send every 10
  // minutes for as long as it stays full instead of only once. Drops back below that ~69% floor resets tracking.
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
      applyState(next);
    });

    container.appendChild(btn);
  }

  function watchPullsCounterNotification() {
    GM_addStyle(`
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

    const MAX_PILE_SIZE = 10;
    const TIME_TO_RELOAD__MIN = 10;
    const RESEND_INTERVAL_MS = 10 * 60 * 1000;
    let lastNotifiedValue = null;
    let lastNotifiedAt = 0;

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

      const span = document.querySelector(
        "div.text-lg > span.text-\\[var\\(--color-accent\\)\\]",
      );
      if (!span) return;

      const currentPacksToOpen = parseInt(span.textContent.trim(), 10);
      if (
        Number.isNaN(currentPacksToOpen) ||
        currentPacksToOpen < MAX_PILE_SIZE * 0.69
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

  function findAuctionsTabButton() {
    return Array.from(document.querySelectorAll("button.px-4")).find((btn) =>
      btn.textContent.trim().startsWith("Mes enchères"),
    );
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
      applyAuctionGrouping(wrap, next);
    });

    h1.appendChild(toggle);

    if (grouped) {
      const wrap = document.querySelector("div.flex-wrap");
      if (wrap) applyAuctionGrouping(wrap, true);
    }
  }

  function watchAuctionGroupToggle() {
    GM_addStyle(`
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
    GM_addStyle(`
      .wm-pnb-mute-toggle {
        margin-right: 0.35rem;
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

      if (isBidTimerNotificationMuted()) return;

      const cardNameEl = document.querySelector("h1.min-w-0");
      const cardName = cardNameEl ? cardNameEl.textContent.trim() : null;
      const notificationText = cardName
        ? `Il reste 30 secondes pour enchérir sur la carte « ${cardName} » !`
        : "Il reste 30 secondes pour enchérir sur cette carte !";

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
    GM_addStyle(`
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
  // first/second button; Home/End do the same but 4 times in a row (each click re-reads the container/buttons,
  // waiting 50ms between clicks for React to re-render). Pressing Space, only while no modal (div.fixed.inset-0)
  // is open, clicks the "Continuer" button inside main, or button.relative.gap-4 if that's what's present in the
  // DOM instead. Pressing E, while a span reading "Carte" is inside main, clicks main img.scale-[1.8]. Pressing V
  // does the same as E, then (50ms later, to let React re-render the sell button after the card click) also
  // clicks button.py-2.5.font-semibold. E and V are ignored while focus is inside an <input>.
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

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        clickPullsNavButtonRepeatedly(
          event.key === "Home" ? "left" : "right",
          4,
        );
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      clickPullsNavButton(event.key === "ArrowLeft" ? "left" : "right");
    });
  }

  // ============================================================
  // Rule 14: wherever div.min-h-0.overflow-y-auto is in the DOM (it only exists after a user action), for each of its
  // children that contains a <p> reading "Liste de souhaits", find the <p> that contains "vient d'être" and wrap the
  // text preceding that segment in « » guillemets
  // ============================================================
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
      const rest = messageP.textContent.slice(idx);

      messageP.textContent = `« ${cardName} » ${rest}`;
      messageP.dataset.wmWishlistWrapped = "true";
    });
  }

  function watchWishlistToastWrap() {
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
  // Feature PLB: on a bid page (/marketplace/{UUID}), for each entry of ul.card-frame, insert an "@" anchor right
  // before its first child (a <span> holding the bidder's name), linking to /profile/{name}; also give the entry's
  // last child the "ml-auto" class. Also insert the same "@" link right before the username (a <span> inside p.text-sm.mt-1)
  // ============================================================
  function createProfileLink(name) {
    const link = document.createElement("a");
    link.className = "wm-profile-link";
    link.href = `/profile/${encodeURIComponent(name)}`;
    link.rel = "noopener noreferrer";
    link.textContent = "@";
    return link;
  }

  function insertBidEntryProfileLinks() {
    document.querySelectorAll("ul.card-frame").forEach((list) => {
      Array.from(list.children).forEach((entry) => {
        if (entry.querySelector(":scope > .wm-profile-link")) return;

        const nameSpan = entry.firstElementChild;
        if (!nameSpan) return;

        const name = nameSpan.textContent.trim();
        if (!name) return;

        nameSpan.before(createProfileLink(name));

        entry.lastElementChild?.classList.add("ml-auto");
      });
    });

    if (!MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname)) return;

    const nameSpan = document.querySelector("p.text-sm.mt-1 span");
    if (
      !nameSpan ||
      nameSpan.previousElementSibling?.classList.contains("wm-profile-link")
    )
      return;

    const name = nameSpan.textContent.trim();
    if (!name) return;

    const profileLink = createProfileLink(name);
    profileLink.style.marginRight = "0.125rem";
    nameSpan.before(profileLink);
  }

  function watchBidEntryProfileLinks() {
    GM_addStyle(`
      .wm-profile-link {
        margin-right: 0.25rem;
        color: var(--color-accent);
        text-decoration: none;
        opacity: 0.7;
      }
      .wm-profile-link:hover {
        opacity: 1;
        text-decoration: underline;
      }
    `);

    insertBidEntryProfileLinks();

    const observer = new MutationObserver(() => insertBidEntryProfileLinks());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature BSP: on a bid page, once span.font-medium reads "Vendue" or "Non vendue" (a cancelled auction,
  // "Annulée", is neither and is never recorded — findAuctionOutcomeSpan only matches text ending in "endue") and
  // there's no owned card label (span.bg-emerald-600/90), record the final displayed price (span.text-2xl) —
  // whether the auction actually sold or not, it's still useful market signal — in localStorage, keyed by
  // "observed-{card name}" (h1.flex-1). A legacy entry still stored under the untagged card name is migrated to that
  // prefixed key on read. Skips while div.animate-spin is present (the page is still loading). Each stored entry is
  // tagged as "{price}-{tag}", tag being the bid UUID's second segment, so the same bid can never be recorded twice.
  // Each card keeps at most N entries: once full, a new price replaces the array's current highest value, but only
  // when it's strictly lower than that value.
  // ============================================================
  const MAX_STORED_PRICES = 5;
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
        raw = legacyRaw;
      }
    }

    return JSON.parse(raw ?? "[]");
  }

  // Feature BSP (cont'd): the reference price averaged from stored entries is weighted rather than plain —
  // out of N prices, the lowest weighs N, the second-lowest N-1, ... the highest weighs 1 — so a single high
  // outlier among mostly-low sales pulls the reference up less than an unweighted average would.
  function computeWeightedAveragePrice(numericPrices) {
    if (!numericPrices.length) return null;

    const sorted = [...numericPrices].sort((a, b) => a - b);
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

  // The seller's username: on a bid page, the <span> inside p.text-sm.mt-1 (right after "Mis en vente par"),
  // also used by Feature PLB to insert its "@" profile link.
  function getBidPageSellerUsername() {
    return (
      document.querySelector("p.text-sm.mt-1 span")?.textContent.trim() ?? null
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

    if (document.querySelector("span.bg-emerald-600\\/90")) return;

    // Feature BSP (cont'd) handles the seller's own completed sales instead (see updateSnipableBadge) — don't let them
    // pollute the market-observed average.
    if (getBidPageSellerUsername() === MY_USERNAME) return;

    const cardName = document.querySelector("h1.flex-1")?.textContent.trim();
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

    if (prices.length < MAX_STORED_PRICES) {
      prices.push(entry);
    } else {
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
  // Feature BSP (cont'd): on a bid page, flag the card name (h1.flex-1, given "display: contents") as "EXCELLENT" when
  // the current price (input.min-w-0) is below 80% of the weighted average of that card's stored sold prices
  // (computeWeightedAveragePrice: out of N prices, the lowest weighs N, the second-lowest N-1, ... the highest
  // weighs 1, so a single high outlier pulls the reference up less than a plain average would), "agréable" when
  // it's between 80% and 100% of that average, "tolérable" when it's between 100% and 120%, or "excessive" when it's
  // above 120%; unflag it as soon as none of those is true. Below 50% of that average, with at least 5 stored sold
  // prices backing it — i.e. that card's cache is at its full MAX_STORED_PRICES capacity, so the average is
  // actually meaningful — it's flagged "prix extraordinaire" instead of "EXCELLENT"; below 20%, with that same
  // 5-entry restriction, it's flagged "prix légendaire" instead. When this bid's own price is
  // the only entry stored for that card (a cache no-hit that this bid's
  // end just filled), that lone entry trivially equals the current price and would otherwise misleadingly compute
  // as "tolérable" — flag it "NEW ENTRY" (white) instead, since there's no real history yet to compare against.
  // Skips while div.animate-spin is present (the page is still loading).
  //
  // Feature BSP (cont'd) — seller's own sale: when the auction just sold ("Vendue") and the seller (p.text-sm.mt-1's
  // username) is MY_USERNAME, the tag instead grades how good a SALE it was — the mirror image of the buyer-facing
  // grading: a price above 120% of the reference value is an "excellente" sale, above 100% "agréable", above 80%
  // "tolérable", below that "décevante". The reference here is the ETS eval price (localStorage "eval-{name}"),
  // not the "observed-" BSP average: recordSoldBidPrice never logs the seller's own sales there (see its own
  // comment), so that cache is essentially always empty for a card you just sold. With no eval price cached
  // either, it falls back to the same "NEW ENTRY" (white) tag, worded for a sale instead.
  //
  // Feature BSP (cont'd) — buyer's own win: when the auction just sold ("Vendue") and the owned card label
  // (span.bg-emerald-600/90) is present — meaning this viewer is the one who just won it — the usual buyer-facing
  // tag also appends the reference average it was compared against, as "(obj. {value})"
  //
  // Feature BSP (cont'd) — cancelled auction: when any span.font-medium reads "Annulée", no tag is shown at all,
  // buyer- or seller-facing — a cancelled auction has no real sale or final bid worth grading or comparing to.
  // ============================================================
  const LEGENDARY_THRESHOLD_RATIO = 0.2;
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

    const cardName = nameEl.textContent.trim();
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

    const isMySoldAuction =
      isSold && getBidPageSellerUsername() === MY_USERNAME;
    const isMyWonAuction =
      isSold && document.querySelector("span.bg-emerald-600\\/90") !== null;

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
      if (
        price < referenceValue * LEGENDARY_THRESHOLD_RATIO &&
        observedEntryCount >= EXTRAORDINARY_MIN_OBSERVED_ENTRIES
      )
        status = "legendary";
      else if (
        price < referenceValue * EXTRAORDINARY_THRESHOLD_RATIO &&
        observedEntryCount >= EXTRAORDINARY_MIN_OBSERVED_ENTRIES
      )
        status = "extraordinary";
      else if (price < referenceValue * EXCELLENT_THRESHOLD_RATIO)
        status = "excellent";
      else if (price < referenceValue * TOLERABLE_THRESHOLD_RATIO)
        status = "agreeable";
      else if (price < referenceValue * EXCESSIVE_THRESHOLD_RATIO)
        status = "tolerable";
      else status = "excessive";
    }

    let label = isMySoldAuction
      ? SALE_STATUS_LABELS[status]
      : BUY_STATUS_LABELS[status];
    if (isMyWonAuction) {
      label += ` (obj. ${Math.round(referenceValue)})`;
    }
    group = getOrCreateBadgeGroup(nameEl);
    setBadge(group, existing, `wm-${status}`, label);

    if (isMySoldAuction) {
      removeReliabilityTag(group);
    } else if (observedEntryCount <= 2) {
      setReliabilityTag(group, "unreliable");
    } else if (observedEntryCount >= EXTRAORDINARY_MIN_OBSERVED_ENTRIES) {
      setReliabilityTag(group, "reliable");
    } else {
      removeReliabilityTag(group);
    }
  }

  function watchSnipableBadge() {
    GM_addStyle(`
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
  // Feature BSP (cont'd): on the user's own profile (/profile), dump every card's stored sold prices into a grid,
  // inserted as a sibling right after div.grid; each entry gets a "✕" button to clear its stored data. Next to
  // "Vider le cache", an import/export pill copies/restores every "observed-"/"eval-" localStorage entry as JSON
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
  // BSP) and "eval-" (Feature ETS) localStorage entry as one JSON blob, so that cache can be moved to another
  // browser/device. Values are copied as their raw stored strings (not re-parsed), since Feature BSP's entries are
  // JSON-encoded arrays while Feature ETS's are plain strings.
  const TAGGED_CACHE_PREFIXES = [BSP_KEY_PREFIX, "eval-"];

  function collectTaggedCacheEntries() {
    const entries = {};

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        !key ||
        !TAGGED_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))
      )
        continue;

      const raw = localStorage.getItem(key);
      if (raw !== null) entries[key] = raw;
    }

    return entries;
  }

  function exportTaggedCacheEntries() {
    const entries = collectTaggedCacheEntries();
    const json = JSON.stringify(entries);
    const count = Object.keys(entries).length;

    navigator.clipboard
      ?.writeText(json)
      .then(() => {
        GM_notification({
          title: "Wiki-Masters",
          text: `${count} entrée(s) copiée(s) dans le presse-papiers.`,
          timeout: 4000,
        });
      })
      .catch(() => {
        prompt(`Copiez ce texte pour exporter ${count} entrée(s) :`, json);
      });
  }

  function importTaggedCacheEntries() {
    const json = prompt("Collez le texte précédemment exporté :");
    if (!json) return;

    let entries;
    try {
      entries = JSON.parse(json);
    } catch {
      alert("Le texte collé n'est pas un export valide.");
      return;
    }

    if (
      typeof entries !== "object" ||
      entries === null ||
      Array.isArray(entries)
    ) {
      alert("Le texte collé n'est pas un export valide.");
      return;
    }

    let importedCount = 0;
    Object.entries(entries).forEach(([key, value]) => {
      if (typeof value !== "string") return;
      if (!TAGGED_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
        return;

      localStorage.setItem(key, value);
      importedCount++;
    });

    alert(
      `${importedCount} entrée(s) importée(s). Rechargez la page pour les voir.`,
    );
  }

  function renderStoredBidPricesGrid() {
    if (window.location.pathname !== "/profile") return;

    const grid = document.querySelector("div.grid");
    if (!grid || grid.nextElementSibling?.classList.contains("wm-bsp-dump"))
      return;

    const entries = collectStoredBidPrices();
    if (entries.length === 0) return;

    const dump = document.createElement("div");
    dump.className = "wm-bsp-dump";

    const title = document.createElement("h2");
    title.className = "wm-bsp-dump-title";
    title.textContent = "🎯 Prix de vente des enchères observées ";

    const titlePrecision = document.createElement("span");
    titlePrecision.className = "wm-bsp-dump-title-precision";
    titlePrecision.textContent = "(max 5, on garde les moins chères)";
    title.appendChild(titlePrecision);

    dump.appendChild(title);

    const rows = [];

    entries.forEach(([cardName, prices]) => {
      const entryEl = document.createElement("div");
      entryEl.className = "wm-bsp-dump-entry";

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "wm-bsp-dump-clear";
      clearBtn.setAttribute("aria-label", `Effacer ${cardName}`);
      clearBtn.textContent = "✕";

      const nameCell = document.createElement("span");
      nameCell.className = "wm-bsp-dump-name";
      nameCell.textContent = cardName;

      const pricesCell = document.createElement("span");
      pricesCell.className = "wm-bsp-dump-prices";

      const numericPrices = prices.map((entry) => parseInt(entry, 10));
      const weightedAverage = computeWeightedAveragePrice(numericPrices);
      const average =
        weightedAverage !== null ? Math.round(weightedAverage) : null;

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

    const actionsRow = document.createElement("div");
    actionsRow.className = "wm-bsp-dump-actions";
    dump.appendChild(actionsRow);

    const totalCacheSizeBytes = entries.reduce((sum, [cardName, prices]) => {
      const key = getBspObservedStorageKey(cardName);
      const raw = JSON.stringify(prices);
      return sum + (key.length + raw.length) * 2;
    }, 0);
    const totalCacheSizeKb = (totalCacheSizeBytes / 1024).toFixed(1);

    const clearCacheBtn = document.createElement("button");
    clearCacheBtn.type = "button";
    clearCacheBtn.className = "wm-bsp-dump-clear-cache";
    clearCacheBtn.textContent = `Vider le cache (${totalCacheSizeKb} Ko)`;
    actionsRow.appendChild(clearCacheBtn);

    clearCacheBtn.addEventListener("click", () => {
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

    grid.after(dump);
  }

  function watchStoredBidPricesGrid() {
    GM_addStyle(`
      .wm-bsp-dump {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem 1.5rem;
        margin-top: 1rem;
        padding: 0.75rem 1rem;
        border-radius: 0.75rem;
        border: 1px solid var(--color-border);
      }
      .wm-bsp-dump-title {
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
        grid-column: 1 / -1;
        display: flex;
        gap: 0.5rem;
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
        padding: 0.5rem 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 0.5rem;
        transition: opacity 0.2s ease;
      }
      .wm-bsp-dump-entry-cleared {
        opacity: 0.35;
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
  // Feature ETS: on /pulls and /collection, once span.tabular-nums appears, store its value in localStorage
  // under "eval-{name}", name being the text content of p.truncate. If it's missing but div.mb-5 p.mt-1\.5 reads
  // "Aucune vente" (no sales recorded yet for that card), stores the "?" placeholder (UNKNOWN_EVAL_VALUE) instead
  // of leaving that card unrecorded. p.truncate's own text node is read directly (rather than its full
  // textContent) since Feature CNC prepends a 📋 button inside that same element — including it here would
  // corrupt the cache key with a stray emoji.
  // ============================================================
  const UNKNOWN_EVAL_VALUE = "?";

  function recordTabularNumsValue() {
    if (
      !window.location.pathname.startsWith("/pulls") &&
      !window.location.pathname.startsWith("/collection")
    )
      return;

    const valueEl = document.querySelector("span.tabular-nums");
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
    if (localStorage.getItem(key) === value) return;

    localStorage.setItem(key, value);
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
  // Feature ETS (cont'd): on /collection, whenever the cards grid (div.gap-3.justify-center) changes, append each
  // card's cached eval price (Feature ETS, keyed "eval-{name}") to its rarity tag (div.top-2.left-2), as
  // "{rarity} ({eval})". The eval value is reformatted first: below 15, it's replaced outright with "💩"; above
  // 1000, it's abbreviated to "{X,X} K" (French decimal comma); otherwise it's shown as stored, including the "?"
  // placeholder for a card with no recorded sales.
  // ============================================================
  const WORTHLESS_THRESHOLD = 15;
  function formatEvalValue(rawValue) {
    const num = parseFloat(rawValue.replace(/\s/g, "").replace(",", "."));
    if (Number.isNaN(num)) return rawValue;

    if (num < WORTHLESS_THRESHOLD) {
      return "💩";
    }

    if (num > 1000) {
      return `${(num / 1000).toFixed(1).replace(".", ",")} K`;
    }

    return rawValue;
  }

  function appendEvalToRarityTags() {
    if (!window.location.pathname.startsWith("/collection")) return;

    const grid = document.querySelector("div.gap-3.justify-center");
    if (!grid) return;

    Array.from(grid.children).forEach((card) => {
      const nameEl = card.querySelector("h3");
      const rarityEl = card.querySelector("div.top-2.left-2");
      if (!nameEl || !rarityEl) return;

      const cardName = nameEl.textContent.trim();
      const evalValue = localStorage.getItem(`eval-${cardName}`);
      if (!cardName || !evalValue) return;

      const baseRarity =
        rarityEl.dataset.wmBaseRarity ?? rarityEl.textContent.trim();
      rarityEl.dataset.wmBaseRarity = baseRarity;

      const appendixText = ` (${formatEvalValue(evalValue)})`;
      let appendix = rarityEl.querySelector(":scope > .wm-eval-appendix");

      if (!appendix) {
        rarityEl.textContent = baseRarity;
        appendix = document.createElement("span");
        appendix.className = "wm-eval-appendix";
        rarityEl.appendChild(appendix);
      }

      if (appendix.textContent === appendixText) return;

      appendix.textContent = appendixText;
    });
  }

  function watchRarityEvalTags() {
    GM_addStyle(`
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
  // Rule 18: on /collection and /pulls, when the card modal (div.card-frame.p-6) opens, focus input.px-3 after 250ms.
  // Also, on arrival on /collection, focus input.rounded-lg as soon as it enters the DOM. Also suppresses the
  // focus outline on nav a[href="/pulls"], left lingering from the click that navigated there.
  // ============================================================
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

  function watchCollectionModalInputFocus() {
    GM_addStyle(`
      nav a[href="/pulls"]:focus {
        outline: none;
      }
    `);

    focusCollectionModalInput();
    focusCollectionSearchInput();

    const observer = new MutationObserver(() => {
      focusCollectionModalInput();
      focusCollectionSearchInput();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature FCP: a settings-wheel button, visually cloning .wm-fold-toggle, sits next to the sidebar's fold/pin toggle
  // (nav h1's closest nav). Clicking it opens a modal listing every rule/feature documented above, each with its own
  // checkbox; unchecking one disables it. A pill next to the hint text toggles every checkbox at once — reading
  // "Tout désélectionner" when all are checked, "Tout sélectionner" otherwise, and flipping to match whichever it
  // said. The choice is stored in localStorage under "wm-feature-flags" (default: everything enabled) and, since
  // most rules only wire themselves up once at page load, applies after the next reload — hence the "Recharger la
  // page" button in the modal's footer. Styled independently of .wm-fold-toggle's own stylesheet (injected by rule
  // 6) so this button and modal always work even when every other rule/feature is disabled.
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
    { id: "rule-9", label: "Ouvrir automatiquement l'onglet « Mes enchères »" },
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
    { id: "rule-15", label: "Relabelliser le bouton retour d'une enchère" },
    { id: "feature-plb", label: "Liens de profil sur la page d'enchère" },
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
        "Focus automatique sur le champ de mise et la recherche de collection",
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
      label: "Retirer les cartes possédées de la liste de souhaits",
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
  ];

  function readFeatureFlags() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(FEATURE_FLAGS_KEY) ?? "{}");
    } catch {
      stored = {};
    }

    const flags = {};
    FEATURE_REGISTRY.forEach(({ id }) => {
      flags[id] = stored[id] !== false;
    });
    return flags;
  }

  function writeFeatureFlags(flags) {
    localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(flags));
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
    title.textContent = "⚙️ Fonctionnalités";

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
    hint.textContent =
      "Tout est activé par défaut. Rechargez la page pour appliquer vos changements.";

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
    reloadBtn.addEventListener("click", () => window.location.reload());

    footer.appendChild(reloadBtn);

    modal.append(header, hintRow, list, footer);
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
    GM_addStyle(`
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
        display: flex;
        flex-direction: column;
        width: min(50rem, 90vw);
        max-height: 80vh;
        border-radius: 0.75rem;
        border: 1px solid var(--color-border);
        background-color: var(--color-surface-light);
        color: var(--color-foreground);
        padding: 1rem;
      }
      .wm-settings-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.5rem;
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
  const TUTORIAL_ENTRIES = [
    {
      title: "La barre de menu à gauche",
      text: "Elle se réduit en petites icônes. Passez la souris dessus pour la voir en entier, ou cliquez sur 📌 pour qu'elle reste toujours ouverte.",
    },
    {
      title: "Le bouton ⚙️ (réglages)",
      text: "Il permet d'activer ou de désactiver chaque fonctionnalité de ce script. Il faut recharger la page après avoir changé quelque chose.",
    },
    {
      title: "Trier ses enchères",
      text: "Dans l'onglet « Mes enchères » du marché, un bouton sépare vos enchères en deux groupes : celles où quelqu'un vous a dépassé, et celles où vous êtes toujours en tête.",
    },
    {
      title: "Être prévenu par notification",
      text: "Si vous autorisez les notifications du navigateur, le script vous prévient quand vous avez beaucoup de paquets à ouvrir, ou juste avant la fin d'une de vos enchères.",
    },
    {
      title: "Ouvrir ses paquets au clavier",
      text: "En train d'ouvrir des paquets sur /pulls ? Utilisez les flèches pour changer de carte, Espace pour ouvrir ou fermer le paquet, E pour voir une carte en grand, et V pour la mettre en vente.",
    },
    {
      title: "Enchérir plus vite",
      text: "Dans votre collection, tapez une mise puis appuyez sur Entrée : l'enchère démarre directement, sans avoir à cliquer sur un bouton.",
    },
    {
      title: "Sélectionner ses cartes sans étiquette",
      text: "Dans votre collection, un bouton sélectionne en un clic toutes les cartes qui n'ont pas encore d'étiquette.",
    },
    {
      title: "Savoir si un prix est bon",
      text: "Sur une page d'enchère, une petite étiquette de couleur vous dit si le prix est intéressant ou non, en le comparant aux ventes précédentes de cette carte. Si c'est vous qui vendez, elle vous dit à la place si votre vente est bonne.",
    },
    {
      title: "Le prix estimé d'une carte",
      text: "Une fois qu'une carte a été estimée sur /pulls ou dans la collection, son prix est retenu et réaffiché à côté d'elle. Dans la collection, des boutons permettent d'estimer plusieurs cartes d'un coup, ou de les trier du prix le plus élevé au plus bas.",
    },
    {
      title: "Réclamer ses récompenses",
      text: "Sur la page des hauts faits, un bouton récupère en une seule fois toutes les récompenses en attente.",
    },
    {
      title: "Accéder à un profil en un clic",
      text: "Un petit « @ » à côté d'un pseudo (sur une page d'enchère, ou à côté du nom d'un ami dans la liste de souhaits) ouvre directement son profil.",
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
      "Un petit guide pour les fonctionnalités les moins évidentes du script.";

    const list = document.createElement("div");
    list.className = "wm-tutorial-list";

    TUTORIAL_ENTRIES.forEach(({ title: entryTitle, text }) => {
      const item = document.createElement("div");
      item.className = "wm-tutorial-item";

      const itemTitle = document.createElement("h3");
      itemTitle.className = "wm-tutorial-item-title";
      itemTitle.textContent = entryTitle;

      const itemText = document.createElement("p");
      itemText.className = "wm-tutorial-item-text";
      itemText.textContent = text;

      item.append(itemTitle, itemText);
      list.appendChild(item);
    });

    modal.append(header, hint, list);
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
    GM_addStyle(`
      .wm-tutorial-list {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        overflow-y: auto;
        padding-right: 0.25rem;
      }
      .wm-tutorial-item {
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
        console.error(
          "[Wiki-MasterBetter] Rule 19 failed on a notification",
          error,
        );
      }
    });
  }

  function watchNotificationRewrites() {
    GM_addStyle(`
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
    window.location.href = `/profile/${encodeURIComponent(username)}`;
  }

  function watchGlobalCollectionFriendProfileLinks() {
    GM_addStyle(`
      .wm-friend-username-hover {
        cursor: pointer;
        text-decoration: underline;
      }
    `);

    document.addEventListener("mousemove", handleGcpMouseMove);
    document.addEventListener("click", handleGcpClick, true);
  }

  // ============================================================
  // Rule 25: on /global-collection, once the "wishlist only" toggle (button.gap-1\.5) is checked (class ring-2),
  // add a button next to it — much like Feature EBC's own bulk-action buttons — offering to remove every card
  // showing the "Possédée" tag (span.bg-emerald-600\/90 inside its description, div.top-\[45\%\]) from the
  // wishlist. Removing one is: click the card (opens its modal), click button.w-full.transition-colors (the
  // modal's "unwish" button), then Escape to close it before moving to the next; cancellable via a fixed stop
  // button, same pattern as Feature EBC's own. Once the run ends (naturally or stopped), div.backdrop-blur-sm
  // is clicked to dismiss whatever card modal is left open. The container itself is always present — only its cards are
  // (re)populated after the toggle is flipped — so rather than watching for the container's arrival, every
  // mutation restarts a short debounce (same rationale as Feature BSP's own scheduleUpdate: avoid reading a
  // still-repopulating list) and the button's label only updates once the DOM has settled.
  // ============================================================
  function getWishlistOwnedCards(cardList) {
    return Array.from(cardList.children).filter((card) =>
      card
        .querySelector("div.top-\\[45\\%\\]")
        ?.querySelector("span.bg-emerald-600\\/90"),
    );
  }

  function waitForElement(selector, timeout = 4000, interval = 100) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const el = document.querySelector(selector);
        if (el) {
          resolve(el);
          return;
        }
        if (Date.now() - start >= timeout) {
          resolve(null);
          return;
        }
        setTimeout(check, interval);
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
    while (!state.stopped) {
      const cardList = document.querySelector("div.gap-3.justify-center");
      const card = cardList ? getWishlistOwnedCards(cardList)[0] : null;
      if (!card) break;

      button.textContent = `Retrait des cartes possédées... (${removed + 1})`;
      (card.querySelector("div.inset-0") ?? card).click();

      const unwishBtn = await waitForElement("button.transition-colors.border");
      unwishBtn?.click();
      removed++;

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

    stopBtn.remove();
    button.disabled = false;
    updateWishlistCleanupButtonLabel(button);
  }

  function updateWishlistCleanupButtonLabel(button) {
    if (button.disabled) return;

    const cardList = document.querySelector("div.gap-3.justify-center");
    const ownedCount = cardList ? getWishlistOwnedCards(cardList).length : 0;

    button.style.display = ownedCount === 0 ? "none" : "";
    button.textContent =
      ownedCount > 1
        ? `Retirer les ${ownedCount} cartes possédées`
        : `Retirer la carte possédée`;
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
    GM_addStyle(`
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

      const toggle = document.querySelector("button.gap-1\\.5");
      const existingBtn = document.querySelector(".wm-wishlist-cleanup");
      if (!toggle?.classList.contains("ring-2")) {
        if (existingBtn) existingBtn.style.display = "none";
        return;
      }

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
  // top-to-bottom despite every item's height being different. Applied once per list (dataset flag, cleared when
  // the list empties out so a fresh one gets reprocessed) rather than on every mutation, since re-measuring and
  // reshuffling an already-arranged list on unrelated mutations would fight the layout it just built.
  // ============================================================
  function buildTradesHistoryColumns(list) {
    const items = Array.from(list.children);
    const heights = items.map((item) => item.offsetHeight);

    const columns = [
      document.createElement("div"),
      document.createElement("div"),
    ];
    columns.forEach((column) =>
      column.classList.add("wm-trades-history-column"),
    );
    const columnHeights = [0, 0];

    items.forEach((item, i) => {
      const target = columnHeights[0] <= columnHeights[1] ? 0 : 1;
      columns[target].appendChild(item);
      columnHeights[target] += heights[i];
    });

    list.classList.add("wm-trades-history-grid");
    list.append(...columns);
  }

  function updateTradesHistoryGrid() {
    if (!window.location.pathname.startsWith("/trades")) return;

    const list = document.querySelector("div.space-y-3.animate-fade-in-up");
    if (!list) return;

    if (list.children.length === 0) {
      delete list.dataset.wmMasonryApplied;
      return;
    }

    if (list.dataset.wmMasonryApplied === "true") return;

    const activeTab = document.querySelector(
      "button.border-\\[var\\(--color-accent\\)\\]",
    );
    if (activeTab?.textContent.trim() !== "Historique") return;

    list.dataset.wmMasonryApplied = "true";
    buildTradesHistoryColumns(list);
  }

  function watchTradesHistoryGrid() {
    GM_addStyle(`
      .wm-trades-history-grid {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
      }
      .wm-trades-history-column {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
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
  // "display: none"; an empty filter shows everything again.
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
    GM_addStyle(`
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
  // buttons): "Réévaluer toute la page" (re-evaluates every card), "Évaluer les cartes non évaluées" (only cards
  // whose rarity tag doesn't yet carry an ETS appendix, or carries the "?" unknown marker — hidden outright once
  // that count reaches 0 on the current page), and "Ordonner la page par prix décroissant" (reorders the grid by
  // each card's raw eval value, unknowns last). The two evaluation
  // buttons show a fixed "Arrêter la reconnaissance" button and, for each targeted card, click its
  // .wm-quick-action button, wait for Feature ETS to record a fresh value under its "eval-{name}" localStorage
  // key, then press Escape to close the modal before moving to the next card. The stop button cancels the run
  // after the current card; the two evaluation buttons disable each other while either is running. Whenever a
  // native rarity filter button (button.px-3.py-1.transition-colors) shows up after "Réévaluer toute la page" —
  // e.g. a new rarity tier's filter button getting appended past our own controls — it's moved back in front of
  // it, keeping the site's own filter buttons grouped together ahead of ours.
  // ============================================================
  function getAllCollectionCards() {
    const grid = document.querySelector("div.gap-3.justify-center");
    if (!grid) return null;

    return Array.from(grid.children);
  }

  function getUnevaluatedCollectionCards() {
    const cards = getAllCollectionCards();
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
  // stopped/timed out first
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
        ? "Évaluer les cartes non évaluées (chargement...)"
        : `Évaluer les cartes non évaluées (${Math.round(cards.length * EVALUATION_SECONDS_PER_CARD__BEST)} – ${Math.round(cards.length * EVALUATION_SECONDS_PER_CARD__WORST)} s)`;

    if (btn.textContent === label) return;
    btn.textContent = label;
  }

  async function evaluateCollectionCards(button, cards) {
    const state = { stopped: false };
    const stopBtn = insertStopEvaluationButton(state);

    for (let i = 0; i < cards.length; i++) {
      if (state.stopped) break;

      const card = cards[i];
      const cardName = card.querySelector("h3")?.textContent.trim();
      const quickActionBtn = card.querySelector(".wm-quick-action");
      if (!cardName || !quickActionBtn) continue;

      const key = `eval-${cardName}`;
      const previousValue = localStorage.getItem(key);
      localStorage.removeItem(key);

      button.textContent = `Évaluation... (${i + 1}/${cards.length})`;
      quickActionBtn.click();

      const recorded = await waitForCardEvaluation(cardName, state);
      if (!recorded && previousValue !== null) {
        localStorage.setItem(key, previousValue);
      }

      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );

      if (state.stopped) break;
    }

    stopBtn.remove();
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
    const cards = getAllCollectionCards() ?? [];

    await evaluateCollectionCards(button, cards);

    button.textContent = originalLabel;
    button.disabled = false;
    otherButton.disabled = false;
    updateEvaluateUnratedButtonLabel(otherButton);
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

  function insertEvaluateUnratedButton() {
    if (!window.location.pathname.startsWith("/collection")) return;

    const filterBar = document.querySelector("div.flex-wrap.gap-2");
    if (!filterBar) return;

    let unratedBtn = filterBar.querySelector(":scope > .wm-eval-unrated");
    if (!unratedBtn) {
      const referenceBtn = filterBar.querySelector("button");

      const reevaluateBtn = document.createElement("button");
      reevaluateBtn.type = "button";
      reevaluateBtn.className = referenceBtn
        ? `${referenceBtn.className} ml-auto wm-eval-reevaluate-all`
        : "wm-eval-reevaluate-all";
      reevaluateBtn.textContent = "Réévaluer toute la page";

      unratedBtn = document.createElement("button");
      unratedBtn.type = "button";
      unratedBtn.className = referenceBtn
        ? `${referenceBtn.className} wm-eval-unrated`
        : "wm-eval-unrated";

      const sortBtn = document.createElement("button");
      sortBtn.type = "button";
      sortBtn.className = referenceBtn
        ? `${referenceBtn.className} wm-eval-sort`
        : "wm-eval-sort";
      sortBtn.textContent = "Ordonner la page par prix décroissant";

      reevaluateBtn.addEventListener("click", () => {
        if (reevaluateBtn.disabled) return;
        reevaluateBtn.disabled = true;
        unratedBtn.disabled = true;
        reevaluateAllCollectionCards(reevaluateBtn, unratedBtn);
      });

      unratedBtn.addEventListener("click", () => {
        if (unratedBtn.disabled) return;
        unratedBtn.disabled = true;
        reevaluateBtn.disabled = true;
        evaluateUnratedCollectionCards(unratedBtn, reevaluateBtn);
      });

      sortBtn.addEventListener("click", () => {
        sortCollectionByPriceDescending();
      });

      filterBar.appendChild(reevaluateBtn);
      filterBar.appendChild(unratedBtn);
      filterBar.appendChild(sortBtn);
    }

    updateEvaluateUnratedButtonLabel(unratedBtn);

    // The site's own rarity filter buttons (button.px-3.py-1.transition-colors) can be (re)inserted after ours —
    // e.g. a new rarity tier showing up appends its filter button at the end of filterBar, past our controls.
    // Move any such button back to where it belongs: grouped with the other filter buttons, ahead of "Réévaluer".
    const reevaluateBtn = filterBar.querySelector(
      ":scope > .wm-eval-reevaluate-all",
    );
    if (reevaluateBtn) {
      Array.from(
        filterBar.querySelectorAll(
          ":scope > button.px-3.py-1.transition-colors",
        ),
      )
        .filter(
          (btn) =>
            reevaluateBtn.compareDocumentPosition(btn) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        )
        .forEach((btn) => filterBar.insertBefore(btn, reevaluateBtn));
    }
  }

  function watchEvaluateUnratedButton() {
    GM_addStyle(`
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
      if (link) link.classList.add("m-0", "mt-5");
    }, 250);
  }

  function watchCardModalLegalMentions() {
    hideCardModalLegalMentions();

    const observer = new MutationObserver(() => hideCardModalLegalMentions());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature CNC: append a small copy-to-clipboard button right inside a card name element, in two contexts:
  //   - the card modal (div.card-frame.p-6)'s own name heading (h2.text-xl), on /pulls, /collection and
  //     /global-collection
  //   - the auction modal's name (p.truncate — the same element Feature ETS already reads the card name from),
  //     on /pulls and /collection only
  // Clicking either copies that card's name to the clipboard and briefly swaps the icon for a checkmark as
  // feedback. The card modal's button goes at the end of the heading; the auction modal's goes at the start of
  // p.truncate instead, ahead of the (often long, truncated) name. Re-inserted on every mutation rather than
  // guarded by a one-time flag: navigating between cards inside an already-open modal (Rule 20's keyboard
  // navigation) re-renders its name element's own children, which would otherwise silently drop our button.
  // ============================================================
  function insertCopyButtonInto(nameEl, position = "end") {
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

    if (position === "start") {
      nameEl.prepend(btn);
    } else {
      nameEl.appendChild(btn);
    }
  }

  function insertCardNameCopyButtons() {
    const onPulls = window.location.pathname.startsWith("/pulls");
    const onCollection = window.location.pathname.startsWith("/collection");
    const onGlobalCollection =
      window.location.pathname.startsWith("/global-collection");

    if (onPulls || onCollection || onGlobalCollection) {
      const modalName = document.querySelector("div.card-frame.p-6 h2.text-xl");
      if (modalName) insertCopyButtonInto(modalName, "end");
    }

    if (onPulls || onCollection) {
      const auctionModalName = document.querySelector("p.truncate");
      if (auctionModalName) insertCopyButtonInto(auctionModalName, "start");
    }
  }

  function watchCardModalNameCopyButton() {
    GM_addStyle(`
      .wm-copy-name {
        margin-right: 0.125rem;
        background: none;
        border: none;
        cursor: pointer;
        font-size: 0.9rem;
        line-height: 1;
        opacity: 0.7;
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
    const matches = Array.from(document.querySelectorAll("div")).filter((div) =>
      div.textContent.includes(text),
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
    GM_addStyle(`
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
  // ============================================================
  function clearFadeInUpInlineStyle() {
    if (
      !window.location.pathname.startsWith("/pulls") &&
      !window.location.pathname.startsWith("/friends") &&
      !window.location.pathname.startsWith("/guild") &&
      !window.location.pathname.startsWith("/achievements")
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
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgMjAwIDIwMCIgeG1sbnM6YzJwYT0iaHR0cDovL2MycGEub3JnL21hbmlmZXN0Ij48bWV0YWRhdGE+PGMycGE6bWFuaWZlc3Q+QUFBV2dtcDFiV0lBQUFBZWFuVnRaR015Y0dFQUVRQVFnQUFBcWdBNG0zRURZekp3WVFBQUFCWmNhblZ0WWdBQUFFZHFkVzFrWXpKdFlRQVJBQkNBQUFDcUFEaWJjUU4xY200Nll6SndZVHBqWVRnMFpEazNOQzB5TVRNeUxUUTVNVGt0T0dJMU1DMWtNREExT1RCaU4yTTFNamtBQUFBRGwycDFiV0lBQUFBcGFuVnRaR015WVhNQUVRQVFnQUFBcWdBNG0zRURZekp3WVM1aGMzTmxjblJwYjI1ekFBQUFBTHhxZFcxaUFBQUFSR3AxYldSalltOXlBQkVBRUlBQUFLb0FPSnR4RTJNeWNHRXVhVzVuY21Wa2FXVnVkQzUyTXdBQUFBQVlZekp6YUhiU0VMWmswaWRjdUtuNEQwRlZlZ0VBQUFCd1kySnZjcU5wWkdNNlptOXliV0YwYldsdFlXZGxMM04yWnl0NGJXeHFhVzV6ZEdGdVkyVkpSSGdzZUcxd09tbHBaRG93TWpGa016VmtPUzB3TmpjNUxUUmlOREV0WWpnek15MHhZVGswT1dRellUVTBZV0pzY21Wc1lYUnBiMjV6YUdsd2FIQmhjbVZ1ZEU5bUFBQUI0bXAxYldJQUFBQkJhblZ0WkdOaWIzSUFFUUFRZ0FBQXFnQTRtM0VUWXpKd1lTNWhZM1JwYjI1ekxuWXlBQUFBQUJoak1uTm95TWcrZ3h3cTNocHRkSGNkMll2cjdRQUFBWmxqWW05eW9tZGhZM1JwYjI1emdxSm1ZV04wYVc5dWEyTXljR0V1YjNCbGJtVmthbkJoY21GdFpYUmxjbk9oYTJsdVozSmxaR2xsYm5SemdhSmpkWEpzZUMxelpXeG1JMnAxYldKbVBXTXljR0V1WVhOelpYSjBhVzl1Y3k5ak1uQmhMbWx1WjNKbFpHbGxiblF1ZGpOa2FHRnphRmdncmRzK2gxRlVraGR2K0JtTG1ab1JxcFlLOTZ2RWRrQmJhbEF5NzFDVTlVcWtabUZqZEdsdmJuZ2RZMjl0TG1GdWRHaHliM0JwWXk1amJHRjFaR1V1Y0hKdmRtbGtaV1JxY0dGeVlXMWxkR1Z5YzZGNEgyTnZiUzVoYm5Sb2NtOXdhV011YjNKcFoybHVMV052Ym1acFpHVnVZMlZuZFc1cmJtOTNibXRrWlhOamNtbHdkR2x2Ym5obVEyeGhkV1JsSUhCeWIzWnBaR1ZrSUhSb2FYTWdabWxzWlNCaGRDQjBhR1VnY21WeGRXVnpkQ0J2WmlCaElIVnpaWElnWVc1a0lHMWhlU0JvWVhabElHTnlaV0YwWldRZ2IzSWdiVzlrYVdacFpXUWdkR2hsSUdacGJHVWdZMjl1ZEdWdWRITXViWE52Wm5SM1lYSmxRV2RsYm5TaFpHNWhiV1ZtUTJ4aGRXUmxjbUZzYkVGamRHbHZibk5KYm1Oc2RXUmxaUFVBQUFESWFuVnRZZ0FBQUVCcWRXMWtZMkp2Y2dBUkFCQ0FBQUNxQURpYmNSTmpNbkJoTG1oaGMyZ3VaR0YwWVFBQUFBQVlZekp6YU02K3I0S200UE5wWWhGVXh5N3Q5d1FBQUFDQVkySnZjcVZqWVd4blpuTm9ZVEkxTm1Od1lXUk5BQUFBQUFBQUFBQUFBQUFBQUdSb1lYTm9XQ0FRWkN3WXo5cWNTSHM3bjZEd1B1ZWpWbEJDWjJUODFTN0gvTTMwdFZ2N3EyUnVZVzFsYm1wMWJXSm1JRzFoYm1sbVpYTjBhbVY0WTJ4MWMybHZibk9Cb21WemRHRnlkQmlXWm14bGJtZDBhQmtlQkFBQUFqNXFkVzFpQUFBQUoycDFiV1JqTW1Oc0FCRUFFSUFBQUtvQU9KdHhBMk15Y0dFdVkyeGhhVzB1ZGpJQUFBQUNEMk5pYjNLbFkyRnNaMlp6YUdFeU5UWnBjMmxuYm1GMGRYSmxlRTF6Wld4bUkycDFiV0ptUFM5ak1uQmhMM1Z5Ympwak1uQmhPbU5oT0RSa09UYzBMVEl4TXpJdE5Ea3hPUzA0WWpVd0xXUXdNRFU1TUdJM1l6VXlPUzlqTW5CaExuTnBaMjVoZEhWeVpXcHBibk4wWVc1alpVbEVlQ3g0YlhBNmFXbGtPbVprWm1Ka016UmlMVGt3TnpjdE5EUTRNeTFoTVRnMUxXTTFNVEJsTmpCaVltWTJNWEpqY21WaGRHVmtYMkZ6YzJWeWRHbHZibk9Eb21OMWNteDRMWE5sYkdZamFuVnRZbVk5WXpKd1lTNWhjM05sY25ScGIyNXpMMk15Y0dFdWFXNW5jbVZrYVdWdWRDNTJNMlJvWVhOb1dDQ3QyejZIVVZTU0YyLzRHWXVabWhHcWxncjNxOFIyUUZ0cVVETHZVSlQxU3FKamRYSnNlQ3B6Wld4bUkycDFiV0ptUFdNeWNHRXVZWE56WlhKMGFXOXVjeTlqTW5CaExtRmpkR2x2Ym5NdWRqSmthR0Z6YUZnZ3BxNTVNYlMzdDZsVDBEdjgxc25JbWs1dlRGanI5aDlXVU5IZnJVSkEyV2FpWTNWeWJIZ3BjMlZzWmlOcWRXMWlaajFqTW5CaExtRnpjMlZ5ZEdsdmJuTXZZekp3WVM1b1lYTm9MbVJoZEdGa2FHRnphRmdnZ1lCUlVyc1pGQ2FrVDBheUM2YisreGYvS1lqSmxxcmRBNGt1djgyTjlTUjBZMnhoYVcxZloyVnVaWEpoZEc5eVgybHVabStqWkc1aGJXVnZRVzUwYUhKdmNHbGpJRVpwYkdWelozWmxjbk5wYjI1bE1TNHdMakJyYzNCbFkxWmxjbk5wYjI1bE1pNDBMakFBQUJBNGFuVnRZZ0FBQUNocWRXMWtZekpqY3dBUkFCQ0FBQUNxQURpYmNRTmpNbkJoTG5OcFoyNWhkSFZ5WlFBQUFCQUlZMkp2Y3RLRVdRSVNvZ0VtR0NGWkFnb3dnZ0lHTUlJQmphQURBZ0VDQWhSQTVhQUs3c0k1MEw2NGcvb0dRZ1U5WjFVVEFEQUtCZ2dxaGtqT1BRUURBekJKTVJjd0ZRWURWUVFLRXc1QmJuUm9jbTl3YVdNc0lGQkNRekV1TUN3R0ExVUVBeE1sUVc1MGFISnZjR2xqSUVOdmJuUmxiblFnUTNKbFpHVnVkR2xoYkhNZ1VtOXZkQ0JEUVRBZUZ3MHlOakE0TURjeE9EUXpOVFphRncweU9EQTRNRFl4T1RRek5UWmFNRVF4RnpBVkJnTlZCQW9URGtGdWRHaHliM0JwWXl3Z1VFSkRNU2t3SndZRFZRUURFeUJCYm5Sb2NtOXdhV01nUTJ4aGRXUmxJRU52Ym5SbGJuUWdVMmxuYm1sdVp6QlpNQk1HQnlxR1NNNDlBZ0VHQ0NxR1NNNDlBd0VIQTBJQUJKaDZDbXZMVUJnRkZOVTB2VUtsT1Z0RTZkamQxN0w1U3V3WDBMZW1GaXNCTTNka2QvM2N5anhGQTNRbzVTNDZmWDAvaWhZMFZaN21mYjlLRjcwM3Q1T2pXREJXTUE0R0ExVWREd0VCL3dRRUF3SUhnREFWQmdOVkhTVUVEakFNQmdvckJnRUVBWVBvWGdJQk1Bd0dBMVVkRXdFQi93UUNNQUF3SHdZRFZSMGpCQmd3Rm9BVXpsSGlCSUZPWkZzaitPUEV6NW8rbk1IWFhNSXdDZ1lJS29aSXpqMEVBd01EWndBd1pBSXdNWE1kRko0QmV0TExWWTdPUnVFOW5vcWJiQVpPWm4vYUFyWHlUd0ZBWmZLclB6eEYydlBvSk5mMStVQ2RnMVhHQWpCd1gxemQ5V0dxWWtxbUw1U0ZxdzFReVNqcjF6SmZwSk05KzFyZER3U1BMTU9QT2pLdWlYam9VL3BVVWVHOVJ3bWhZM0JoWkZrTm5nQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBUFpZUU1qNXNvWmJVRjZ0djJ5Wkdob3VCV3dhbjFhdUVnMTlaYXIzMjlyYnVkVTRrRW4wZExrcEpRMzN5UEg5MklxZWhZVVBKSEVlNlpIQi9mMHl5ekF5ZytVPTwvYzJwYTptYW5pZmVzdD48L21ldGFkYXRhPgo8ZGVmcz48Y2xpcFBhdGggaWQ9ImMiPjxyZWN0IHg9IjQ1IiB5PSI0NSIgd2lkdGg9IjExMCIgaGVpZ2h0PSIxMTAiIHJ4PSI3Ij48L3JlY3Q+PGNpcmNsZSBjeD0iMTAwIiBjeT0iMzAiIHI9IjIwIj48L2NpcmNsZT48Y2lyY2xlIGN4PSIxMDAiIGN5PSIxNzAiIHI9IjIwIj48L2NpcmNsZT48Y2lyY2xlIGN4PSIzMCIgY3k9IjEwMCIgcj0iMjAiPjwvY2lyY2xlPjxjaXJjbGUgY3g9IjE3MCIgY3k9IjEwMCIgcj0iMjAiPjwvY2lyY2xlPjwvY2xpcFBhdGg+PC9kZWZzPgo8ZyBmaWxsPSIjYzc5YjQ1IiBzdHJva2U9IiNjNzliNDUiIHN0cm9rZS13aWR0aD0iMTIiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjQ1IiB5PSI0NSIgd2lkdGg9IjExMCIgaGVpZ2h0PSIxMTAiIHJ4PSI3Ij48L3JlY3Q+PGNpcmNsZSBjeD0iMTAwIiBjeT0iMzAiIHI9IjIwIj48L2NpcmNsZT48Y2lyY2xlIGN4PSIxMDAiIGN5PSIxNzAiIHI9IjIwIj48L2NpcmNsZT48Y2lyY2xlIGN4PSIzMCIgY3k9IjEwMCIgcj0iMjAiPjwvY2lyY2xlPjxjaXJjbGUgY3g9IjE3MCIgY3k9IjEwMCIgcj0iMjAiPjwvY2lyY2xlPjwvZz4KPGcgZmlsbD0iIzBlMGUwZSIgc3Ryb2tlPSIjMGUwZTBlIiBzdHJva2Utd2lkdGg9IjMiPjxyZWN0IHg9IjQ1IiB5PSI0NSIgd2lkdGg9IjExMCIgaGVpZ2h0PSIxMTAiIHJ4PSI3Ij48L3JlY3Q+PGNpcmNsZSBjeD0iMTAwIiBjeT0iMzAiIHI9IjIwIj48L2NpcmNsZT48Y2lyY2xlIGN4PSIxMDAiIGN5PSIxNzAiIHI9IjIwIj48L2NpcmNsZT48Y2lyY2xlIGN4PSIzMCIgY3k9IjEwMCIgcj0iMjAiPjwvY2lyY2xlPjxjaXJjbGUgY3g9IjE3MCIgY3k9IjEwMCIgcj0iMjAiPjwvY2lyY2xlPjwvZz4KPGcgZmlsbD0iI2Y3ZjJlNyI+PHJlY3QgeD0iNDUiIHk9IjQ1IiB3aWR0aD0iMTEwIiBoZWlnaHQ9IjExMCIgcng9IjciPjwvcmVjdD48Y2lyY2xlIGN4PSIxMDAiIGN5PSIzMCIgcj0iMjAiPjwvY2lyY2xlPjxjaXJjbGUgY3g9IjEwMCIgY3k9IjE3MCIgcj0iMjAiPjwvY2lyY2xlPjxjaXJjbGUgY3g9IjMwIiBjeT0iMTAwIiByPSIyMCI+PC9jaXJjbGU+PGNpcmNsZSBjeD0iMTcwIiBjeT0iMTAwIiByPSIyMCI+PC9jaXJjbGU+PC9nPgo8ZyBjbGlwLXBhdGg9InVybCgjYykiIGZpbGw9IiMwZTBlMGUiIGZvbnQtZmFtaWx5PSInQm9kb25pIE1vZGEnLCAnQm9kb25pIDcyJywgRGlkb3QsICdUaW1lcyBOZXcgUm9tYW4nLCBzZXJpZiIgZm9udC13ZWlnaHQ9IjUwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1zaXplPSI4MCI+PHRleHQgeD0iMTAwIiB5PSIxMDAiPlc8L3RleHQ+PHRleHQgeD0iMTAwIiB5PSIxNjQiPk08L3RleHQ+PC9nPgo8cGF0aCBkPSJNMCAtMjQgTDYgLTYgTDI0IDAgTDYgNiBMMCAyNCBMLTYgNiBMLTI0IDAgTC02IC02IFoiIGZpbGw9IiNjNzliNDUiIHN0cm9rZT0iI2Y3ZjJlNyIgc3Ryb2tlLXdpZHRoPSI1IiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBwYWludC1vcmRlcj0ic3Ryb2tlIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxMDAgMTA0KSBzY2FsZSgwLjUpIj48L3BhdGg+Cjwvc3ZnPg==";

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
  // actual tag <li> from the list's two non-tag entries ("Toutes les étiquettes" first, "Gérer les étiquettes…"
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
    GM_addStyle(`
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
  // Init
  // ============================================================
  function main() {
    const flags = readFeatureFlags();
    const run = (id, fn) => {
      if (flags[id]) fn();
    };

    run("rule-1a", applyCardFrameMaxHeight);
    run("rule-1b", hideShrinkButton);
    run("rule-2", watchAccentSiblings);
    run("rule-3", watchNavForTitleChanges);
    run("rule-4", watchFriendsGrid);
    run("rule-5", watchActionButtonLabels);
    run("rule-6", watchSidebarFold);
    run("rule-6", watchCardFrameDocking);
    run("feature-npn", watchNavFoldToggle);
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
    run("feature-sat", watchSelectUntaggedButton);
    run("feature-lbd", watchStartingBidEnterKey);
    run("rule-14", watchWishlistToastWrap);
    run("rule-15", watchMarketplaceBackButtonLabel);
    run("feature-plb", watchBidEntryProfileLinks);
    run("rule-16", watchUnreadNotificationScrollOnCardFrameArrival);
    run("feature-bsp", watchSoldBidPriceRecording);
    run("feature-bsp", watchSnipableBadge);
    run("feature-bsp", watchStoredBidPricesGrid);
    run("feature-ets", watchTabularNumsRecording);
    run("feature-ets", watchRarityEvalTags);
    run("rule-17", watchNotificationContainerFirstChildSpacing);
    run("rule-18", watchCollectionModalInputFocus);
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

    watchFeatureConfigButton();
    watchTutorialButton();
  }

  main();
})();
