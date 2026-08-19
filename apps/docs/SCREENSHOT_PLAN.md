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

Two conventions worth restating because most of these need them:

- **`clipTo` beats a full page.** Zach's ask is section- and component-level
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

### A1. `static/img/billing-and-plans/pending-downgrade-chip.png`

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

### A2. `static/img/billing-and-plans/downgrade-preview-zero-due.png`

- **Docs page:** `workspace-and-billing/billing-and-plans/downgrading-and-canceling.md` → `#when-changes-take-effect`
- **Precondition:** an active paid subscription. Open the plan switch confirm
  dialog for a **lower** tier so the preview resolves.
- **Frame:** the confirm dialog only. **$0 due today** and the effective date
  must both be legible — this image exists to prove the sentence in the table,
  and a crop where the amount is readable but the date is not proves half of it.
- **Alt text:** The downgrade confirmation dialog showing $0 due today and the
  date the new plan takes effect.

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

### A3–A6. The retention funnel, one shot per step

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

### A7. `static/img/billing-and-plans/invoice-tax-line.png`

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

## API (AGL-1928, guides)

### A8. `static/img/api/api-keys-card.png`

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

### A9. `static/img/api/create-key-scopes.png`

- **Docs page:** `guides/your-first-api-call.md` → `#step-1-create-a-key`
- **Capture:** the **Create API key** dialog with a name typed and **Datasets —
  read** ticked, so the guide's step 5 matches the image exactly.
- **Frame:** the dialog only. **All eight scope rows must be in frame** — the
  three new ones (Orders, Products, Media) are the reason this shot is being
  retaken, and a crop that stops at five silently documents the old surface.
- **Callouts:** ① the name field, ② the ticked scope, ③ the three commerce and
  media scopes as a group.
- **Alt text:** The Create API key dialog with a descriptive name typed and the
  Datasets — read scope ticked, showing all eight available scopes.

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

### A10. `static/img/api/key-shown-once.png`

- **Docs page:** `guides/your-first-api-call.md` → `#step-1-create-a-key`
- **Capture:** the moment after creating a key, where the full token is shown
  with its copy button and the "you won't see this again" warning.
- **Frame:** the reveal panel only.
- ⚠️ **The token in frame must be from a key you revoke immediately after.**
  Do not blur a live key and call it redacted — a blur is reversible often
  enough that the only safe capture is a dead credential.
- **Alt text:** A newly created API key shown once in full, with a copy button
  and a warning that it will not be shown again.

*(No shot spec — creating a key is a real write. Capture by hand, then revoke.)*

## Agency workspace (guides)

### A11. `static/img/guides/team-managers-vs-collaborators.png`

- **Docs page:** `guides/run-an-agency-workspace.md` → `#step-3-access`
- **Capture:** **Organization → Team** on an org holding both a workspace
  manager and a site collaborator, so the two rows sit side by side and the
  distinction is visible rather than asserted.
- **Frame:** the members table only.
- **Callouts:** ① a manager row's scope, ② a collaborator row's scope,
  ③ the seat counts.
- **Alt text:** The team members table showing a workspace manager alongside a
  site collaborator, with their different access scopes and the seat counts.

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

### A12. `static/img/guides/site-members-invite.png`

- **Docs page:** `guides/run-an-agency-workspace.md` → `#step-3-access`
- **Capture:** a **site's** members card with the invite control open, showing
  that this grants access to *this site only*.
- **Frame:** the card plus the open invite control.
- **Alt text:** A site's members card with the invite control open, granting
  access to that one site.

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

### A13. `static/img/commerce/order-charged-back.png`

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

### A14. `static/img/commerce/selling-not-enabled.png`

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

*(No shot spec — needs an org in a deliberately downgraded state. Set up by hand.)*

## Tooltips (AGL-1943)

### A15. `static/img/getting-started/assist-panel-help-tip.png`

- **Docs page:** `getting-started/aglyn-assist.md` → `#what-it-can-do`
- **Frame:** the Assist panel header with the `?` tooltip **open**.
- ⚠️ **Flagged surface.** `release_assist` is off by default and the harness
  signs in as staff, so the **Staff preview** chip will be in frame. Hide it
  before capturing, and assert it is gone — a staff-only chip published in a
  customer doc is the AGL-1600 leak.
- **Alt text:** The Aglyn Assist panel header with its help tooltip open,
  linking to the documentation.

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

### A16. `static/img/billing-and-plans/lower-tiers-expanded-tip.png`

- **Docs page:** `workspace-and-billing/billing-and-plans/downgrading-and-canceling.md` → `#when-changes-take-effect`
- **Capture:** the billing plan cards with **lower plans expanded** (the `?`
  only exists once expanded) and its tooltip open.
- **Frame:** the disclosure row and the tooltip. The dimmed lower-tier cards
  should be partly visible beneath, so the image shows *what* was disclosed.
- **Alt text:** The Show lower plans control expanded, with a help tooltip
  explaining that a downgrade takes effect at the end of the paid period.

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
