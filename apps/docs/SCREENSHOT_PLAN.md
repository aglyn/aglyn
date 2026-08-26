# Screenshot plan

Capture specs for the docs updates of 2026-08-08, and for the 2026-08-19 additions
at the bottom of this file. Each entry maps a docs page +
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
  collaborator's avatar so the tooltip "«Name» has this open too. Edits merge live,
  element by element, and either of you can save at any time…" is visible.
- **Frame:** the toolbar's right half — avatar stack + tooltip + the Live/Preview/
  Save controls for context. Component-level crop, not the whole editor.
- **Alt text:** A collaborator's avatar in the besigner toolbar, with its tooltip
  explaining that edits merge live and either of you can save.

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

- **Docs page:** `building-sites/besigner/live-co-editing.md` → `#when-a-save-is-refused`
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

- **Docs page:** `building-sites/screens-and-layouts/versions-and-publishing.md` →
  `#the-versions-dialog`
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

---

# Addendum — 2026-08-18 release documentation

Capture specs for the docs written during the September 1 release push
(AGL-1905, AGL-1928, AGL-1943). Same conventions as above: 1440×900, light
scheme, `tools/e2e/capture-docs-screenshots.mjs`, save under
`static/img/<area>/`, optimize to \<300 KB.

**These were planned but not captured** — the browser was held by another agent
for the whole session. Every entry below carries a ready-to-paste shot spec, so
a browser session can run them without re-deriving a route, a selector or a
crop. Paste each `spec` into the `SHOTS` array, run the harness, then replace
the `<!-- screenshot: … -->` comment on the named docs page with a standard
image reference using the alt text given.

## Third run of 2026-08-24 (AGL-1950) — 12 captured, 4 not

**A10 and A14 are captured.** Neither needed a decision or a Stripe mutation;
both had been read as manual because of where the earlier passes stopped:

- **A10** was blocked on "creating a key is a real write". It is — to the
  **emulator**. A token minted against a local, ephemeral Firestore is dead by
  construction, which is a stronger guarantee than the plan's own "revoke it
  immediately after". The entry now carries the one condition that matters: the
  shot must never run against a console wired to real Firebase.
- **A14** was blocked on "no fixture produces it". It took fifteen lines: an org
  on `free` whose `enabledPlugins` still carries `commerce`. A separate org, not
  a flipped plan — several other shots in this file read the bakery's plan.

**The four that remain are A1, A2, A7 and A15, and none of them is a capture.**
A1/A2 need a real Stripe customer with a scheduled downgrade; A7 needs a real
paid invoice on Stripe's own pages, carrying real billing data into a **public**
repository; A15 is the decision about a release flag that is still off. There
is no harness time left in this issue.

**New guard: `npm run check:docs-screenshots`.** Every `/img/…` reference in
every docs page must resolve to a file that decodes and is not a single flat
colour. Docusaurus' `onBrokenLinks: 'throw'` does not cover static assets, so a
page pointing at an uncaptured image built green and shipped a broken-image
icon; and a harness that fails mid-shot writes a valid PNG of empty backdrop
that any file-exists check passes. Failed on purpose three ways in an isolated
worktree before being trusted: a deleted image, a same-size all-white
replacement, and a 0-byte truncation.

## Second run of 2026-08-23 (AGL-1950) — 11 captured, 5 not

The four fixture-blocked entries below are now captured (**A8, A11, A13**), plus
**A12** on a re-pointed surface, from fixtures added in
`tools/e2e/seed-docs-fixtures.mjs` — a **separate, additive** seed rather than
edits to `seed-e2e.mjs`, so the e2e suite's member counts, seat assertions and
empty-state pages do not move under a suite that never asked for a third member
or a disputed order.

**A9 was re-shot: the image published by the first run was wrong.** It showed
thirteen scope rows and was missing `Orders — record shipments`, even though the
commit that added that scope is an *ancestor* of the commit the image was
committed in. The capture had run against a dev server compiled from an older
checkout. Nothing in the harness could catch it — the crop was right, the dialog
was fully in frame, the shot passed, and the result was a plausible, confident,
wrong picture of a security-relevant surface. **Pin the server to the commit you
intend to publish from, and count the rows in the file afterwards.**

The five that remain are **A1, A2, A7, A10, A14** — plus **A15**, which is a
decision rather than a capture. None is a matter of harness time; see each entry.

## First run of 2026-08-23 (AGL-1950) — 6 captured, 10 not

Six are in the tree and on their pages: **A3, A4, A5, A6, A9, A16**. The other
ten are **not captured, and none of them is a matter of running the harness
again** — each is marked below with what actually blocks it. Two things the run
established that the specs could not have known:

- **The seeded e2e org has no Stripe customer.** `seed-e2e.mjs` writes
  `subscription: { status: 'active' }` and nothing else, so anything that needs
  a real subscription refuses with a **"No billing account yet"** toast. That is
  the line: everything in the cancel funnel *up to* the final confirm is
  client-side and captured; A1 and A2 sit on the far side of it.
- **There were no `<!-- screenshot: … -->` placeholders to replace.** None of
  the sixteen was ever inserted into a docs page, so the images were placed at
  the anchors each entry names instead. The instruction above is kept because it
  is right for the rest of this file.

Several specs also carry selectors or counts that have drifted since 2026-08-18.
Each correction is recorded on its own entry rather than silently applied.

Two conventions worth restating because most of these need them:

- **`clipTo` beats a full page.** the ask is section- and component-level
  crops. A `clipTo` crops to what the element *measures at capture time*, which
  is what a card whose neighbours keep growing needs. Reach for a fixed `rect`
  only when there is no element to name (page chrome, a toolbar band).
- **`annotate` draws the numbered badge + outline.** Where an entry lists
  callouts, they are the `annotate` marks, in order — and the docs page needs a
  matching numbered list beneath the image, or the badges mean nothing.

