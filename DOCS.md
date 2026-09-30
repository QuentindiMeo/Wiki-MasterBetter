# Wiki-MasterBetter — Developer Documentation

This is a plain-language, developer-facing version of the feature overview found in the [`wiki-masterbetter.me.js`](./wiki-masterbetter.me.js)
source file (the big comment block near the top of the file, just under the Tampermonkey header). That block is the
project's source of truth — every entry below keeps the same `Rule N` / `Feature XYZ` label used there and in the file,
so you can search the source for that exact label to find the matching implementation and its own, more detailed
comment.

The list below is **not reordered** — it stays in the order features were originally introduced, matching the source
file's own rule.

## A map of the site's pages

A few page routes on [wiki-masters.com](https://www.wiki-masters.com) come up repeatedly below:

| Route                 | What it is                                                        |
| --------------------- | ----------------------------------------------------------------- |
| `/marketplace`        | The marketplace home page, where cards are listed for auction     |
| `/marketplace/{id}`   | A single card's bidding ("auction") page                          |
| `/profile`            | Your own profile page                                             |
| `/profile/{username}` | Someone else's profile page                                       |
| `/pulls`              | The page where you open your card packs                           |
| `/collection`         | Your personal card collection                                     |
| `/global-collection`  | The "wishlist" view, where you can browse friends' wishlist cards |
| `/trades`             | Your trade history with other users                               |
| `/friends`            | Your friends list                                                 |

## Rules and Features

- **Rule 1a — Bigger notifications list.** Makes the notifications panel larger, so more notifications fit on
  screen at once without extra scrolling.
- **Rule 1b — Hide the market analysis button.** Removes the site's built-in "market analysis" button from view.
- **Rule 2 — Smarter "mark as read".** Clicking a notification also marks every notification older than it as
  read, not just the one you clicked.
- **Rule 3 — Descriptive tab title.** Adds useful context to the browser tab's title depending on what you're
  looking at — for example the card currently being bid on, or the username of the profile you're viewing.
- **Rule 4 — 3-column friends grid.** Rearranges your friends list into a tidy 3-column grid instead of one long
  single-column list.
- **Rule 5 — Compact friend action buttons.** Shrinks the "Message" and "Trade" buttons on the friends grid down
  to just their icon, to save space.
- **Rule 6 — Collapsible navigation bar.** The sidebar navigation collapses into icons by default and smoothly
  expands when you hover over it.
- **Feature NPN — Pin the navigation bar.** Adds a pin button so the sidebar can be kept permanently expanded
  instead of only expanding on hover. (This feature replaced the original Rule 8 — see below.)
- **Rule 7 — Click the first notification to clear all.** Clicking the very top (most recent) notification marks
  the entire notifications list as read.
- _Rule 8 no longer exists as its own item — it was folded into Feature NPN (the pinnable navigation bar) above._
- **Rule 9 — Auto-open "My Bids".** Arriving on the marketplace automatically switches you to the "My Bids" tab
  instead of leaving you on the default one.
- **Feature TBC — Trade button on collection cards.** Adds a button directly on each card in your collection to
  start a trade for it, without extra clicks.
- **Rule 10 — Live notification counter.** Clicking a notification immediately updates the unread-count badge to
  match, instead of waiting for a refresh.
- **Rule 11 — Dim the "buy packs" banner.** Once you have zero packs left to open, the site's promotional banner
  encouraging you to get more is faded down instead of staying at full visibility.
- **Rule 12 — Clearer profile action buttons.** Improves the visibility/contrast of the action buttons shown on
  user profile pages.
- **Feature PNP — Pack pile-up notifications.** Sends a browser push notification when you're accumulating a lot
  of unopened card packs, as a reminder to go open them.
- **Rule 13 — Trim long, fully-read notification lists.** Once every notification has been read, only the 20 most
  recent are shown at first; scrolling to the bottom loads the rest.
- **Feature TMB — Group bids by status.** Adds a toggle that splits your "My Bids" list into two groups: bids
  where someone has outbid you, and bids where you're still in the lead.
- **Feature CME — Close modals with Escape.** Lets you press the Escape key to close any open popup/modal, instead
  of having to find and click a close button.
- **Feature PNB — Bid-ending push alert.** Sends a browser push notification when one of your bids is about to
  end (30 seconds left), so you don't miss the chance to raise it.
- **Feature CAR — Claim all rewards at once.** Adds a "claim all" button on the achievements page that adds up and
  collects every pending reward in a single click, instead of one by one.
- **Feature AKP — Keyboard control on /pulls.** Lets you use the keyboard while opening packs: the arrow keys move
  between the pulled cards, Home/End jump straight to the first/last one, Space opens or closes a pack, E opens
  the currently selected card's full-size modal, and V does the same as E and then also puts that card up for
  sale. While a card is shown large, a small legend in the space to its left reminds you of the arrow/Home/End
  shortcuts.
- **Feature SAT — Select all untagged cards.** Adds a "select all except tagged" button next to the site's own
  "select all" button on your collection page, so you can quickly select only the cards you haven't tagged yet.
- **Feature LBD — Enter key starts a bid.** On your collection page, typing an amount into the quick-bid field and
  pressing Enter starts the auction immediately, without needing to click a separate button.
- **Rule 14 — Clearer wishlist auction notifications.** Rewrites the wording of notifications about auctions for
  cards on your wishlist so they read more clearly.
- **Rule 15 — Relabel the back button.** On a card's bidding page, renames the back button to a clearer French
  label ("Retour en arrière") instead of the site's default wording.
- **Feature PLB — Quick profile links on bid pages.** Adds a small "@" link right after each bidder's name (and
  the seller's name) on a card's bidding page, so you can jump straight to their profile.
- **Rule 16 — Auto-scroll to your last unread notification.** Opening the notifications panel scrolls it straight
  down to your most recent unread notification, instead of starting at the top of the list.
- **Feature BSP — Track and grade sale prices.** Remembers how much each card has previously sold for (stored in
  your browser, not on the server) and uses that history to flag whether the current asking price looks like a
  good deal — or, on a sale you make yourself, how good that sale was. Every price it has recorded is listed in a
  table on your own profile page, along with export/import buttons — export downloads a CSV file and import reads
  one back — so you can carry that history over to another browser or device.
- **Rule 17 — Reposition "mark all as read".** Moves the "mark all as read" notifications button to the left side
  of the notifications panel, instead of wherever the site puts it by default.
- **Rule 18 — Auto-focus useful inputs.** Opening a card's modal automatically puts your cursor in the tags input
  field (on `/collection` and `/pulls`); arriving on `/collection` also automatically focuses the search field.
- **Feature ETS — Remember market value estimates.** Saves each card's estimated market value (seen on `/pulls`
  and `/collection`) in your browser, then displays that saved value next to the card's rarity tag on your
  collection page, so you don't have to look it up again.
