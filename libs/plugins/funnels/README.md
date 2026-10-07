# @aglyn/plugins-funnels

Funnels for an Aglyn site: an ordered list of two to eight steps — a page viewed, a form
submitted, a booking made, a product added to the cart, an order placed, a bar or popup
clicked, a custom event — measured over the visits the site recorded. Shown as the
**Funnels** card on a site's **Analytics** page, on the plans that include per-page
analytics (`screenAnalytics`).

- **Console:** the card (list, editor with pickers drawing the site's real pages, forms,
  services, products and overlays, and a results view with drop-off, conversion, median time
  between steps and a breakdown by source), in the `hostAnalytics` zone. It hosts two zones
  of its own, `funnelsCreate` and `funnelInsight`, which the AI plugin fills.
- **Console API:** `funnels/inventory`, `funnels/results`, `funnels/save`, `funnels/delete`,
  `funnels/propose` (a draft from a description, through core's text-generation seam) and
  `funnels/act` ("Act on this drop-off": a watch on a step plus an automation drafted
  switched off through the `automation` writer on core's resource-drafts seam), and the
  `funnels.overview` / `funnels.steps` figure readers the AI insight job reads.
- **Server declarations:** the site collector's `journey` beacon, counted into
  `hosts/{hostId}/funnelJourneys`; a host event listener that ties a visit to the person a
  form submission names (`journeyId` on the event's context); a `host.email.engaged`
  subscriber that adds `email` steps; and a person eraser.
- **Console server declarations:** the `funnels-drop-off` job on the console's 15-minute
  tick, which raises the `funnelLeft` host event (declared under `hostEvents`) for each
  identified person who stopped at a watched step. The workflows plugin is never imported:
  the draft goes through core's seam and the trigger through the host event bus.

## What it reads, stores and sends

- `hosts/{hostId}/funnels` — the definitions. Members read; the save and delete routes write.
- `hosts/{hostId}/funnelJourneys` — one document per recorded visit: its steps in order with
  server times, where it arrived from (UTM labels or referring site), and `expiresAt`, 90
  days out. A visit is one browser tab, identified by a random id in that tab's session
  storage, and is recorded only when the site has a funnel and the visitor's consent allows
  analytics (core `site-journey.ts`). A visit a form submission ended also carries the
  submitter's address (`personEmail`), the drop-off sweep's queue mark (`dropOffCheckAt`)
  and the follow-ups already raised for the person (`left`); an anonymous visit carries
  none of them. Erased with the person (the plugin's person eraser).
- `hosts/{hostId}/funnels/{id}.dropOffWatches` — the steps and waits automations follow up on.
- `hosts/{hostId}/funnelResults` — computed results, kept up to a day, expiring on their own.

Sends nothing to a third party. A follow-up email is sent by the automation the person
switched on, under the send step's own consent, unsubscribe and suppression rules. "Create with AI" goes through whichever plugin generates
text for the workspace, under that plugin's own rules and credits.
