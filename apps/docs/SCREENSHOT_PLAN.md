# Screenshot plan

Capture specs for the docs updates of 2026-08-08. Each entry maps a docs page +
section anchor to an exact capture. Placeholders in the pages are HTML comments of the
form `<!-- screenshot: {filename} per SCREENSHOT_PLAN.md -->` at the exact insertion
spot — replace each comment with a standard image reference using the alt text below.

Conventions (per `CONTRIBUTING.md`): 1440×900 window, light scheme, seeded emulator
stack via `tools/e2e/capture-docs-screenshots.mjs` where possible (add shot specs
there rather than capturing by hand), crop tightly to the named element, save under
`static/img/<area>/`, optimize to <300 KB. Component-level crops are preferred over
full pages throughout — a shot spec's `clipTo: { locator, include }` crops to what
the element measures at capture time, which is what a card whose neighbours keep
growing needs.

**Read `CONTRIBUTING.md`'s note on the capture account before adding a shot.** The
harness signs in as STAFF, and staff see release-flagged-off surfaces that no
customer does; it hides and then asserts on them, so a hand-made capture is the one
route that can still leak one (AGL-1600).

---

## Custom domains

### 1. `static/img/custom-domains/connect-verify-button.png`

- **Docs page:** `building-sites/custom-domains/connect-a-domain.md` → `#steps`
- **Capture:** console → a site's **Setup** page → **Custom Domain** tab
  (`/{org}/hosts/{host}/setup?tab=domain`), on a **paid-plan** site with no domain
  connected. Type `www.example.com` into the **Domain** field first so the record
  lines show a real value.
- **Frame:** the Custom domain card only — helper text, the monospace record lines
  with the caption under each (CNAME → `sites.aglyn.app`, ALIAS → `sites.aglyn.app`,
  A → `216.198.79.1`), the Domain field, and the **Verify & connect** button. Crop out
  the rest of the Setup page.
- **Alt text:** The Custom domain card with the CNAME, ALIAS, and A records to add,
  the Domain field filled in, and the Verify & connect button.

### 2. `static/img/custom-domains/connected-chip-and-actions.png`

- **Docs page:** `building-sites/custom-domains/connect-a-domain.md` → `#after-it-connects`
- **Capture:** same card on a site with a domain already connected (seed
  `host.cname`). Ideal: capture twice and pick the healthy state — green domain chip
  plus the **Re-attach** and **Disconnect** buttons. If easy to stage, a second
  variant with `cnameAttachmentPending` set shows the warning chip
  "example.com — attachment pending" and the **Retry attachment** label.
- **Frame:** the chip row and its two action buttons only.
- **Alt text:** A connected domain shown as a green chip with Re-attach and
  Disconnect beside it.

## SEO

### 3. `static/img/seo/setup-seo-tab.png`

- **Docs page:** `building-sites/seo/overview.md` → top of page (replaces the
  borrowed custom-domains image)
- **Capture:** console → **Setup** → **SEO** tab (`…/setup?tab=hostSeo`), with the
  site-level SEO form (Title, Description, Separator, Favicon, Entity) and the
  Search engines card both visible.
- **Frame:** the SEO tab's content column — both cards, no console nav.
- **Alt text:** The site Setup page's SEO tab, with the site-wide SEO fields and the
  Search engines card.

### 4. `static/img/seo/screen-seo-card.png`

- **Docs page:** `building-sites/seo/overview.md` → `#per-screen-seo`
- **Capture:** console → any screen's detail page → the **SEO** card, with Title and
  Description filled so the character counters (`…/60`, `…/155`) show non-zero
  numbers, a social image picked so its preview shows, and the **Save SEO**
  button visible.
- **Frame:** the SEO card only.
- **Alt text:** A screen's SEO card with Title and Description fields, a Social
  image preview with Replace and Clear buttons, and the Save SEO button.

### 5. `static/img/seo/search-engines-card-on.png`

