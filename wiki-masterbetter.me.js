// ==UserScript==
// @name         Wiki-MasterBetter
// @namespace    http://tampermonkey.net
// @version      0.15.7
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
 * * Rule 14: wrap the card name in « » on "added to wishlist" notifications
 * * Rule 15: on a marketplace item page, relabel the back button "Retour en arrière"
 * * Feature PLB: on a bid page, add an "@" profile link after each card-frame entry's name and the username (p.text-sm.mt-1)
 * * Rule 16: smooth-scroll to the last unread notification when the card frame opens
 * * Feature BSP: record sold bids' prices in localStorage; flag the card on the marketplace as SNIPABLE/agréable/tolérable/overpriced depending on how the current price compares to the average; recorded data is dumped on personal profile
 * * Rule 17: replace the notification container's first child's "justify-between" with "gap-4"
 * * Rule 18: on /collection and /pulls, focus input.px-3 (after 250ms) when the card modal opens
 * * Feature ETS: on /pulls and /collection, store span.tabular-nums' value in localStorage under "eval-{name}"; on /collection, append cached eval prices to each card's rarity tag
 * * Feature FCP: a settings-wheel button next to the sidebar's fold toggle opens a modal listing every rule/feature above, individually toggleable; the choice is stored in localStorage and applies after a page reload
 * * Rule 19: rewrite "Votre carte vous est rendue." notifications to name the card and clarify no one bid on it
 * * Feature EBC: on /collection, buttons next to the rarity filters bulk-evaluate every card (or just those missing a Feature ETS estimate), one at a time (cancellable via a floating "stop" button)
 */

