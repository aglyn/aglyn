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
- **Console API:** `funnels/inventory`, `funnels/results`, `funnels/save`, `funnels/delete`
  and `funnels/propose` (a draft from a description, through core's text-generation seam),
  and the `funnels.overview` / `funnels.steps` figure readers the AI insight job reads.
- **Server declarations:** the site collector's `journey` beacon, counted into
  `hosts/{hostId}/funnelJourneys`.

## What it reads, stores and sends

- `hosts/{hostId}/funnels` — the definitions. Members read; the save and delete routes write.
- `hosts/{hostId}/funnelJourneys` — one document per recorded visit: its steps in order with
  server times, where it arrived from (UTM labels or referring site), and `expiresAt`, 90
  days out. A visit is one browser tab, identified by a random id in that tab's session
  storage, and is recorded only when the site has a funnel and the visitor's consent allows
  analytics (core `site-journey.ts`). Nothing in it identifies a person.
- `hosts/{hostId}/funnelResults` — computed results, kept up to a day, expiring on their own.

Sends nothing to a third party. "Create with AI" goes through whichever plugin generates
text for the workspace, under that plugin's own rules and credits.