- **Docs page:** `building-sites/seo/overview.md` → `#the-whole-site`
- **Capture:** **Setup → SEO** with **Discourage search engines from indexing this
  site** switched **ON**, so the warning alert ("This site is hidden from search…")
  is visible below the switch.
- **Frame:** the Search engines card only, switch + alert.
- **Alt text:** The Search engines card with the discourage switch on and its
  warning that the site is hidden from search.

### 6. `static/img/seo/page-access-visibility.png` — ✅ CAPTURED (AGL-1600)

Shot spec lives in `capture-docs-screenshots.mjs`; embedded in
`building-sites/seo/overview.md`, and in `site-protection/overview.md` and
`site-protection/password-a-screen.md`, which were borrowing a screens-list shot
for want of this one (AGL-1599).

- **Docs page:** `building-sites/seo/overview.md` → `#a-single-page`
- **Capture:** a screen's detail page → **Page Access** card, with the **Visibility**
  select **open** so all four options (Public, Unlisted, Password protected, Members
  only) and their hint lines are visible.
- **Frame:** the Page Access card with the open dropdown.
- **Alt text:** The Page Access card's Visibility menu open, showing Public,
  Unlisted, Password protected and Members only with their search hints.

## Collections & blog

### 7. `static/img/content/entry-schedule-dialog.png`

- **Docs page:** `building-sites/site-templates/build-a-blog.md` → `#scheduling`
- **Capture:** console → **Content** → a collection with entries → press **Schedule**
  on a draft entry. The **Schedule entry** dialog with its explainer line, the
  **Publish at** datetime field (prefilled next hour), and Cancel/Schedule buttons.
- **Frame:** the dialog only. Bonus points for the entry row behind it showing a
  `scheduled · {date}` chip from a previously scheduled entry.
- **Alt text:** The Schedule entry dialog with its Publish at field — the entry goes
  live once the time passes.

### 8. `static/img/content/categories-dialog.png`

- **Docs page:** `building-sites/site-templates/build-a-blog.md` → `#categories`
- **Capture:** **Content** → **Categories** on a collection seeded with 3–4
  categories (e.g. Guides, News, Releases). The dialog showing the stable-id helper
  under each name (`id: guides`), the New category row, and Add/Done.
- **Frame:** the Categories dialog only.
- **Alt text:** The per-collection Categories dialog — each category with its stable
  id, rename-in-place fields, and the New category row.

## Besigner — live co-editing & drafts

These four need **two signed-in sessions** on the same screen (two browsers on the
seeded emulator stack). Use two accounts with distinct names/photos.

### 9. `static/img/besigner/presence-avatar-stack.png`

- **Docs page:** `building-sites/besigner/live-co-editing.md` → `#whos-here`
- **Capture:** besigner with a second account editing the same screen. Hover the
  collaborator's avatar so the tooltip "«Name» is editing this too — saves are not
  merged" is visible.
- **Frame:** the toolbar's right half — avatar stack + tooltip + the Live/Preview/
  Save controls for context. Component-level crop, not the whole editor.
- **Alt text:** A collaborator's avatar in the besigner toolbar, with its tooltip
  explaining that saves are not merged.

### 10. `static/img/besigner/remote-cursor-and-selection.png`

- **Docs page:** `building-sites/besigner/live-co-editing.md` → `#whos-here`
- **Capture:** same setup; the second account selects a hero section and moves the
  mouse. Capture the first account's canvas showing the colored **selection outline
  with the name tab** and, elsewhere, the colored **cursor arrow with the name
  pill** (have the second session hover empty canvas with nothing selected for the
  pill, or take the shot mid-move).
- **Frame:** the canvas region containing both overlays — no panels.
- **Alt text:** A teammate's colored cursor and selection outline, each labeled with
  their name, over the besigner canvas.

### 11. `static/img/besigner/concurrent-save-banner.png`