(function () {
  "use strict";

  // ============================================================
  // Rule 1a: give .card-frame.shadow-xl a max-height of 90vh
  // ============================================================
  function applyCardFrameMaxHeight() {
    GM_addStyle(`
      div.overflow-hidden.card-frame.shadow-xl {
        max-height: 80vh !important;
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
  //   - strip that class from all of its NEXT siblings
  //     (previous siblings are untouched)
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
  // Rule 3: append a suffix to the page title based on the nav's
  // active tab (the <a> with class bg-[var(--color-accent)]/10
  // inside <nav>), and keep it in sync as that tab changes.
  // On another user's profile (/profile/{username}, as opposed to
  // the own user's /profile), replace the suffix with "👤 {username}"
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
  // Rule 4: on the /friends page, rearrange the friend list
  // (everything after the search box) into a 3-column grid
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
  // Rule 5: reduce the "Message" and "Échanger" buttons to just
  // their icon by hiding the text label span
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
  // Rule 6: fold the left navbar by default; on hover, smoothly
  // expand it. Folded: only each anchor's icon is visible, and
  // the site logo is squashed horizontally instead of hidden
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
  // Feature NPN: pin toggle to switch the navbar between "foldable
  // on hover" (Rule 6's default) and "always expanded". The
  // choice persists across page loads via GM_setValue.
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
  // Rule 7: clicking the first <button> inside div.min-h-0.flex-1
  // also clicks the button labelled "Tout marquer lu"
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
  // Rule 7 (cont'd): give the "Tout marquer lu" button a
  // "text-box: alphabetic" style (trims its box to the font's
  // alphabetic edge)
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
  // Feature TBC: on /collection, insert a button as the second child of
  // each div.justify-between.pt-1 (inside a div.relative.isolate).
  // This button clicks the img.scale-\\[1\\.8\\] overlay inside
  // the parent div.relative.isolate, then (requestAnimationFrame
  // later) clicks button.flex-1.font-semibold
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
  // Feature SAT: on /collection, once the button labelled "Tout
  // sélectionner (page)" is in the DOM, add a button right after it
  // that clicks img.scale-[1.8] of every div.hover:scale-105 that
  // doesn't contain a div.flex-wrap.shrink-0 (i.e. untagged cards)
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
  // Feature LBD: on /collection, pressing Enter while focus is
  // inside the <input aria-label="Mise de départ"> clicks the
  // button labelled "Lancer l'enchère"
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
  // Rule 9: on /marketplace, click the "Mes enchères" tab as
  // soon as it appears in the DOM
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
  // Rule 10: clicking a button.w-full.items-start updates the
  // first span.absolute in the document with the number of
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
  // Rule 12: on /profile/*, give buttons inside div.-mt-0\.5 a
  // color of #ccc, but only while they're not hovered
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
  // Feature PNP: on /pulls, send a push notification when the text
  // content of div.text-lg > span.text-[var(--color-accent)] is
  // "7" or higher. Re-send every 10 minutes while it's exactly "10"
  // ============================================================
  function watchPullsCounterNotification() {
    const MAX_PILE_SIZE = 10;
    const TIME_TO_RELOAD__MIN = 10;
    const RESEND_INTERVAL_MS = 10 * 60 * 1000;
    let lastNotifiedValue = null;
    let lastNotifiedAt = 0;

    function sendPullsNotification(newPackageCount) {
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
      lastNotifiedValue = newPackageCount;
      lastNotifiedAt = Date.now();
    }

    function checkPullsCounter() {
      if (!window.location.pathname.startsWith("/pulls")) return;

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
  // Rule 13: when div.card-frame.shadow-xl.overflow-hidden enters the DOM and
  // there's no span.absolute anywhere in the document, keep only
  // the first N children of div.min-h-0.flex-1; scrolling that
  // container to the bottom restores the remaining children
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
  // Rule 16: when div.card-frame.shadow-xl.overflow-hidden enters
  // the DOM, smoothly scroll the last unread notification (an
  // element carrying ACCENT_CLASS) into view
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
  // Feature TMB: on /marketplace, when the "Mes enchères" tab is
  // active, add a toggle next to h1.text-2xl.gap-2 that groups
  // div.flex-wrap's children into "Surenchéri" (first) and
  // "Vous menez" (second), separated by an hr
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
  // Feature CME: on /pulls and /collection, while div.fixed.inset-0
  // (a modal) is in the DOM, pressing Escape clicks the button
  // labelled "Fermer"
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
  // Feature PNB: on a bid page (/marketplace/{UUID}), send a push
  // notification when span.tabular-nums.font-medium's text ends
  // with "dans 30s"
  // ============================================================
  const BID_PAGE_REGEX = /^\/marketplace\/[0-9a-f]+/i;
  function watchBidTimerNotification() {
    let notifiedForPath = null;

    function checkBidTimer() {
      if (!BID_PAGE_REGEX.test(window.location.pathname)) {
        notifiedForPath = null;
        return;
      }

      const span = document.querySelector("span.tabular-nums.font-medium");
      if (!span || !span.textContent.trim().endsWith("dans 30s")) return;

      if (notifiedForPath === window.location.pathname) return;
      notifiedForPath = window.location.pathname;

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
  // Feature CAR: on /achievements, when div.grid contains "Réclamer"
  // buttons, add a button before the grid that sums up the reward
  // amounts (from the <p> just before each button) and claims all
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
    claimAllBtn.textContent = `Tout réclamer (+${total} wikibidous)`;
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
  // Feature AKP: on /pulls, once div.gap-4:not(.flex-col) is in the
  // DOM, pressing ArrowLeft/ArrowRight clicks its first/second button.
  // Pressing Space clicks the "Continuer" button inside main, or
  // button.relative.gap-4 if that's what's present in the DOM instead.
  // Pressing E, while a span "Carte" is in main, clicks img.scale-[1.8].
  // Pressing V does the same as E, then also clicks the first
  // button.py-2.5 found in the document. E and V are ignored while
  // focus is inside an <input>.
  // ============================================================
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

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      const container = document.querySelector("div.gap-4:not(.flex-col)");
      if (!container) return;

      const buttons = container.querySelectorAll(":scope > button");
      if (buttons.length < 2) return;

      const navTarget = event.key === "ArrowLeft" ? buttons[0] : buttons[1];
      navTarget.click();
    });
  }

  // ============================================================
  // Rule 14: wherever div.min-h-0.overflow-y-auto is in the DOM
  // (it only exists after a user action), for each of its children
  // that contains a <p> reading "Liste de souhaits", find the <p>
  // that contains "vient d'être" and wrap the text preceding that
  // segment in « » guillemets
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
  // Rule 15: on a marketplace item URL, replace the text content
  // of button.text-sm.gap-1.5 with "Retour en arrière", leaving
  // its svg icon child untouched
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
  // Feature PLB: on a bid page (/marketplace/{UUID}), for each
  // entry of ul.card-frame, insert an "@" anchor right before its
  // first child (a <span> holding the bidder's name), linking to
  // /profile/{name}; also give the entry's last
  // child the "ml-auto" class. Also insert the same "@" link right
  // before the username (a <span> inside p.text-sm.mt-1)
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

    nameSpan.before(createProfileLink(name));
  }

  function watchBidEntryProfileLinks() {
    GM_addStyle(`
      .wm-profile-link {
        margin-right: 0.25rem;
        color: var(--color-accent);
        text-decoration: none;
        opacity: 0.7;
      }
      p.text-sm.mt-1 .wm-profile-link {
        margin-right: 0.25rem;
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
  // Feature BSP: on a bid page, once span.font-medium reads "Vendue" or "Non vendue" and there's no owned card
  // label (span.bg-emerald-600/90), record the sale price (span.text-2xl) in localStorage, keyed by
  // "observed-{card name}" (h1.flex-1). A legacy entry still stored under the untagged card name is migrated to that
  // prefixed key on read. Skips while div.animate-spin is present (the page is still loading). Each stored entry is
  // tagged as "{price}-{tag}", tag being the bid UUID's second segment, so the same bid can never be recorded twice.
  // Each card keeps at most N entries: once full, a new price replaces the array's current highest value, but only
  // when it's strictly lower than that value.
  // ============================================================
  const MAX_STORED_PRICES = 5;
  const PRICE_ENTRY_REGEX = /^\d+-[0-9a-f]+$/i;
  const BSP_KEY_PREFIX = "observed-";

  function getBspStorageKey(cardName) {
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
    const key = getBspStorageKey(cardName);
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

  function getBidTag() {
    const match = window.location.pathname.match(MARKETPLACE_BID_PATH_REGEX);
    return match?.[1]?.split("-")[1] ?? null;
  }

  function recordSoldBidPrice() {
    if (!MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname)) return;
    if (document.querySelector("div.animate-spin")) return;

    const soldSpan = Array.from(
      document.querySelectorAll("span.font-medium"),
    ).find((span) => span.textContent.endsWith("endue"));
    if (!soldSpan || soldSpan.dataset.wmPriceStored === "true") return;

    if (document.querySelector("span.bg-emerald-600\\/90")) return;

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

    localStorage.setItem(getBspStorageKey(cardName), JSON.stringify(prices));
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
  // Feature BSP (cont'd): on a bid page, flag the card name
  // (h1.flex-1, given "display: contents") as "SNIPABLE" when the
  // current price (span.text-2xl) is below 80% of the average of
  // that card's stored sold prices, "agréable" when it's between
  // 80% and 100% of that average, "tolérable" when it's between
  // 100% and 120%, or "overpriced" when it's above 120%; unflag it
  // as soon as none of those is true. Skips while div.animate-spin
  // is present (the page is still loading).
  // ============================================================
  const SNIPABLE_THRESHOLD_RATIO = 0.8;
  const TOLERABLE_THRESHOLD_RATIO = 1.0;
  const OVERPRICED_THRESHOLD_RATIO = 1.2;
  const BADGE_CLASSES = [
    "wm-snipable",
    "wm-agreeable",
    "wm-tolerable",
    "wm-overpriced",
  ];
  const STATUS_LABELS = {
    snipable: "SNIPABLE",
    agreeable: "prix agréable",
    tolerable: "prix tolérable",
    overpriced: "moins cher ailleurs",
  };

  function updateSnipableBadge() {
    if (!MARKETPLACE_BID_PATH_REGEX.test(window.location.pathname)) return;
    if (document.querySelector("div.animate-spin")) return;

    const nameEl = document.querySelector("h1.flex-1");
    if (!nameEl) return;

    const existing = BADGE_CLASSES.some((cls) =>
      nameEl.nextElementSibling?.classList.contains(cls),
    )
      ? nameEl.nextElementSibling
      : null;

    const cardName = nameEl.textContent.trim();
    const priceText = document
      .querySelector("span.text-2xl")
      ?.textContent.replace(/\s/g, "");
    const price = parseInt(priceText, 10);

    if (!cardName || Number.isNaN(price)) {
      existing?.remove();
      return;
    }

    const stored = readBspEntries(cardName);
    const average = stored.length
      ? stored.reduce((sum, entry) => sum + parseInt(entry, 10), 0) /
        stored.length
      : null;

    let status = null;
    if (average !== null) {
      if (price < average * SNIPABLE_THRESHOLD_RATIO) status = "snipable";
      else if (price < average * TOLERABLE_THRESHOLD_RATIO)
        status = "agreeable";
      else if (price < average * OVERPRICED_THRESHOLD_RATIO)
        status = "tolerable";
      else status = "overpriced";
    }

    if (!status) {
      existing?.remove();
      return;
    }

    const className = `wm-${status}`;
    if (existing?.classList.contains(className)) return;

    existing?.remove();

    const badge = document.createElement("span");
    badge.className = className;
    badge.textContent = STATUS_LABELS[status];
    nameEl.after(badge);
  }

  function watchSnipableBadge() {
    GM_addStyle(`
      h1.flex-1 {
        display: contents;
      }
      .wm-snipable,
      .wm-agreeable,
      .wm-tolerable,
      .wm-overpriced {
        margin-left: 0.5rem;
        font-weight: 600;
        font-size: 0.85rem;
        border-radius: 0.375rem;
        padding: 0.1rem 0.4rem;
      }
      .wm-snipable {
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
      .wm-overpriced {
        color: #ef2222;
        background-color: rgba(239, 34, 34, 0.15);
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
  // Feature BSP (cont'd): on the user's own profile (/profile),
  // dump every card's stored sold prices into a grid, inserted as
  // a sibling right after div.grid; each entry gets a "✕" button
  // to clear its stored data
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
        localStorage.setItem(getBspStorageKey(cardName), raw);
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

      localStorage.setItem(getBspStorageKey(key), raw);
      localStorage.removeItem(key);
      migratedCount++;
    });

    return migratedCount;
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
      const average = numericPrices.length
        ? Math.round(
            numericPrices.reduce((sum, entry) => sum + entry, 0) /
              numericPrices.length,
          )
        : null;

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
        localStorage.removeItem(getBspStorageKey(cardName));
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
      const key = getBspStorageKey(cardName);
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
        localStorage.removeItem(getBspStorageKey(cardName));
        clearBtn.remove();
        entryEl.classList.add("wm-bsp-dump-entry-cleared");
      });
    });

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
  // Feature ETS: on /pulls and /collection, once span.tabular-nums
  // appears, store its value in localStorage under "eval-{name}",
  // name being the text content of p.truncate
  // ============================================================
  const UNKNOWN_EVAL_VALUE = "?";

  function recordTabularNumsValue() {
    if (
      !window.location.pathname.startsWith("/pulls") &&
      !window.location.pathname.startsWith("/collection")
    )
      return;

    const valueEl = document.querySelector("span.tabular-nums");
    const cardName = document.querySelector("p.truncate")?.textContent.trim();
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
  // Feature ETS (cont'd): on /collection, whenever the cards grid
  // (div.gap-3.justify-center) changes, append each card's cached
  // eval price (Feature ETS, keyed "eval-{name}") to its rarity
  // tag (div.top-2.left-2), as "{rarity} ({eval})"
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
  // Rule 17: on the notification container
  // (div.card-frame.shadow-xl.overflow-hidden), replace its first
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
  // Rule 18: on /collection and /pulls, when the card modal
  // (div.card-frame.p-6) opens, focus input.px-3 after 250ms
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

  function watchCollectionModalInputFocus() {
    GM_addStyle(`
      nav a[href="/pulls"]:focus {
        outline: none;
      }
    `);

    focusCollectionModalInput();

    const observer = new MutationObserver(() => focusCollectionModalInput());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // Feature FCP: a settings-wheel button, visually cloning
  // .wm-fold-toggle, sits next to the sidebar's fold/pin toggle
  // (nav h1's closest nav). Clicking it opens a modal listing
  // every rule/feature documented above, each with its own
  // checkbox; unchecking one disables it. The choice is stored in
  // localStorage under "wm-feature-flags" (default: everything
  // enabled) and, since most rules only wire themselves up once
  // at page load, applies after the next reload — hence the
  // "Recharger la page" button in the modal's footer. Styled
  // independently of .wm-fold-toggle's own stylesheet (injected
  // by rule 6) so this button and modal always work even when
  // every other rule/feature is disabled.
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
      label: "Encadrer le nom de carte des notifs de liste de souhaits",
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
    { id: "rule-18", label: "Focus automatique sur le champ de mise" },
    { id: "feature-ets", label: "Mémorisation des estimations de cartes" },
    {
      id: "rule-19",
      label: "Reformuler la notification « Votre carte vous est rendue »",
    },
    {
      id: "feature-ebc",
      label: "Bouton d'évaluation groupée des cartes non estimées",
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

    const hint = document.createElement("p");
    hint.className = "wm-settings-hint";
    hint.textContent =
      "Tout est activé par défaut. Rechargez la page pour appliquer vos changements.";

    const list = document.createElement("div");
    list.className = "wm-settings-list";

    FEATURE_REGISTRY.forEach(({ id, label }) => {
      const item = document.createElement("label");
      item.className = "wm-settings-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = flags[id];
      checkbox.addEventListener("change", () => {
        flags[id] = checkbox.checked;
        writeFeatureFlags(flags);
      });

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

    const footer = document.createElement("div");
    footer.className = "wm-settings-footer";

    const reloadBtn = document.createElement("button");
    reloadBtn.type = "button";
    reloadBtn.className = "wm-settings-reload";
    reloadBtn.textContent = "Recharger la page";
    reloadBtn.addEventListener("click", () => window.location.reload());

    footer.appendChild(reloadBtn);

    modal.append(header, hint, list, footer);
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
      .wm-settings-hint {
        font-size: 0.85rem;
        opacity: 0.7;
        margin: 0 0 0.75rem 0;
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
  // Rule 19: in the notification display
  // (div.card-frame.shadow-xl.overflow-hidden), find the <p> whose
  // own text reads exactly "Votre carte vous est rendue." — that
  // fixed phrase, with no name in it, is only how this
  // notification type is identified. The card name isn't in that
  // <p>: it's found by scanning the enclosing notification item
  // (button.w-full.items-start)'s whole text content for a quoted
  // segment (straight quotes or « » guillemets). Once found,
  // replace the identifying <p>'s text with "Personne n'a enchéri
  // pour votre carte « {name} »"
  // ============================================================
  const RETURNED_CARD_PHRASE = "Votre carte vous est rendue.";
  const QUOTED_TEXT_REGEX = /[«"](.+?)[»"]/;

  function rewriteReturnedCardNotifications() {
    const container = document.querySelector(
      "div.card-frame.shadow-xl.overflow-hidden",
    );
    if (!container) return;

    container.querySelectorAll("p").forEach((p) => {
      if (p.dataset.wmReturnedCardRewritten === "true") return;
      if (!p.textContent.trim().endsWith(RETURNED_CARD_PHRASE)) return;

      const item = p.closest("button.w-full.items-start");
      const match = item?.textContent.match(QUOTED_TEXT_REGEX);
      if (!match) return;

      const cardName = match[1].trim();
      p.textContent = `Personne n'a enchéri pour votre carte « ${cardName} ».`;
      p.dataset.wmReturnedCardRewritten = "true";
    });
  }

  function watchReturnedCardNotifications() {
    rewriteReturnedCardNotifications();

    const observer = new MutationObserver(() => {
      if (!document.querySelector("div.card-frame.shadow-xl.overflow-hidden"))
        return;
      rewriteReturnedCardNotifications();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ============================================================
  // Feature EBC: on /collection, add two buttons as the last children of div.flex-wrap.gap-2 (rarity filter
  // buttons): "Réévaluer toute la page" (re-evaluates every card) and, right after it, "Évaluer les cartes non
  // évaluées" (only cards whose rarity tag doesn't yet carry an ETS appendix, or carries the "?" unknown marker).
  // Either shows a fixed "Arrêter la reconnaissance" button and, for each targeted card, clicks its
  // .wm-quick-action button, waits for Feature ETS to record a fresh value under its "eval-{name}" localStorage
  // key, then presses Escape to close the modal before moving to the next card. The stop button cancels the run
  // after the current card; the two buttons disable each other while either is running
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
    btn.textContent = "Arrêter la reconnaissance";

    btn.addEventListener("click", () => {
      state.stopped = true;
    });

    document.body.appendChild(btn);
    return btn;
  }

  // Measured: evaluating 50 cards takes about 190 seconds
  const EVALUATION_SECONDS_PER_CARD = 190 / 50;

  function updateEvaluateUnratedButtonLabel(btn) {
    if (btn.disabled) return;

    const cards = getUnevaluatedCollectionCards();
    const label =
      cards === null
        ? "Évaluer les cartes non évaluées (chargement...)"
        : `Évaluer les cartes non évaluées (~${Math.round(cards.length * EVALUATION_SECONDS_PER_CARD)}s)`;

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

      filterBar.appendChild(reevaluateBtn);
      filterBar.appendChild(unratedBtn);
    }

    updateEvaluateUnratedButtonLabel(unratedBtn);
  }

  function watchEvaluateUnratedButton() {
    GM_addStyle(`
      .wm-eval-stop {
        position: absolute;
        top: 1rem;
        right: 1rem;
        z-index: 999;
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 0.5rem;
        background: #dc2626;
        color: #fff;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        transition: background-color 0.2s ease;
      }
      .wm-eval-stop:hover {
        background: #b91c1c;
      }
    `);

    insertEvaluateUnratedButton();

    const observer = new MutationObserver(() => insertEvaluateUnratedButton());
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
    run("rule-19", watchReturnedCardNotifications);
    run("feature-ebc", watchEvaluateUnratedButton);

    watchFeatureConfigButton();
  }

  main();
})();