⚠️ **Read `CONTRIBUTING.md`'s note on the capture account before running these.**
The harness signs in as STAFF, and staff see release-flagged-off surfaces no
customer does. Three shots below are on a flagged surface (Aglyn Assist) and
must hide the staff-preview chip — noted per shot.

## Billing lifecycle (AGL-1905)

### A1. `static/img/billing-and-plans/pending-downgrade-chip.png` — ⛔ BLOCKED (AGL-1950)

- **Docs page:** `workspace-and-billing/billing-and-plans/downgrading-and-canceling.md` → `#pending-downgrade`
- **Precondition:** an org on a paid tier with a **scheduled downgrade** —
  switch to a lower self-serve plan and confirm, so `subscription.pendingDowngrade`
  is set. Do not let it settle; the chip only exists while the schedule is pending.
- **Frame:** the **Current plan** card only. The `moves to {plan} on {date}` chip
  and the **Keep my current plan** button must both be in frame — they are the
  two halves of the story and a crop holding one without the other is worse than
  no image.
- **Callouts:** ① the pending-downgrade chip, ② Keep my current plan.
- **Alt text:** The Current plan card with a chip reading that the plan moves to
  a lower tier on a future date, and a Keep my current plan button beside it.
- **⛔ Blocked (2026-08-23):** the chip only exists once a downgrade has actually
  been *scheduled*, which is a Stripe subscription mutation. The seeded org has
  no Stripe customer, so **Downgrade** answers **"No billing account yet"** and
  no schedule can be created. Unblocking it means a real test-mode customer with
  a live subscription on the fixture org — not a harness change.

```js
{
  out: 'billing-and-plans/pending-downgrade-chip.png',
  path: `/${ORG_SLUG}/billing`,
  waitFor: 'Current plan',
  settleMs: 1500,
  annotate: [
    { locator: '.MuiChip-root:has-text("moves to")', n: 1 },
    { locator: 'button:has-text("Keep my current plan")', n: 2 },
  ],
  clipTo: {
    locator: '.MuiCard-root:has(:text-is("Current plan"))',
  },
}
```

### A2. `static/img/billing-and-plans/downgrade-preview-zero-due.png` — ⛔ BLOCKED (AGL-1950)

- **Docs page:** `workspace-and-billing/billing-and-plans/downgrading-and-canceling.md` → `#when-changes-take-effect`
- **Precondition:** an active paid subscription. Open the plan switch confirm
  dialog for a **lower** tier so the preview resolves.
- **Frame:** the confirm dialog only. **$0 due today** and the effective date
  must both be legible — this image exists to prove the sentence in the table,
  and a crop where the amount is readable but the date is not proves half of it.
- **Alt text:** The downgrade confirmation dialog showing $0 due today and the
  date the new plan takes effect.
- **⛔ Blocked (2026-08-23):** same wall as A1 — the confirm dialog never opens.
  Clicking **Downgrade** on a lower plan raises **"No billing account yet"**,
  because the preview is a Stripe call and the fixture org has no customer.
- **Spec correction:** the button on a lower plan's card reads **DOWNGRADE**, not
  `Switch`, and the disclosure that reveals those cards reads *"Looking for
  something smaller"* / *"Hide lower plans"*, not `Show 2 lower plans`.

```js
{
  out: 'billing-and-plans/downgrade-preview-zero-due.png',
  path: `/${ORG_SLUG}/billing`,
  waitFor: 'Current plan',
  actions: [
    { click: 'text=Show 2 lower plans', settleMs: 600 },
    { click: '.MuiCard-root:has-text("Starter") button:has-text("Switch")', settleMs: 2000 },
  ],
  clipTo: { locator: '[role="dialog"]' },
}
```

### A3–A6. The retention funnel, one shot per step — ✅ ALL FOUR CAPTURED (AGL-1950)

- **Docs page:** `workspace-and-billing/billing-and-plans/downgrading-and-canceling.md` → `#the-cancel-dialog`
- **Precondition:** an org with a live subscription and **no prior winback**
  (the winback step is once per org, ever — an org that has taken one will skip
  A5 entirely and the shot cannot be retaken without a fresh org).
- **Frame:** the dialog only, every step.
- ⚠️ **Do not complete the funnel.** Close the dialog after each capture. The
  final step cancels a real subscription.

| # | File | Step | Must be legible |
| --- | --- | --- | --- |
| A3 | `retention-survey.png` | Survey | All seven reasons and the optional comment box |
| A4 | `retention-downsell.png` | Downsell | The named smaller plan and **No thanks, continue** |
| A5 | `retention-winback.png` | Winback | The **percentage and the month count** — the bound is the point |
| A6 | `retention-confirm.png` | Confirm | The over-Free-limits warning and **Keep my plan** |

- **✅ All four captured 2026-08-23.** Every step before the final confirm is
  **client-side**, which is why these are capturable on a fixture org with no
  Stripe customer while A1 and A2 are not. The run stopped at the confirm step;
  **Yes, cancel** was never clicked.
- **Reaching the winback does not spend it.** The offer is once per organization,
  but it is *accepting* it that consumes it — the step was reached repeatedly
  during this run and still renders. So A5 is repeatable, and the "capture it
  before anything else exercises the funnel" ordering is not needed. Do not click
  **Apply the discount**.