- **Docs page:** `building-sites/besigner/live-co-editing.md` → `#when-saves-collide`
- **Capture:** both sessions edit; session B saves. Session A immediately shows the
  warning banner under the toolbar: "Someone else saved this screen while you were
  editing. Saving is paused so their work is not overwritten — reload to pick up
  their changes. Nothing you have done here is lost until you do." with its
  **Reload** button.
- **Frame:** the banner, full width, with a sliver of toolbar above for placement
  context.
- **Alt text:** The concurrent-save warning banner with its Reload action — saving
  is paused so a teammate's work is not overwritten.

### 12. `static/img/besigner/draft-recovery-alert.png`

- **Docs page:** `building-sites/besigner/live-co-editing.md` → `#local-draft-recovery`
- **Capture:** edit a screen, wait ~2s (draft write), close the tab **without
  saving**, reopen the same screen. The info alert "Unsaved changes to this screen
  from a moment ago were recovered from this browser. Restoring puts them back on
  the canvas without saving; you can undo it." with **Restore** and **Discard**.
- **Frame:** the alert only, full width.
- **Alt text:** The draft-recovery offer with Restore and Discard buttons after
  reopening a screen that closed with unsaved changes.

### 13. `static/img/besigner/versions-dialog.png`

- **Docs page:** `building-sites/screens-and-layouts/overview.md` →
  `#versions--scheduled-publishing`
- **Capture:** besigner (Pro-plan seeded site) → click the version name in the app
  bar. The **Versions** dialog with 2–3 named versions, the **Published** chip on
  one, an **Open** chip, and ideally a "Publishes …" schedule chip on another row.
- **Frame:** the dialog only.
- **Alt text:** The Versions dialog — named versions with Published and schedule
  chips, and per-row Open, Publish and Schedule actions.

## Published sites — admin bar

Requires the `release_edit_bar` flag ON for the seeded org (staff flags page), a
published site, and a signed-in editor account.

### 14. `static/img/tenant/admin-bar-pill.png`

- **Docs page:** `building-sites/besigner/edit-from-the-live-site.md` → `#call-it-up`
- **Capture:** the published site with `?aglyn-edit` appended, before connecting.
- **Frame:** the bottom-right corner of the page with the **Edit this site** pill —
  include enough of the page to show it floating over real content.
- **Alt text:** The Edit this site pill in the corner of a published page, before
  connecting edit access.

### 15. `static/img/tenant/admin-bar-connected.png`

- **Docs page:** `building-sites/besigner/edit-from-the-live-site.md` → `#the-bar`
- **Capture:** after connecting through the console popup: the dark bar along the
  bottom showing the site name, the current screen's name, **Edit this page**,
  **Open console**, and the × button.
- **Frame:** the full-width bar plus a strip of the page above it.
- **Alt text:** The connected admin bar at the bottom of a published page, with
  Edit this page and Open console links.

## Media

### 16. `static/img/media/image-editor-dialog.png`

- **Docs page:** `content-and-data/media/overview.md` → `#edit-images`
- **Capture:** Media library → an image's details → **Edit image**. Drag a crop with
  **Crop ratio** set to 16:9 so the crop overlay is visible; rotate/flip controls,
  Max width field, and the **Save as copy** / **Replace original** buttons in frame.
- **Frame:** the editor dialog only.
- **Alt text:** The image editor with a 16:9 crop dragged, rotation and flip
  controls, and Save as copy / Replace original actions.

## Forms

### 17. `static/img/forms/inbox-submission-reader.png`

- **Docs page:** `content-and-data/forms/overview.md` → `#the-inbox`
- **Capture:** **Inbox** → **Submissions** tab, seeded with a few submissions
  (one unread with its **New** chip visible in the table behind), one open in the
  reader dialog showing labeled fields and the **Delete** / **Mark unread** /
  **Close** footer.
- **Frame:** the reader dialog, with the table's unread row peeking behind it.
- **Alt text:** A form submission open in the inbox reader, fields labeled, with
  Mark unread and Delete actions — an unread row with its New chip behind.