- **Feature FCP — Toggle individual features.** Adds a settings button, next to the navbar's pin button, that lets
  you turn each feature of this script on or off individually; your choices are saved and take effect the next
  time the page loads.
- **Rule 19 — Cleaner notification text.** Rewrites notification wording in one single, consistent pass rather
  than several separate small tweaks.
- **Feature EBC — Bulk-evaluate your collection.** Adds buttons on `/collection` to estimate the market value of
  every card at once (or only the ones still missing an estimate), with a stop button to cancel partway through,
  plus a button to sort the whole page by estimated value from most to least expensive. Keeps the site's own
  rarity filter buttons grouped ahead of these new ones whenever the site re-adds them.
- **Rule 20 — Tag list follows keyboard selection.** Inside a card's modal (on `/collection` and `/pulls`), the
  tag list automatically scrolls to keep whichever tag you've highlighted with the keyboard in view.
- **Feature GCP — Click a friend's name to see their profile.** On the global collection/wishlist page, clicking
  the username of a friend who owns a card takes you straight to that friend's profile.
- **Rule 21 — Hide the legal disclaimer in the card modal.** Removes the small legal-notice text from a card's
  modal (on `/collection` and `/pulls`) to leave more room for the actual card details.
- **Rule 22 — Centered loading spinner and error message.** Centers the loading spinner on every page; on a
  card's bidding page, it also rewrites and centers the "Auction not found" message.
- **Rule 23 — Custom favicon.** Replaces the site's browser-tab icon with the Wiki-MasterBetter logo.
- **Feature FIS — Fix a page-transition visual glitch.** Corrects a styling issue with the loading spinner that
  shows up briefly during page transitions (on `/pulls`, `/friends` and `/guild`).
- **Feature TUT — Built-in feature tutorials.** Adds a "❓" button next to the settings button that opens a modal
  with short explanations for the script's less obvious features.
- **Rule 24 — Bigger, sorted tag list.** Enlarges the tag list on your collection page and sorts it by how many
  cards carry each tag, from most used to least used.
- **Rule 25 — Clean up your wishlist.** Adds a button that removes every card you already own from your wishlist,
  all in one click.
- **Feature CNC — Copy a card's name.** Adds a small clipboard-copy button next to a card's name wherever that
  name appears: in the card modal, the auction modal, and a card's bidding page.
- **Rule 26 — Two-column trade history.** Displays your trade history as two flexible columns instead of one long
  single list, so more of it fits on screen.
- **Rule 27 — Filter trade history by partner.** Adds a search field above your trade history to filter it down
  to trades with one specific person.
- **Rule 28 — Clear button in the collection search field.** Adds a small "✕" button inside the collection search
  field to instantly empty it.
- **Feature OWL — Jump straight to a pulled card's Wikipedia page.** While opening packs on `/pulls`, pressing the
  W key opens the revealed card's Wikipedia page directly, without you needing to first open the card's modal and
  find the link yourself. (Feature AKP's own on-screen legend documents the shortcut.)
- **Rule 29 — Automatic page reloads when stuck.** On `/pulls`, once your pack pile has reached the maximum size,
  the page reloads every 10 minutes for as long as it stays full — opening packs cancels the timer instead of
  letting it reload mid-session. On a card's bidding page, if Rule 22's "Auction not found" message is showing, the
  page reloads itself once automatically, shortly after.
- **Rule 30 — Bigger, reorganized bulk-tagging modal.** Widens the "apply a tag" / "remove a tag" modal on your
  collection page and lays its tag list out as a wrapping grid instead of one narrow column, so more tags fit on
  screen at once. On the removal variant specifically, the list is also sorted so the tags affecting the most of
  your selected cards appear first.