- **Spec correction:** pick the survey reason by radio **value**
  (`too_expensive`), not by its label — the labels use a typographic apostrophe
  (*It's too expensive*) that a plain-quote selector will not match.

- **Alt text (A3):** The cancellation survey asking why you're leaving, with
  seven reasons and an optional comment box.
- **Alt text (A4):** The downsell step offering a smaller paid plan, with a No
  thanks, continue button.
- **Alt text (A5):** The winback step offering a percentage discount for a
  stated number of months.
- **Alt text (A6):** The cancel confirmation listing what will be over the Free
  plan's limits, with Keep my plan and the cancel action.

```js
// A3. The later steps need the previous one answered, so they are separate
// shots rather than one `actions` chain — a chain that fails halfway leaves
// you guessing which step broke.
{
  out: 'billing-and-plans/retention-survey.png',
  path: `/${ORG_SLUG}/billing`,
  waitFor: 'Current plan',
  actions: [{ click: 'button:has-text("Cancel subscription")', settleMs: 800 }],
  clipTo: { locator: '[role="dialog"]' },
}
// A4/A5/A6 repeat with the survey answered first:
//   { click: 'text=It’s too expensive', settleMs: 200 },
//   { click: 'button:has-text("Continue")', settleMs: 1500 },
// then for A5 add   { click: 'button:has-text("No thanks, continue")', settleMs: 600 }
// and for A6 add it twice.
```

### A7. `static/img/billing-and-plans/invoice-tax-line.png` — ⛔ BLOCKED (AGL-1950)

- **Docs page:** `workspace-and-billing/billing-and-plans/overview.md` → `#sales-tax`
- **Precondition:** a paid invoice **with a non-zero tax line** on an org whose
  billing address is in a jurisdiction Aglyn collects in.
- **Capture:** the Stripe-hosted invoice reached from **Billing history → View**.
- **Frame:** the invoice's totals block only — subtotal, the **tax line named
  separately**, total. Crop out the customer address block.
- ⚠️ **Redact before committing:** the invoice number, the customer name and the
  address. This is the one shot in the plan that renders real billing data.
- **Alt text:** An invoice totals block with sales tax listed as its own line
  between the subtotal and the total.

*(No shot spec — this is on Stripe's domain, outside the harness. Capture by
hand and redact.)*

- **⛔ Blocked (2026-08-23):** unchanged, and deliberately so. It needs a real
  paid invoice carrying a real tax line, reached through Stripe's own pages —
  the one shot in this file that renders live billing data. Not automatable, and
  not something to fake.

## API (AGL-1928, guides)

### A8. `static/img/api/api-keys-card.png` — ✅ CAPTURED (AGL-1950, 2026-08-23 second pass)

- **Docs page:** `guides/your-first-api-call.md` → `#step-1-create-a-key`
- **Capture:** **Organization → Settings**, scrolled to the **API keys** card,
  with at least two keys present so the list reads as a list — one named
  descriptively (`zapier-orders-sync`) to make the guide's naming advice
  self-evident, and one revoked so the revoked state is visible.
- **Frame:** the API keys card only.
- **Callouts:** ① the Create API key button, ② a key's truncated prefix,
  ③ the last-used column.
- **Alt text:** The API keys card listing two keys with their scopes, truncated
  prefixes and last-used times, and a Create API key button.
- **✅ Captured 2026-08-23 (second pass)**, against two key documents seeded by
  `tools/e2e/seed-docs-fixtures.mjs`.
- **The fixture needs no credential to exist, and that is the point.** The
  collection is top-level `apiKeys` and **the document id IS the SHA-256 of the
  raw token**, so a seeded row is the hash of nothing: no key was ever minted and
  no string authenticates against it. This is what makes A8 safe where A10 is
  not — do not "improve" it by minting real keys through the dialog.
- **⚠️ Spec correction — a revoked key CANNOT be photographed here.**
  `OrgApiKeysCard` runs `keys.filter((key) => !key.revokedAt)` before it maps
  rows, so a revoked key leaves the card entirely. There is no strikethrough, no
  `Revoked` chip, no dimmed row — the only revocation strings on the surface are
  in the confirm dialog. The seed writes a revoked key (`old-migration-script`)
  anyway, as a **negative control**: it must NOT appear in the image, and the row
  count is what proves the filter is still there.
- **Spec correction:** **API keys** is a **tab** on the Settings page, not a card
  on the General page and not a left-nav list item — so `scroll` will never reach
  it. It has to be clicked. Worse for a capture: **every tab panel stays mounted
  and hidden**, so `waitFor: 'API keys'` matches instantly on text nobody can see.
  The `clipTo` is the real guard, because a `display:none` card has no bounding
  box and the harness fails the shot rather than cropping to something else.
- **Callouts dropped.** See the note under A11 — the badge lands on the content
  to the element's left, and here it sat across the key prefix it pointed at.

```js
{
  out: 'api/api-keys-card.png',
  path: `/${ORG_SLUG}/settings`,
  waitFor: 'API keys',
  settleMs: 1200,
  actions: [{ scroll: 'text=API keys', settleMs: 800 }],
  annotate: [
    { locator: 'button:has-text("Create API key")', n: 1 },
    { locator: 'text=/aglyn_sk_[a-z0-9]+…/', n: 2 },
  ],
  clipTo: {
    locator: '.MuiCard-root:has(> .MuiCardHeader-root:has-text("API keys"))',
  },
}
```

### A9. `static/img/api/create-key-scopes.png` — ✅ CAPTURED (AGL-1950)

- **Docs page:** `guides/your-first-api-call.md` → `#step-1-create-a-key`
- **Capture:** the **Create API key** dialog with a name typed and **Datasets —
  read** ticked, so the guide's step 5 matches the image exactly.
- **Frame:** the dialog only. **All eight scope rows must be in frame** — the
  three new ones (Orders, Products, Media) are the reason this shot is being
  retaken, and a crop that stops at five silently documents the old surface.
- **Callouts:** ① the name field, ② the ticked scope, ③ the three commerce and
  media scopes as a group.
- **Alt text:** The Create API key dialog with a descriptive name typed and the
  Datasets — read scope ticked, showing every available scope.
- **✅ Captured 2026-08-23. ⚠️ RE-SHOT the same day — the first image was wrong.**
  Opening the dialog writes nothing; the key is only created on submit, which the
  shot never presses.
- **⚠️ The captured screenshot showed THIRTEEN rows and was missing `Orders — record
  shipments`.** `orders:write` was added to the picker by `0354a2bf8`, which is an
  **ancestor of the capture commit** — so the code was in the tree and the image
  still lacked the row. The capture ran against a dev server compiled from an
  older checkout, and nothing in the harness can see that: the crop was correct,
  the dialog was fully in frame, the shot passed. **This is the exact failure the
  entry below warns about, and it happened anyway, one line down from the
  warning.** A stale dev server produces a plausible, correct-looking, wrong
  image. Re-shot against a server pinned to the capture commit; the current file
  has all fourteen rows, ending `Media — upload`.
- **Spec correction — there are FOURTEEN scopes, not thirteen and not eight:**
  Datasets read/write,
  Contacts read/write, Sites read/publish/create, Form submissions read/write,
  Orders **read and record-shipments**, Products read, Media read/upload. The
  spec's warning still stands and now bites harder: a crop that stops early
  republishes a stale surface — and so does a stale *server*.
- **Two traps the spec walks into.** (1) **Datasets — read is ticked by default**,
  so the instruction to tick it turns it *off*; the first run of this shot
  published an unticked box. (2) At 1440×900 the dialog is **taller than the
  window**, and a `clip` is clamped to the viewport, so the last scope rows and
  the Create button were cropped away. The shot sets its own taller `viewport`.

```js
{
  out: 'api/create-key-scopes.png',
  path: `/${ORG_SLUG}/settings`,
  waitFor: 'API keys',
  actions: [
    { scroll: 'text=API keys', settleMs: 600 },
    { click: 'button:has-text("Create API key")', settleMs: 800 },
    { fill: ['[role="dialog"] input[type="text"]', 'zapier-orders-sync'], settleMs: 200 },
  ],
  annotate: [
    { locator: '[role="dialog"] input[type="text"]', n: 1 },
    { locator: 'label:has-text("Datasets — read")', n: 2 },
    { locator: 'label:has-text("Orders — read")', n: 3 },
  ],
  clipTo: { locator: '[role="dialog"]' },
}
```

### A10. `static/img/api/key-shown-once.png` — ✅ CAPTURED (AGL-1950, 2026-08-24 third pass)

- **Docs page:** `guides/your-first-api-call.md` → `#step-1-create-a-key`
- **Capture:** the moment after creating a key, where the full token is shown
  with its copy button and the "you won't see this again" warning.
- **Frame:** the reveal panel only.
- ⚠️ **The token in frame must be from a key you revoke immediately after.**
  Do not blur a live key and call it redacted — a blur is reversible often
  enough that the only safe capture is a dead credential.
- **Alt text:** A newly created API key shown once in full, with a copy button
  and a warning that it will not be shown again.

- **✅ Captured 2026-08-24 (third pass), and the hazard is answered by WHERE it
  ran rather than by what happened afterwards.** The two earlier passes read
  "creating a key is a real write" as meaning this could only ever be a manual
  shot. It is a real write — to the **Firestore emulator**. The console under
  capture is pinned to a local, ephemeral database, so `POST /api/org/api-keys`
  stored the token's SHA-256 there and nowhere else. **The string in the image
  authenticates against nothing, anywhere, and cannot be made to.** That is
  strictly stronger than the plan's own mitigation: "revoke immediately after"
  leaves a real window between the capture and the revoke, and this leaves none.
- **⛔ The shot must never be run against a console wired to real Firebase.**
  With `E2E_BASE_URL` pointed at production it would mint a live credential and
  publish it to a public repository — the one way to turn this shot back into
  the hazard the plan describes. The spec now says so in the harness itself.
- **Spec correction:** the create dialog's submit button reads **`Create key`**,
  not `Create` — and `button:has-text("Create")` would match the card's
  **Create API key** first. The reveal is a second `[role="dialog"]`; the crop
  names its title (`Copy your API key`) so it cannot race the create dialog's
  unmount, and so a failed creation fails the shot instead of quietly
  re-photographing the dialog that was already there.
- No revoke was needed and none was performed; the emulator was torn down.

## Agency workspace (guides)

### A11. `static/img/guides/team-managers-vs-collaborators.png` — ✅ CAPTURED (AGL-1950, 2026-08-23 second pass)

- **Docs page:** `guides/run-an-agency-workspace.md` → `#step-3-access`
- **Capture:** **Organization → Team** on an org holding both a workspace
  manager and a site collaborator, so the two rows sit side by side and the
  distinction is visible rather than asserted.
- **Frame:** the members table only.
- **Callouts:** ① a manager row's scope, ② a collaborator row's scope,
  ③ the seat counts.
- **Alt text:** The team members table showing a workspace manager alongside a
  site collaborator, with their different access scopes and the seat counts.
- **✅ Captured 2026-08-23 (second pass)**, against the collaborator seeded by
  `tools/e2e/seed-docs-fixtures.mjs` (Priya Raman, editor, one site).
- **A collaborator is NOT a role value.** Managers and collaborators share one
  vocabulary (`owner|admin|editor|viewer`); the difference is reach.
  `isOrgWideMember` returns false only for a member carrying `allHosts: false`
  **and** a non-empty `hostAccess` — **both**. A member doc with neither is read
  as a *legacy* org-wide row and renders `Team manager`, which is the quiet way
  this fixture could have produced the exactly-wrong image.
- **The seat line moved as predicted and is correct:** `2 of 15 manager seats
  used · 1 site collaborator (metered per site)`. `countManagerSeats` counts
  org-wide members only, so the collaborator lands in the second half of the
  sentence and the e2e suite's manager count is untouched.
- **Spec correction:** the card header is `Organization members — E2E Bakery Co`,
  not `Members`. The plan's locator still matches, because Playwright's
  `has-text` is a case-insensitive *substring* — do not "tighten" it to
  `:text-is()`. The access cells render `All sites` and `1 site(s)` (uppercased
  by CSS, so `innerText` reads `ALL SITES` / `1 SITE(S)` — a text assertion
  written in the source casing fails against a surface that is rendering fine).
- **⚠️ Callouts dropped, and this generalises to every card in this file.** The
  harness draws its badge at `(x−14, y−14)` of the target. In a dialog that lands
  in the backdrop; on a left-aligned table row it lands **on the content**. Here
  callout ③ covered the `2` in `2 of 15 manager seats used` — the number it
  existed to point at — and ① resolved to nothing, leaving the numbering to start
  at ②. Annotate what a reader would otherwise hunt for; a cropped card is not
  that.

```js
{
  out: 'guides/team-managers-vs-collaborators.png',
  path: `/${ORG_SLUG}/team`,
  waitFor: 'Members',
  settleMs: 1200,
  clipTo: {
    locator: '.MuiCard-root:has(> .MuiCardHeader-root:has-text("Members"))',
  },
}
```

### A12. `static/img/guides/site-members-invite.png` — ✅ CAPTURED (AGL-1950, 2026-08-23 second pass, RE-POINTED)

- **Docs page:** `guides/run-an-agency-workspace.md` → `#step-3-access`
- **Capture:** a **site's** members card with the invite control open, showing
  that this grants access to *this site only*.
- **Frame:** the card plus the open invite control.
- **Alt text:** A site's members card with the invite control open, granting
  access to that one site.
- **✅ Captured 2026-08-23 (second pass), on a different surface.** `/{host}/setup`
  still has no Members card (Basic details · SEO · Theme · Custom domain · Emails ·
  Activity), so the spec's target is gone for good.
- **⚠️ The obvious re-point is the wrong one.** The first attempt shot the Team
  page's invite row with **All sites** unticked, as the previous pass suggested.
  That image is a near-duplicate of A11 with an empty checkbox in it: unticking
  there reveals **no site list**, so it shows the *absence* of org-wide access and
  nothing about per-site scoping — a picture of a negative. The real control is
  the **Site access dialog** behind a member's `1 site(s)` / `All sites` access
  cell, which is where `orgHosts` is enumerated, one row per site with its own
  role. That is what the guide describes, so that is what is in the file.
- **Alt text corrected:** it is a site-access dialog for an existing member, not
  an invite control. The filename is kept so the plan's index still resolves.
- **The guide's prose was wrong too, and is fixed.** `run-an-agency-workspace.md`
  step 2 told the reader to use *"each site's members card"* — the surface that no
  longer exists. It now points at the Team page and the per-member Access cell.
- **Note for a future re-shoot:** the fixture org has one site, so the dialog
  lists one row. It reads correctly, but a two-site org would show the choice
  rather than imply it.

```js
{
  out: 'guides/site-members-invite.png',
  path: `/${HOST_BASE}/setup`,
  waitFor: 'Members',
  actions: [{ scroll: 'text=Members', settleMs: 800 }],
  clipTo: {
    locator: '.MuiCard-root:has(> .MuiCardHeader-root:has-text("Members"))',
    include: ['[role="dialog"]'],
  },
}
```

## Commerce (AGL-1794, AGL-1873)

### A13. `static/img/commerce/order-charged-back.png` — ✅ CAPTURED (AGL-1950, 2026-08-23 second pass)

- **Docs page:** `commerce-and-bookings/commerce/overview.md` → `#a-lost-dispute`
- **Precondition:** a seeded order carrying `dispute` with a lost outcome and a
  non-zero `refundedCents`.
- **Frame:** the order row **and** its detail, so both the **Charged back**
  status and the reversed amount are in one image. This is the shot that has to
  show it is *distinct from a refund*, so a frame with only the badge does not
  do the job.
- **Callouts:** ① the Charged back status, ② the reversed amount,
  ③ the Disputes filter.
- **Alt text:** An order showing Charged back status with the reversed amount,
  distinct from a refund, and the Disputes filter on the orders list.
- **✅ Captured 2026-08-23 (second pass)**, against three orders seeded by
  `tools/e2e/seed-docs-fixtures.mjs` — one charged back, two ordinary.
- **Spec correction — the route needs the tab.** `/{host}/commerce/orders`
  **404s**. Orders are a tab of the commerce plugin page and `HubTabs` seeds its
  state from the query param, so the working path is
  **`/{orgSlug}/hosts/{host}/products?tab=orders`**.
- **Spec correction — `Disputes` is a select, not a button.** The plan's
  `button:has-text("Disputes")` matches nothing; it is a MUI `TextField select`
  (`All orders` / `Open dispute` / `Charged back`).
- **Spec correction — no detail dialog is needed.** The plan asks for "the order
  row **and** its detail" so the status and the reversed amount are in one image.
  The row already carries both: the Total column renders **`$0.00`** over
  **`$62.00 less refunds`**, and the `Charged back` chip sits **beside** the
  untouched `Refunded` status chip. That pairing is a better statement of the
  distinction than the dialog is — a lost dispute is a refund the merchant did
  not choose — and it keeps the `Disputes` filter in the same frame, which a
  dialog crop would have lost.
- **⚠️ Do not copy the demo-brands order shape.** `tools/scripts/lib/demo-brands.mjs`
  writes `orderNumber` / `email` / `items[].unitPriceCents`; `HostOrder` reads
  `number` / `customerEmail` / `lineItems[].unitAmountCents`. An order seeded in
  the demo shape renders a doc-id order number, an em-dash customer and a blank
  item name — it photographs as a broken console rather than as a chargeback.
- **Callouts dropped, and here they were actively misleading:** the badge for the
  `Charged back` chip is drawn up and to its left, which is exactly where the
  `Refunded` chip sits — callout ① for the chargeback landed **on the refund**,
  marking the one thing the image exists to distinguish it from.

```js
{
  out: 'commerce/order-charged-back.png',
  path: `/${HOST_BASE}/commerce/orders`,
  waitFor: 'Charged back',
  settleMs: 1500,
  annotate: [
    { locator: '.MuiChip-root:has-text("Charged back")', n: 1 },
    { locator: 'button:has-text("Disputes")', n: 3 },
  ],
}
```

### A14. `static/img/commerce/selling-not-enabled.png` — ✅ CAPTURED (AGL-1950, 2026-08-24 third pass)

- **Docs page:** `commerce-and-bookings/commerce/overview.md` → `#orders`
- **Precondition:** an org on a plan **without** commerce whose site still has
  the commerce plugin enabled — the exact state the admonition describes, and
  the whole reason the shot is worth taking.
- **Capture:** attempting to send a draft order's payment link, so the refusal
  appears.
- **Frame:** the refusal message with enough of the draft order around it to
  show where the customer was.
- **Alt text:** A draft order refusing to create a payment link with a message
  that selling is not enabled, on a plan without commerce.

- **✅ Captured 2026-08-24 (third pass)**, against a free-plan org added to
  `tools/e2e/seed-docs-fixtures.mjs` (`docs-free` / `docs-free-site`). "No
  fixture currently produces it" was true; it turned out to be about fifteen
  lines of fixture, not a hand-staged org.
- **The state is reachable because the switchboard and the plan gate are
  different things.** `enabledPlugins` is an ORG field and `commerce` is an
  entitlement, so an org that drops to Free keeps the plugin installed. The
  console page renders, the **Draft order** button is live, and the refusal
  arrives only on submit — which is exactly the sentence the admonition makes.
  Only `free` lacks `commerce` (`plan-entitlements.ts`); every self-serve tier
  from Starter up carries it, so no other plan produces this shot.
- **A SEPARATE org, not a flipped plan.** Setting the bakery's `plan` to `free`
  would have been one line, but every other shot in this plan is taken on that
  org and several read its plan — the retention funnel's over-Free-limits
  warning, the billing cards, the seat line. A fixture that mutates a shared org
  photographs the other shots as a side effect.
- **Spec correction — the anchor moved.** The spec names `#orders`, but the
  admonition this image illustrates ("Selling needs a plan with commerce") now
  sits under the chargebacks section, which is where `## Orders` sends the
  reader with *"see the note below"*. The image is placed with the admonition,
  not with the heading the spec named.
- **Spec correction — the refusal is a SNACKBAR, not an inline error**, and
  notistack auto-hides it, so the settle after the submit is short on purpose.
  The dialog does not close on a refusal, which is the only reason the spec's
  "enough of the draft order around it to show where the customer was" fits in
  one frame at all.
- The Product select's options are a portal at the end of `<body>`, so the
  `li[role="option"]` is **not** inside `[role="dialog"]` — a scoped selector
  matches nothing and the fill that follows lands on a closed menu.

## Tooltips (AGL-1943)

### A15. `static/img/getting-started/assist-panel-help-tip.png` — ⛔ BLOCKED (AGL-1950)

- **Docs page:** `getting-started/aglyn-assist.md` → `#what-it-can-do`
- **Frame:** the Assist panel header with the `?` tooltip **open**.
- ⚠️ **Flagged surface.** `release_assist` is off by default and the harness
  signs in as staff, so the **Staff preview** chip will be in frame. Hide it
  before capturing, and assert it is gone — a staff-only chip published in a
  customer doc is the AGL-1600 leak.
- **Alt text:** The Aglyn Assist panel header with its help tooltip open,
  linking to the documentation.
- **⛔ Not captured 2026-08-23 — deliberately, and this one is a judgement call
  a human should confirm.** The surface renders and the shot is technically
  easy: the launcher is `[aria-label="Open Aglyn Assist"]` and the tip is
  `Help: Aglyn Assist`. Three things argued against publishing it:
  - **`release_assist` still ships `defaultEnabled: false`**, and its own
    description says it is blocked on two *published legal artifacts* — the
    privacy-policy disclosure for stored Q&A, and the Anthropic row on
    `/legal/subprocessors` that was removed on the premise that no production
    key existed. A screenshot is a stronger claim that a feature is here than
    prose hedged with a rollout caution.
  - **The hazard the spec guards against no longer reproduces.** There is now no
    **Staff preview** chip anywhere in the panel, so the spec's mitigation — hide
    the chip, then assert it is gone — protects nothing. That is worse, not
    better: the staff-only render is now visually identical to the shipped one.
  - **The staff-only guard cannot see this surface.** `data-staff-only` is set
    only in `secondary-nav-bar.component.tsx`, so `assertNoStaffOnlyChrome`
    would pass on a page full of Assist. Nothing mechanical would have caught it.

  If the flag is on — or the legal artifacts are published and the rollout
  decision is made — this is a two-minute capture.

```js
{
  out: 'getting-started/assist-panel-help-tip.png',
  path: `/${HOST_BASE}`,
  waitFor: 'Aglyn Assist',
  actions: [
    { click: '[aria-label="Open Aglyn Assist"]', settleMs: 800 },
    // AGL-1600: hide the staff-preview chip, then assert it is really gone.
    { evaluate: `document.querySelectorAll('.MuiChip-root').forEach(c => { if (c.textContent === 'Staff preview') c.remove() })` },
    { hover: '[aria-label^="Help: Aglyn Assist"]', settleMs: 600 },
  ],
  assertAbsent: 'text=Staff preview',
  clipTo: {
    locator: '.MuiPaper-root:has([aria-label="Close Aglyn Assist"])',
    include: ['[role="tooltip"]'],
  },
}
```

### A16. `static/img/billing-and-plans/lower-tiers-expanded-tip.png` — ✅ CAPTURED (AGL-1950)

- **Docs page:** `workspace-and-billing/billing-and-plans/downgrading-and-canceling.md` → `#when-changes-take-effect`
- **Capture:** the billing plan cards with **lower plans expanded** (the `?`
  only exists once expanded) and its tooltip open.
- **Frame:** the disclosure row and the tooltip. The dimmed lower-tier cards
  should be partly visible beneath, so the image shows *what* was disclosed.
- **Alt text:** The Show lower plans control expanded, with a help tooltip
  explaining that a downgrade takes effect at the end of the paid period.
- **✅ Captured 2026-08-23.**
- **Spec corrections.** The tip is `[aria-label^="Help: Moving to a lower plan
  takes effect later"]`, not `Help: Downgrading`. The disclosure reads *"Looking
  for something smaller"*. And the lower-tier cards are **above** this control,
  not beneath it, so no crop holds both them and the tooltip at a readable size;
  cropping to the named full-width `MuiStack` caught the Enterprise card sitting
  to its right instead. The frame is the disclosure row and its tip.

```js
{
  out: 'billing-and-plans/lower-tiers-expanded-tip.png',
  path: `/${ORG_SLUG}/billing`,
  waitFor: 'Current plan',
  actions: [
    { click: 'text=/Looking for something smaller/', settleMs: 600 },
    { hover: '[aria-label^="Help: Downgrading"]', settleMs: 600 },
  ],
  clipTo: {
    locator: '.MuiStack-root:has(> button[aria-expanded="true"])',
    include: ['[role="tooltip"]'],
  },
}
```

---

# Additions of 2026-08-19 (AGL-2129, AGL-2126, AGL-2127)

Five captures for the new Marketplace walkthrough, and one re-shoot the
Marketplace/Plugins IA correction (AGL-2123) makes necessary. The API reference
pages need **no** screenshots — they are request/response, and a picture of a
terminal is worse than the code block it would replace.

## Marketplace walkthrough

### M1. `static/img/marketplace/org-nav-marketplace-and-plugins.png`

- **Docs page:** `guides/install-your-first-plugin.md` → `#step-1-open`
- **Capture:** console → any org, organization-level navigation panel expanded.
- **Frame:** the org nav panel ONLY, cropped so **Marketplace** and **Plugins**
  are both visible as separate entries. That adjacency is the whole point of the
  shot — AGL-2123 exists because the docs claimed one had absorbed the other.
- **Alt text:** The organization navigation with Marketplace and Plugins listed as
  two separate sections.
- **Guard note:** must be captured with NO ⚑ badges visible. See CONTRIBUTING.md
  on the staff capture account — the harness hides staff-only chrome and fails a
  shot where any is still on screen.

### M2. `static/img/marketplace/listing-detail-header.png`

- **Docs page:** `guides/install-your-first-plugin.md` → `#step-2-browse`
- **Capture:** console → **Marketplace → Browse All** → open any free, listed
  plugin's detail page.
- **Frame:** the listing header — name, artifact-type label, version, badges, and
  the star rating. Not the whole page.
- **Alt text:** A marketplace listing's header showing its type, version, publisher
  badges and rating.
- **Note:** pick a listing with a **Verified publisher** badge and no **Reviewed**
  badge if the seed allows — the two-badge distinction is what the paragraph beside
  it explains.

### M3. `static/img/marketplace/install-to-selected-sites.png`

- **Docs page:** `guides/install-your-first-plugin.md` → `#step-4-targeting`
- **Capture:** the same detail page on an org with **at least three sites** and the
  listing **not yet installed** (the targeting control is only rendered before an
  install — re-asking once it is settled would lie, AGL-773). Set **Install to** to
  **Selected sites** so the **Sites** checklist is open with one or two ticked.
- **Frame:** the Install card — the **Install to** field, its helper text, the
  checkbox list, and the **Install** button.
- **Alt text:** The Install to dropdown set to Selected sites, with a checklist of
  the organization's sites and two of them ticked.
- **Note:** the helper text is state-dependent and IS the content here. A one-site
  org renders no "Selected sites" option at all, so a single-site capture shows the
  wrong control.

### M4. `static/img/marketplace/install-confirm-dialog.png`

- **Docs page:** `guides/install-your-first-plugin.md` → `#step-5-install`
- **Capture:** press **Install** on the same listing and stop at the dialog. Do not
  confirm.
- **Frame:** the dialog only. The bolded install target ("This will be installed to
  **all sites**") must be legible — the page tells the reader that phrase is their
  last chance to catch a mis-set target.
- **Alt text:** The install confirmation dialog naming the listing, its type and
  version, and in bold where it will be installed.

### M5. `static/img/plugins/plugins-switchboard-cards.png`

- **Docs page:** `guides/install-your-first-plugin.md` → `#step-7-off`
- **Capture:** console → organization → **Plugins**.
- **Frame:** both cards — **Installed from the marketplace** above **Built in** —
  with at least one switch visible in each. If the seeded org has no marketplace
  install, the empty state of the first card is still correct to show, because the
  second card is the one the caption is about.
- **Alt text:** The organization Plugins page with an Installed from the marketplace
  card above a Built in card, each row carrying an on/off switch.

## Re-shoot

### M6. `static/img/guides/marketplace-browse.png` (existing — re-capture)

- **Docs page:** `developers/plugins/overview.md`, top of **Install & upgrade**
- **Why:** the existing caption describes a Navigation panel listing "Installed and
  the publisher sections". AGL-2123 corrected the surrounding prose to the shipped
  IA; the image should be confirmed against it rather than assumed. Re-capture only
  if the panel no longer matches the caption — an unchanged image needs no churn.
- **Frame:** unchanged from the original.

---

# 2026-08-23 additions (AGL-2486)

The canvas work of the August 23 release. Same conventions as above: 1440×900,
light scheme, seeded emulator stack, component-level crops, `static/img/besigner/`.

**Two of these need a document state the seed does not have** (a formatted text
element, a wrapped inline heading). Add the state in the shot's `actions` rather
than seeding it, so the capture also proves the feature works — a shot that has to
be hand-staged is a shot that silently rots.

> **A staged shot must clear the unsaved state it leaves behind, and there are TWO
> halves of it.** The besigner publishes unsaved edits to the co-editing mirror in
> RTDB *and* writes a private crash-recovery draft to `localStorage`; the next
> editor load restores from either. Four of these five carry `stagesDocument: true`,
> which drops both before the page opens. Without it the shots photograph each
> other — `inline-text-editing.png` first came out 32px low, wearing the margin the
> box-styler shot had just set, and the double-click landed on the Stack instead of
> the heading. The failure looks like a mis-measured `clip`, not like contamination.

### N1. `static/img/besigner/state-chips-row.png` — ✅ CAPTURED (AGL-2486)

- **Docs page:** `building-sites/besigner/responsive-styling.md` → `#interaction-states`
- **Capture:** besigner → select a **Button** → **Styles** panel. The breakpoint chip
  row and the state chip row must both be in frame, with **Hover** selected so the
  canvas hold banner is showing and Hover's chip carries its **×**.
- **Frame:** from the breakpoint chip down to the first style group heading. Crop out
  the canvas.
- **Alt text:** The Styles panel with the breakpoint chips above a row of state chips
  — Default, Hover, Active, Focus, Disabled — with Hover selected.
- **Note:** pick an element that already has a hover style, so at least one *other*
  chip shows the **•** that marks a state with styles. All-empty chips do not show
  what the dot means, and the dot is the only way to tell at a glance where styling
  already exists.
- **As captured:** the seeded `Order now` button, with the shot itself giving
  **Focus** a slice and then **Hover** one — so `Hover • ⊗` and `Focus •` are both
  in frame and the dot and the clear are told apart.

### N2. `static/img/besigner/box-styler-diagram.png` — ✅ CAPTURED (AGL-2486)

- **Docs page:** `building-sites/besigner/responsive-styling.md` → `#box-stylers`
- **Capture:** besigner → select an element with **padding and margin already set**
  (northwind-coffee's Business Home hero works) → **Styles** → the spacing diagram,
  with **one side selected** so its editor is open beneath and the selected region
  carries its tint.
- **Frame:** the diagram, its legend, and the open side editor showing the **Apply
  to** toggle and the step select. Crop at the next style group.
- **Alt text:** The box model diagram with margin, border, padding and contents
  regions labelled, one side selected, and its spacing editor open below.
- **Note:** capture in **light** per the convention, but check the dark scheme
  renders too — the figure has no mode branch and is meant to re-resolve on the class
  swap, so a dark capture is the cheapest proof that still holds. Sides with values
  must show the resolved amount (`80px`), not the step number.
- **As captured:** the seeded hero **Stack** (`py: 8`, so padding reads back `64px`),
  with the shot adding a `32px` top margin so the outer ring carries a value too, and
  landing on the padding-top side. Dark scheme checked under
  `colorScheme: 'dark'` — the regions, labels and the selected tint all re-resolve,
  so no mode branch is needed. Note the artboard's own scheme toggle is *not* this:
  it repaints the canvas, not the panel.

### N3. `static/img/besigner/inline-text-editing.png` — ✅ CAPTURED (AGL-2486)

- **Docs page:** `building-sites/besigner/text-editing.md` → `#edit-inline`
- **Capture:** double-click a **Typography** heading on the canvas so the in-place
  editor is open, with the floating toolbar above it and the caret in the text.
- **Frame:** the heading and its toolbar, plus enough of the surrounding page to show
  the text sitting **on the page** rather than in a box. The point of the shot is the
  absence of chrome, so do not crop so tight that there is nothing to be absent.
- **Alt text:** A heading being edited directly on the canvas, with a small floating
  toolbar above it and no selection outline around it.

### N4. `static/img/besigner/text-field-read-only.png` — ✅ CAPTURED (AGL-2486)

- **Docs page:** `building-sites/besigner/text-editing.md` → `#text-field-read-only`
- **Capture:** on a Typography element, bold a word in place first so it carries
  formatting, then click away and look at the **Attributes** panel.
- **Frame:** the **Remove formatting** button, the read-only **Text** field, and its
  helper line ("This text is formatted — double-click the element on the canvas to
  edit it. Remove formatting to edit it here."). The helper text is the content of
  this shot and must be legible.
- **Alt text:** The Attributes panel showing a read-only Text field explaining that
  the text is formatted, with a Remove formatting button above it.
- **Annotate:** ~~call out the **Remove formatting** button~~ — **not done, and the
  reason is worth keeping.** Cropped to the button, the field and the helper line,
  the button is the only coloured thing in frame and needs no pointing at; and the
  outline the harness draws sits 3px proud of the element, which put it straight
  through the field's `Text` legend a few pixels below. Annotate what a reader would
  otherwise hunt for, not what the crop already isolates.
- **Found while capturing:** the row holding this button carries `mb: -1`, sized for
  a row with only the help icon in it. A full-height Button in the same row drove its
  label into the outlined field's notch and overprinted the `Text` legend. Fixed in
  `element-props-form.component.tsx` before the shot was taken — a docs image of a
  broken control is a bug report nobody filed.

### N5. `static/img/besigner/element-search-best-matches.png` — ✅ CAPTURED (AGL-2486)

- **Docs page:** `building-sites/besigner/element-catalog.md` → `#element-search`
- **Capture:** the **Elements** panel → type `space` into **Search elements**.
- **Frame:** the search field and the flattened **Best matches** list beneath it.
- **Alt text:** The Elements panel searched for "grid", showing a single Best matches
  list with Grid first and elements matched on their description below it.
- **Note:** `space` was chosen deliberately — it matches Stack on its **description**,
  not its name, which is the behaviour the section documents. A query that matches a
  title would illustrate nothing the reader could not already assume.
- **Captured as `grid` instead, measured rather than assumed.** There is no element
  *named* `Stack` in the picker — the presets are `Stack Horizontal` and `Stack
  Vertical` — and `space` ranks them **38th and 42nd**, behind FAQ, Card, Hero,
  Image and Paper. The image would have sat under a sentence saying `space` finds
  Stack while showing that it does not. `grid` shows **both** documented rules in one
  frame: `Grid`, `Grid Cell`, `Feature Grid`, `Product grid` by name, then `Shop
  catalog` and `Box` on their descriptions. The prose's `space` example is not wrong,
  only unillustratable; leave it, or reword it against the ranking as it measures.
- **Do NOT capture the element detail view yet.** Its placement changed twice during
  the August 23 release and is the least settled surface in the editor; a capture now
  would be wrong within the hour. The prose deliberately describes what the detail
  *says* and not where it appears, for the same reason.
