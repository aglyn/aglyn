# Analytics — the GA4 event taxonomy

One taxonomy, three surfaces. This is the map; the code is
`libs/aglyn/src/lib/app-utils/analytics-events.ts`, and the event names and
their params are a TypeScript type there, so a typo is a compile error rather
than a silently-missing metric.

Written for AGL-1561. Related: AGL-1538 (the GA properties themselves),
AGL-1498 (visitor consent), AGL-1550 (why the tenant mounts sit above the
plugin gate), AGL-1559 (the property consolidation).

---

## The properties

| Property | Measurement id | Surface |
| --- | --- | --- |
| **Aglyn — Platform** (302497406) | `G-YW5PG16YTM` | **the canonical property.** All three first-party domains — `app.aglyn.com`, `aglyn.com` and `docs.aglyn.com` (AGL-1579) — via one web stream, **ID 3230351080**. Linked to Firebase project `aglyn-main` (app "Aglyn - App Console"). Live since AGL-118. Renamed from "Aglyn — Console" on consolidation. |
| Aglyn — Marketing (archived 2026-08-14, pre-consolidation) (257010770) | `G-BQ49X14QCD`, stream 2220379072 | retired 2026-08-14. **Do not delete** — it holds the only copy of its own history **and is the Analytics link for the Firebase project `aglyn-app`**. Deleting it would sever that link. Its "Prod" tag and its "traffic in past 48 hours" flag both read as more alive than they are: year to date it has **30 views / 6 users**, ~24 of them `/signin` on Vercel *preview* URLs of the console, plus one view of `/` on `aglyn.com`. `aglyn-app` is the retired marketing site's backend — see AGL-1590. |
| ~~aglyn-f375b (284263481)~~ | — | **trashed 2026-08-14** (AGL-1581). Stray property, zero data streams, no measurement id, no traffic, no Firebase project of that name, unreferenced in the monorepo. Recoverable from the GA Trash Can until **2026-09-18**; permanently gone after that. |

`GA4_MEASUREMENT_ID` / `GA4_API_SECRET` and any Measurement Protocol secret
belong to **stream 3230351080 on property 302497406** — secrets are per-stream
and do not migrate.

**One property, one stream, three domains** (AGL-1559 for two, AGL-1579 for the
third, both 2026-08-14). A single measurement id serves every surface, because
the `_gl` linker is honoured per-tag: two ids would give a visitor a fresh
`client_id` on the domain hop. Separate the surfaces in reports with the
built-in **Hostname** dimension.

**Google Signals is OFF and ads personalization is 0/307 regions on both.
Keep it that way** — the live privacy policy's flat "we do not sell or share"
denial depends on it, and the server-side sender asserts `non_personalized_ads`
per hit so a dashboard change cannot quietly opt revenue into ads.

Cross-domain measurement is configured on the tag (Contains `aglyn.com`, which
matches `app.aglyn.com` too; plus legacy `aglyn.io`), and `aglyn.com` is listed
as an **unwanted referral** — without that second half the console keeps
attributing sessions to `aglyn.com / referral` and overwrites the true source,
so the consolidation would not actually fix attribution. A journey from
`aglyn.com` to `app.aglyn.com/signup` is now one session with the original
channel retained, which is what makes "signups per channel" answerable.

**The precondition is verified; the stitching itself is not (AGL-1636).**
Same-property is the thing that has to be true before any of the above can
work, because two measurement ids would hand the visitor a fresh `client_id` on
the domain hop, and it is the thing that silently regressed once already. It
was checked live on 2026-08-14 rather than assumed: a request to `aglyn.com`
carries `gaMeasurementId":"G-YW5PG16YTM"` in the served payload — the
consolidated Platform property, not the archived `G-BQ49X14QCD` — and the
console's Firebase-injected tag uses the same id. So both ends are one property.

There is deliberately **no `linker` config in our code**, and none is needed:
`site-analytics.tsx` emits a bare `gtag('config', '<id>')` and the domain list
is delivered to the tag from the GA UI. Grepping for `linker` and concluding
cross-domain is unconfigured is the wrong inference.

What is **not** established is that a real session actually stitches, which
needs GA DebugView or a Realtime check across the hop — Zach's console, and on
the click-list. Two structural reasons it is best-effort rather than certain,
both worth knowing before reading the funnel:

- **The `_gl` decoration requires a loaded tag at click time.** On `aglyn.com`
  gtag is consent-gated and never loads for a visitor who has not granted, so
  their hop carries no linker parameter. US visitors default to an implied
  grant, so most do stitch; a declining or EU visitor does not, and cannot.
- **The tag only starts after hydration.** AGL-1538 recorded a tenant hydration
  stall of 30s+ on some pages; a CTA clicked before gtag exists is undecorated
  even for a consenting visitor. That makes hydration performance an
  *attribution* problem, not only a speed one.

**`docs.aglyn.com` needed no GA admin change, and that was verified rather than
assumed** (AGL-1579, 2026-08-14). Both halves are substring conditions that a
subdomain already satisfies: cross-domain linking is `Contains aglyn.com`, and
the unwanted-referral list is a single `Referral domain contains aglyn.com`.
Checking mattered more than it sounds — the *second* half is the one that gets
skipped, and skipping it is silent: a visitor going console → docs → console
would post a self-referral that overwrites the real acquisition source on
exactly the journeys the docs instrumentation exists to measure. Adding a
redundant `docs.aglyn.com` row would have been the other way to get this wrong.

One consequence of the cross-domain list worth knowing before reading reports:
the domains in it are **excluded from enhanced measurement's outbound-click
events**, by design. So a docs link to `app.aglyn.com` produces no `click` — it
produces a continued session, which is the better record and the whole point of
the consolidation. Only genuinely external destinations (`github.com`) raise
`click`.

---

## The event map

`Reserved` = a GA4 recommended event, spelled exactly as GA expects so the
built-in reports and funnel explorations work. `Custom` = no GA4 equivalent.

| Event | Kind | Surface | Params | GTM §6 metric it serves |
| --- | --- | --- | --- | --- |
| `sign_up` | Reserved | Console | `method` | Acquisition — signups |
| `login` | Reserved | Console | `method` | engagement / returning users |
| `generate_lead` | Reserved | Marketing | `form_name`, `form_location` | Acquisition — cost/lead, demo bookings |
| `select_content` | Reserved | Marketing | `content_type`, `content_id`, `surface` | Acquisition — CTA funnel |
| `click` | Reserved | Marketing | `link_domain`, `link_id`, `surface` | Acquisition — outbound to docs/GitHub |
| `org_created` | Custom | Console | `plan?` | Activation |
| `host_created` | Custom | Console | — | Activation |
| **`site_published`** | Custom | Console + **Server** (tenant) | `first_publish?` | **Activation — "% who publish a site"** |
| `stripe_connected` | Custom | Console | — | **Activation — "% who connect Stripe"** |
| `begin_checkout` | Reserved | Console + Tenant | `currency`, `value`, `items`, `billing_interval?` | Revenue — checkout funnel |
| `purchase` | Reserved | **Server** (ours) + Tenant storefront (the merchant's) | `transaction_id`, `currency`, `value`, `items`, `billing_interval?` | Revenue — paid conversions, ARPA, annual mix; and the merchant's own ecommerce revenue |
| `view_item` | Reserved | Tenant (storefront) | `items` | Merchant's own product funnel |
| `add_to_cart` | Reserved | Tenant (storefront) | `items` | Merchant's own product funnel |
| `aglyn_overlay` | Custom | Tenant (marketing) | `overlay_action`, `overlay_id?` | Engagement — announcement bars and popups |
| `aglyn_experiment` | Custom | Tenant (marketing) | `experiment_id`, `variant_id`, `experiment_action` | Engagement — experiment exposures/conversions |

`method` values: `password`, `google_popup`, `google_redirect`, `google_signin`
(the AGL-1497 door where "Sign in with Google" created the account and bounced
the person to `/signup`), plus `passkey` and `sso` for `login`.

`item_category` separates the two revenue lines: `subscription` and
`marketplace`. Storefront items carry none — in a MERCHANT's property a
constant category is a column with one value in it, and their real product
categories are not on the payloads the storefront builds.

`experiment_action` is `exposure` | `conversion`; `overlay_action` is the
overlay kind the beacon already reports.

### The last five raw `window.gtag` calls (AGL-1591)

Five call sites survived the AGL-1561 sweep and were converted afterwards: the
four bottom rows above, plus the tenant half of `begin_checkout`. That last one
was the one that mattered. `begin_checkout` is a taxonomy event fired from TWO
surfaces, and the storefront's raw call carried `value`/`currency` only — so a
breakdown on the event showed two populations that could not be compared, and
the storefront half was missing the `items` that GA4's ecommerce funnel is
built on. The tenant call site is the one that changed: the taxonomy already
declared `items` required and the console already satisfied it, so conforming
the console instead would have meant weakening the type to match the defect.

Both surfaces now build the payload with `buildBeginCheckoutParams`, which also
DERIVES `value` from the items unless a caller states a different one. Keys were
already settled by the type; the number was not, and it is the quieter way two
call sites of one event diverge — a wrong amount looks exactly like a right one.
A cart states its subtotal, because a coupon or gift card moves it without
moving the line prices.

**Why `aglyn_overlay` and `aglyn_experiment` are in the taxonomy** rather than
going through `trackAuthoredEvent`, despite not being GA4 recommended names: the
test is who NAMED the event, not whether GA recognizes it. A developer wrote
both names and every key on them, so they can have compile-time checking, and
the union already holds four custom names for the same reason. The escape hatch
also guarantees the opposite of what they need —
`resolveAuthoredEventName` refuses every name in the union precisely so that
"not in the taxonomy" means "authored", which is what keeps authored hits
separable in reports. Putting ours through it would break that, and would leave
`aglyn_experiment` unreserved: a hand-authored step of that name would add hits
to the counts that decide which variant ships.

**These are the merchant's numbers, not ours.** On a tenant site `gtag` is
loaded with whatever measurement id the HOST configured, so the four events
above land in the customer's property — except on `aglyn.com` itself, which is
a tenant site pointed at our own property.

### Where each one fires

| Event | Call site |
| --- | --- |
| `sign_up` | `apps/console/app/(auth)/signup/page.tsx` (password + Google popup + the `?consent=required` bounce); `apps/console/hooks/use-google-redirect-result.tsx` (mobile redirect) |
| `login` | `apps/console/app/(auth)/signin/page.tsx` (password, Google popup, passkey); `use-google-redirect-result.tsx` (mobile redirect); `apps/console/app/(auth)/sso/page.tsx` (`method: 'sso'`, both the desktop popup and the mobile redirect return — AGL-1562) |
| `select_content` | `libs/aglyn/src/lib/app-utils/analytics-link-clicks.ts`, installed by `apps/tenant/app/[host]/[[...slug]]/site-analytics.tsx` (AGL-1562) |
| `click` | the same listener |
| `generate_lead` | `libs/plugins/mui/src/lib/components/form.tsx` (the generic lead form — `/contact`); `libs/plugins/commerce/src/lib/components/newsletter-signup.tsx` (AGL-301 subscribe) |
| `org_created` | `apps/console/components/create-org-dialog.component.tsx`; `provisionSignUpOrg` in the signup page |
| `host_created` | `apps/console/components/create-host-dialog.component.tsx` |
| `site_published` | `apps/console/constants/screen-publishing.ts` (`publishScreenRoute` — the routing-map primitive every publish surface passes through) and the besigner's two publish handlers; **server-side** from `libs/tenant/runtime/…/apply-publish-schedule.ts` when a due schedule registers a NEW routing entry (AGL-1589) |
| `stripe_connected` | `libs/plugins/commerce/.../payments-settings-card.component.tsx`; `apps/console/components/org-seller-panel.component.tsx` |
| `begin_checkout` | `apps/console/app/(app)/[orgSlug]/billing/page.tsx` (plan checkout); `libs/plugins/commerce/src/lib/components/cart.tsx` (storefront cart checkout — AGL-1591) |
| `view_item` | `libs/plugins/commerce/src/lib/components/product-detail.tsx`, when the product payload resolves |
| `add_to_cart` | the same file, on a successful add |
| `aglyn_overlay` | `libs/plugins/marketing/src/lib/components/site-runtime.tsx` (`sendOverlayBeacon`) |
| `aglyn_experiment` | the same file, from the experiments runner's exposure/conversion beacon |
| `purchase` | **Ours:** `libs/tenant/data/admin/src/lib/server/ga4-measurement-protocol.ts`, called from the platform webhook's `invoice.paid` branch and from the marketplace webhook handler. **The merchant's:** `libs/plugins/commerce/src/lib/utils/use-storefront-purchase-event.ts`, mounted by `cart.tsx` and `product-detail.tsx` — the two pages Stripe returns a shopper to (AGL-1641) |

### `first_publish`, and what all four senders mean by it (AGL-1588)

The dimension was registered in GA and sent by nobody: all four
`site_published` call sites passed `{}`, so the breakdown would have been
empty forever while the doc promised it. It is now WIRED rather than dropped,
because the choice is not reversible — a publish that already happened cannot
be re-reported as a first one, and this is the difference between the GTM §6
activation metric and a publish count.

`isFirstPublishedRoute` (in `analytics-events.ts`, deliberately DOM-free so
the Measurement Protocol sender shares it) holds the single definition:

> **The host had no live route at all before this one.**

Not "first for the org": that needs a cross-host query the server path cannot
make, and the scheduled sender's client id is derived from the HOST, so an org
is not something it can see. Not "first for this screen" either — that is true
of every second page a site adds, which would make the dimension a synonym for
the event.

Every sender reads the routing map BEFORE writing to it, since a moment later
it is never empty:

| Sender | Where the map comes from |
| --- | --- |
| `publishScreenRoute` | one `getDoc` on the host, paid for deliberately — see below |
| the besigner's two handlers | the live-subscribed `routingMap`, captured at the top of the handler before the writes |
| `apply-publish-schedule.ts` | the `hostRef.get()` it already makes to decide whether to register an entry |

**Why `publishScreenRoute` pays for a read.** The alternative was threading
the map through six call sites as an optional argument, where a publish
surface that forgot it would report nothing — indistinguishable in GA from one
that answered `false`. One extra document read on a rare, deliberate,
already-multi-write action buys "no new publish button can quietly forget to
answer", which is the same argument that put the event itself in that
function.

`false` is a VALUE, not an absence: it is what makes this a breakdown rather
than a flag. `undefined` is reserved for genuinely-not-determined (the host
read failed), and the sanitizer drops it, so that hit carries no breakdown
value instead of an invented one.

**The one dishonesty.** Unpublishing every route and publishing again reports
`true` a second time; detecting that needs publish history the routing map
does not keep. Harmless for the metric it serves, since activation is read as
the share of USERS who ever sent `first_publish: true`, and a user counted
twice is still one user.

---

## Seven decisions worth knowing

### 1. `purchase` is sent from the server, everything else from the browser

A client-side `purchase` on the post-checkout return page is simpler and wrong
for money: the return page is not reliably reached (closed tab, lost signal, a
3DS interstitial), ad blockers drop it and are over-represented in a developer
audience, and `?status=success` carries **no amount and no session id** — so a
client event could not even state what was charged, and would re-fire on a
refresh.

The authoritative amount already exists server-side in the Stripe webhook. So
`purchase` goes out over the GA4 Measurement Protocol from there, using the
Stripe object id as `transaction_id` — GA de-duplicates on it, so a webhook
retry cannot inflate revenue.

`begin_checkout` stays client-side: intent genuinely is a browser event, and
losing one to an ad blocker costs a funnel step, not a dollar.

**The `client_id` catch.** The Measurement Protocol requires a `client_id` and a
server has no way to know the browser's. So the real one is captured when
checkout starts (`readGaClientId`) and carried on Stripe metadata as
`ga_client_id`. When it is missing — a renewal months later, or a customer
whose gtag never ran — the sender falls back to an id synthesized
deterministically from the Stripe customer. **The money is then right and the
channel is unknown**, and the fallback is reported in the return value so it can
be alarmed on if it becomes common.

> 🚨 **`purchase` reaches nothing today, and the reason changed.** AGL-1551 —
> the platform webhook rejecting every Stripe delivery with `400 Invalid
> signature` — is **fixed and closed** (2026-08-14), so deliveries now arrive
> and the `invoice.paid` branch does call the sender. The remaining blocker is
> entirely the environment: see *The env-var verdict* below. The sender returns
> `{ sent: false, reason: 'not-configured' }` without logging, so this failure
> is completely silent from the application side.

#### What `purchase` will report once it is on, and where it disagrees with Stripe

Worth settling before the tap opens, because GA revenue that disagrees with
Stripe is worse than no GA revenue — it gets quoted. Four known divergences,
none of them yet observable since nothing has sent:

| # | Behaviour | Effect on the number |
| --- | --- | --- |
| 1 | Subscription `value` is `amount_paid / 100` off `invoice.paid`, keyed on the **invoice id** | Correct, and includes **renewals** — GA "revenue" is billings, not new-business MRR. Do not read it as either without splitting on `billing_interval` and first-vs-repeat |
| 2 | Marketplace `value` is `amount_total / 100` — the **tax-inclusive gross** | Overstates our revenue: the ledger doc written two lines above splits `taxCents` and `transferCents`, and the seller's share is not ours. GA will not match the Stripe balance |
| 3 | `billing_interval` falls back to `'monthly'` whenever the price interval is absent or unrecognised | An annual plan whose line item does not expose `recurring.interval` reports as monthly, quietly biasing the §6 annual-mix metric toward monthly |
| 4 | Marketplace `clientId` reads `metadata.ga_client_id`, which **nothing ever writes** | Dead read. Marketplace purchases always fall back to a synthesized client id, so marketplace revenue is permanently unattributable to a session or channel |

(1) is a reporting instruction, not a defect. (2), (3) and (4) are defects and
are filed separately — see AGL-1637's child issues. (4) in particular is the
cheap one: the subscription path already captures the id via `readGaClientId`
and carries it on Stripe metadata, and the marketplace checkout simply never
learned to.

#### The storefront `purchase` is client-side, and that is the same decision, not a contradiction (AGL-1641)

Tenant storefront orders used to send no `purchase` at all, so a merchant's GA
property showed carts entering checkout and never completing — a 0% conversion
rate and zero revenue, rendered authoritatively. They now send one, from the
browser, which is the **opposite** of decision 1 above and for the same reason
decision 1 gives.

Decision 1 weighs a lost hit against the cost of losing it. For OUR revenue a
lost hit is a hole in our books, so it is worth a server sender and the
Measurement Protocol credentials it needs. For a MERCHANT's product analytics
the same loss is what every storefront on the internet already accepts, and the
server route would cost a per-host Measurement Protocol API secret — a new host
setting, a new secret to encrypt, a new support burden — because a merchant's
hits go to **their** property (`host.analytics.gaMeasurementId`), not ours.

The two objections decision 1 raises against a client `purchase` are answered
rather than ignored:

* *"the return URL carries no amount and no session id"* — it does now.
  `success_url` gained `session_id={CHECKOUT_SESSION_ID}`, and
  `/api/commerce/order-analytics` returns a PII-free projection of the order
  the webhook wrote. The Stripe session id is the bearer credential: it is
  unguessable, it is handed only to the buyer, and the lookup is scoped to the
  host that owns the order.
* *"it would re-fire on a refresh"* — `transaction_id` is that same session id,
  and GA4 de-duplicates purchases on it. A `sessionStorage` guard is the cheap
  second layer, not the guarantee.

**Whose revenue the number is.** The merchant's. This is the inverse of the
marketplace call (AGL-1639): there the property is ours and `value` is platform
net, because our fee is what Aglyn was paid. On a tenant storefront the merchant
is the seller, so Aglyn's `feeCents` is **not** subtracted — it is their cost of
sale, not a reduction in what they sold, and subtracting it would show every
merchant a revenue figure a few percent of their real one.

**The number itself** is `totalCents - taxCents`. `totalCents` is Stripe's
`amount_total` written verbatim by the webhook, so it reconciles with Stripe by
construction; `taxCents` is Stripe's `total_details.amount_tax`, excluded
because the merchant is seller of record and tax collected is held for the
state. As in AGL-1639, **no GA4 `tax` param** is sent beside an ex-tax `value`.

**No `shipping` param either**, and the reason changed under AGL-1698 without
changing the answer. It used to be a live defect: the webhook read two of
`total_details`' three siblings and skipped `amount_shipping`, so every online
order stored `shippingCents: 0` while the shipping the shopper paid sat inside
`amount_total`. That is fixed — `computeCheckoutSessionTotals` now passes it,
and the stored parts sum to the stored total. What it is **not** yet is a number
worth reporting, because no Checkout Session we create declares
`shipping_options`, so Stripe never offers a shipping choice and
`amount_shipping` is 0 on every live session today. Sending it would still
assert free shipping on every order. It becomes worth sending when shipping is
actually charged, not before.

`value` still comes off `totalCents`, and deliberately so. Deriving it from the
stored parts would have **dropped that shipping revenue entirely** — the same
failure shape as the AGL-1639 overstatement with the opposite sign. AGL-1698
makes the parts complete, so the two now agree; the reason to keep `totalCents`
is no longer that the parts are short but that `totalCents` is Stripe's own
number verbatim and reconciles by construction, while `itemsCents` is priced
from the host's product docs and a price edit mid-session would diverge.
`purchase-analytics.spec.ts` still pins the decomposition, and
`commerce-orders.spec.ts` now pins the reconciliation.

### 2. Consent-blocked means the event is gone, not queued

On tenant sites — including `aglyn.com` — the gtag script is **never loaded**
without a granting consent state (AGL-1498, enforcement at the source). So
`trackEvent` finds no `window.gtag` and drops the event.

It drops it; it does not queue it. A queue would quietly turn "we did not
track you" into "we tracked you and waited", and a replayed hit carries the
pre-consent page and timestamp into GA — the exact thing the gate exists to
prevent. `analytics-events.spec.ts` asserts that a pre-consent event does not
reappear when a later grant loads gtag.

The console has no such gate: its GA runs unconditionally, as it has since
AGL-118, and the cookie disclosure shipped in legal v3. **This change does not
alter that posture.**

> **The console DOES have a real `window.gtag` — correcting a standing piece of
> lore (AGL-1636).** Grepping `app.aglyn.com`'s HTML for a `googletagmanager`
> tag returns nothing, and that has repeatedly been read as "the console has no
> gtag, only the Firebase SDK". The first half is true and the conclusion is
> false: `getAnalytics()` **injects** the `gtag/js` script at runtime and
> assigns `window.gtag` / `window.dataLayer` itself, and the console's CSP
> (`script-src 'self' https:` — not `strict-dynamic`) permits it. So the tag is
> genuinely resident, on the same `G-YW5PG16YTM` the tenant uses.
>
> This matters in two places. `readGaClientId` on the billing page resolves a
> REAL client id rather than the permanent `null` the old reading predicted —
> which is what makes subscription revenue attributable at all. And any
> `trackEvent` that fires before the transport-registering effect commits falls
> through to `window.gtag` and lands in the right property, merely without
> `user_id` — an unattributed hit, not a dropped one.

A consequence worth stating: `generate_lead` fires on *every* tenant site, not
only `aglyn.com`, and reports into whatever measurement id **that host**
configured. A customer's contact form reports to the customer's property;
`aglyn.com`'s reports to ours. That is the intended behaviour.

### 3. No PII, enforced rather than promised

Every payload passes `sanitizeEventParams` before reaching a transport:

- an exact-key denylist drops `email`, `org_name`, `first_name`, `phone`, … —
  exact-key, because substring matching would wrongly drop the legitimate
  `form_name` / `item_name` / `link_domain`;
- any value that merely *looks like* an email drops its key entirely;
- URLs are reduced to origin + pathname, so a query string cannot smuggle a
  token or an address. The reduction runs **before** the email test, so a page
  URL with `?email=…` keeps its useful path instead of being thrown away whole;
- strings are capped at 100 characters.

`user_id` on the console is an opaque Firebase uid and is the one identifier GA
is allowed to hold. `form_name` is author-written site content, never a
submitted field value.

### 4. CTA and outbound clicks come from one delegated listener (AGL-1562)

`select_content` and `click` have no call sites, and cannot have any: the
marketing pages are authored Firestore content built by clicking, so there is
no file to add a handler to. `libs/aglyn/src/lib/app-utils/analytics-link-clicks.ts`
classifies clicks from the DOM instead, from a single capture-phase listener
on `document`.

Why a listener rather than a prop on `AppLink`, which every authored Button,
Screen Link and Image link already funnels through: rich-text anchors inside
`AglynTypography` and anything in a Custom HTML element are written with
`dangerouslySetInnerHTML` and are plain DOM anchors with no React handler at
all. Those are precisely the links an author drops into body copy — a docs
link, a GitHub link — which is the population `click` exists to count.

The rules, in order:

- a link **built to look like a button** (`.MuiButton-root`, `.MuiFab-root`,
  `role="button"`, or an explicit `data-analytics-cta`) → `select_content`
  with `content_type: 'cta'`;
- any other link to **a different hostname** → `click` with `link_domain`;
- a same-host text link → **nothing**, because its own pageview already counts
  it and an event per internal navigation just spends GA's per-session budget.

CTA wins over outbound where they overlap, which is the case that matters:
`aglyn.com`'s signup CTA points at `app.aglyn.com`, so it is both. Reported as
an outbound click it would lose the section that produced it — the whole
metric. The accepted cost is that an outbound link styled as a button (a "View
on GitHub" hero button) counts as a CTA and not as an exit.

`content_id` is `section:label`, where the section is an author-set
`data-analytics-section` if there is one, else the landmark the link sits in
(`footer`, `header`, `nav`), else nothing. **Without `data-analytics-section`
on the marketing sections, `content_id` is usually just the CTA's label** —
enough to tell "Start free" from "Choose Pro", not enough to tell two
identically-labelled buttons apart unless they are in different landmarks. GA
already knows which page it happened on, so only the within-page position is
at stake.

Nothing here re-checks consent, and that is the gate working rather than
missing: `trackEvent` reaches `window.gtag`, which on a tenant site only
exists once consent has loaded it. An ungranted visitor's clicks are
classified and then dropped.

`surface` is the one caller-supplied value — `site` from the tenant, `docs`
from the documentation app (AGL-1579), which reuses this module rather than
growing a second one. Hostname already separates the domains in GA; `surface`
separates surfaces that could share one.

### 5. A scheduled FIRST publish is an activation — and the answer changed (AGL-1589)

`applyDuePublishSchedule` runs from a cron beat and from ISR revalidation with
no browser present, so client-side GA cannot see it. AGL-1562 concluded that
nothing needed to be sent, and the reasoning was sound at the time: a due
publish wrote the version pointer and the schedule status and **never touched
`hosts/{hostId}.screens`**, the routing map that decides which paths exist. A
scheduled publish could therefore only swap which saved version an already-live
route served — a content update — and `site_published` counts a route GOING
LIVE, not a republish.

That premise was a BUG, not a design. A scheduled first publish reported
success and left the URL 404ing (AGL-1589). The executor now registers the
routing entry, so the case AGL-1562 ruled out — a first publish that is
scheduled rather than clicked — is real, and it is an activation no browser is
present to report.

So `sendGa4SitePublished` (same module as the server-side `purchase`) sends it,
and only in that case: **a due publish that registers a NEW routing entry**. A
republish still sends nothing, because it is still a content update. The client
id is derived from the HOST rather than randomly — one site is one synthetic GA
user however many of its screens go live on a timer, which is the same
inflation guard `publishScreenRoute` applies by firing only when a route goes
live.

The pinned case in `apply-publish-schedule.spec.ts` did what it was written to
do: it went red the moment the executor learned to register a route, and now
asserts the other half of the argument — that a republish reports nothing.

> **Deployment gap:** `GA4_MEASUREMENT_ID` / `GA4_API_SECRET` are not set on
> the **aglyn-tenant** Vercel project, which is where this code runs, so the
> event is a clean no-op there today. See the table below.

### 6. Authored events go through the same door, under a different name (AGL-1587)

The `trackGaEvent` action step lets a site author fire an event of their own
choosing from an interaction. Its name and its params are typed by a **site
author** in the interaction builder, not by a developer, which makes it the
least trustworthy analytics input in the repo — and until AGL-1587 it was the
one call site still writing `window.gtag` directly, with no sanitizer, no
length cap and no name check.

It cannot use `trackEvent`: the taxonomy is a closed union and an authored name
is by definition outside it. So `trackAuthoredEvent(name, params)` is the one
escape hatch, and it is deliberately the only one:

- **params pass `sanitizeEventParams` unchanged** — the same denylist, the same
  email-shaped-value scan, the same URL reduction and 100-character cap. An
  author who binds a form field into a param cannot put a customer's address in
  a GA dimension;
- **the name is normalized to GA4's rules** — lowercased, non-alphanumerics
  become underscores, must start with a letter, capped at 40 characters.
  Forgiving on purpose: `CTA Click!` reports as `cta_click` where GA would have
  dropped the hit outright, and names already live in published sites were
  never validated;
- **collisions are refused, not rewritten.** Any name in the taxonomy, any GA4
  reserved name, and the `firebase_`/`google_`/`ga_` prefixes. On a tenant site
  the authored events and ours land in the *same* property — `generate_lead`
  from the form element, `select_content`/`click` from the link listener — so
  an authored `purchase` would mix hand-authored hits into a real revenue
  number.

Refusal is also what keeps the two separable in reports: an event that is not
one of the eleven taxonomy names is, by construction, authored. Deliberately
**not** a `site_*` prefix, which would have renamed events already flowing into
customers' properties and broken every report and key-event conversion built on
the old name.

**A refused event is not silently dropped where it counts.** The runtime cannot
tell the author anything — it is executing for a *visitor* of their site, and
turning an author's config mistake into something a visitor sees would be worse
than the missing metric — so it drops the event and warns once per name in the
browser console. The author-facing half is `validateHostAction`, which refuses
to **save** a name the runtime would refuse to send. A silent drop is therefore
only possible for a step authored before AGL-1587.

Not done, and why: no cap on the *number* of authored params (GA4 ignores past
25 and there is no privacy or pollution consequence), and no normalization of
param *keys* (an invalid key costs that one param, again with no safety
consequence). Both are formatting nits on a path whose real risk was PII.

### 7. The docs site buys its instrumentation from the tag, not from our code (AGL-1579)

`docs.aglyn.com` had no analytics at all, which mattered more than a coverage
gap: there is no in-product onboarding, tour or checklist anywhere in the
console (verified in the AGL-1576 audit), so the getting-started guides *are*
the activation path. Docs drop-off **is** activation drop-off. And
`/developers/self-hosting` is quoted verbatim in the founding-customer offer,
with no way to know whether anyone read it.

The whole instrumentation is six lines of config — `gtag` on the classic preset
in `apps/docs/docusaurus.config.ts` — and the reason it is that small is worth
recording, because the obvious richer version does not build.

**`apps/docs` cannot import `libs/`.** It is a standalone Docusaurus app with
its own `node_modules` and its own React 18, deliberately isolated from the
monorepo's React 19, and it deploys as its own Vercel project (`aglyn-docs`)
with root directory `apps/docs` and **`sourceFilesOutsideRootDirectory: false`**.
Vercel therefore uploads `apps/docs` and nothing else. A relative import into
`../../libs/aglyn/...` compiles locally — Docusaurus's babel rule excludes only
`node_modules`, not paths outside the site dir — and then fails the production
build with a module-not-found. Verified against the project settings, not
guessed.

So `installLinkClickTracking({ surface: 'docs' })` (AGL-1562), which was written
generic precisely so docs could reuse it, **is not installed here.** The
alternative — a second copy of the classification rules inside `apps/docs` — is
the exact duplication that module exists to prevent, and it would drift.

That costs less than it looks, because **GA4's own enhanced measurement is on
for this stream and already sends the event we wanted**, with the same name and
the same key param: a docs click to GitHub raises `click` with
`link_domain: github.com`, `outbound: true`. What the shared listener would add
on this surface is `surface: 'docs'` and CTA classification — and the CTA half
is nearly moot here, since the selector keys on MUI classes and docs has no MUI
and no button-styled links today. To finish the job properly, flip
`sourceFilesOutsideRootDirectory` on the `aglyn-docs` Vercel project and install
the listener; do not copy the file.

**`page_view` on route changes is the load-bearing part.** Docusaurus hands over
to client-side routing after first paint, so a bare gtag snippet would count one
pageview per session and report the entire getting-started path as a single
page. The plugin's client module re-sends on `onRouteDidUpdate`, which is what
makes between-guide drop-off visible at all. Known cosmetic flaw: the
`page_title` it sends can lag one navigation behind (it defers a tick for
react-helmet and still occasionally reads the previous title). `page_location`
is always correct, so report on path, not title.

**Consent: unconditional, matching `app.aglyn.com`.** That is adopting one of
the two existing postures rather than inventing a third. `aglyn.com` is gated
only because it is served by the tenant runtime, where the gate is
host-configured machinery — a Firestore `consent.mode`, `/api/consent/region`,
and a record keyed per hostId in localStorage. None of it exists on a static
site, and localStorage is origin-scoped, so a choice made on `aglyn.com` is
unreachable from `docs.aglyn.com` anyway. The published privacy policy names
`docs.aglyn.com` in its scope clause (v1 through v4), so docs is squarely a
first-party surface under it — see the caveat in "Still outstanding" below.

Neither dev nor preview can pollute the property: the plugin returns `null`
unless `NODE_ENV === 'production'`, and `apps/docs/vercel.json` disables
non-production git deployments outright, so there are no preview URLs.

### 8. Our own traffic is stamped, not filtered by IP (AGL-1582)

At beta scale a handful of staff sessions is a large fraction of all traffic,
and **GA4 data filters are not retroactive** — a hit that ships unstamped is
unstamped forever. So the stamp has to exist before the traffic does, which is
why the code half landed ahead of the GA-side filter.

`apps/console/components/layouts/firebase-app.layout.tsx` sets
`traffic_type: 'internal'` through Firebase's **`setDefaultEventParameters`**,
and the choice of API is the load-bearing part. GA4's internal-traffic filter
matches per EVENT, and the events that would otherwise leak are precisely the
ones no call site writes: the manual `page_view`, plus the `session_start`,
`first_visit` and `user_engagement` the SDK sends on its own. A param threaded
through `trackEvent` would cover the taxonomy and miss all of those — leaving a
staff session that reports zero events but still one user and one session.
`setDefaultEventParameters` is documented to ride "every event logged from the
SDK, including automatic ones", and is the only mechanism that does.

**The predicate follows the ACTOR, not the subject**, and lives in
`apps/console/utils/internal-traffic.ts` so it can be pinned by a test:

> `staff === true` **OR** `impersonatedBy` is set.

The second half is not redundancy. Staff impersonation (AGL-246) mints a token
for the TARGET account, and the endpoint refuses to impersonate a staff account
at all — so throughout an impersonation session `claims.staff` is **false** and
the token is, by construction, a customer's. Keying on `staff` alone would have
flagged none of that traffic, and impersonation is the traffic most worth
excluding: it is us clicking through a customer's workspace generating exactly
the `host_created` / `site_published` events the activation metric is read from.
Getting it backwards is the expensive direction — keying on the subject would
exclude a real customer while including us — so `internal-traffic-flag.spec.ts`
pins the impersonation case explicitly.

Cleared explicitly on the negative branch, because the console does not remount
across a re-auth (AGL-664): a staff session followed by a customer signing in on
the same document would otherwise keep the stamp and quietly delete a real user
from every report.

**Known gap, accepted:** the first `page_view` of a cold load races the token
read and goes out unstamped — the same window in which `user_id` is also still
unset, so it is an existing condition rather than a new one. Every later hit in
the session carries the stamp.

**Still needs Zach:** the parameter does nothing until the data filter exists,
and `traffic_type` should be registered as a dimension to verify it. Create the
filter in **Testing** mode first — an Active filter permanently and
irrecoverably discards matching data. Click-list on AGL-1637.

### 9. Crashlytics cannot be integrated, and the equivalent already is

Recorded because it is asked for repeatedly. **Firebase Crashlytics has no web
SDK** — it ships for Apple, Android, Unity and Flutter only — and this repo has
no native surface to host one: no `ios/`, no `android/`, no Capacitor, React
Native, Expo or Flutter dependency anywhere. Every app here is Next.js or
Docusaurus. So this is not "not wired yet"; there is no runtime that could wire
it.

The web equivalent was built instead and **is** wired end to end (AGL-1538):
`error-beacon.ts` catches `window.onerror` / `unhandledrejection`, batches and
scrubs, and posts to first-party `/api/errors` on both the console and the
tenant; `client-error-report.ts` re-clamps server-side and writes to Cloud
Logging with the `ReportedErrorEvent` `@type`, so **Cloud Error Reporting**
ingests and groups it and a log-match alert can page. That is the same job
Crashlytics does, with zero new subprocessors.

So the three do not duplicate each other: the beacon is the **capture**, Error
Reporting is the **grouping and alerting**, and GA4 is product analytics and
should not be carrying stack traces at all. Adding a fourth vendor (Sentry) is
a subprocessor-list decision, deliberately deferred.

**Genuinely missing, by contrast:** Firebase **Performance Monitoring** is not
initialised anywhere (the package is present only because the `firebase`
umbrella ships every entry point — "in package.json" is not integration), and
there is **no Web Vitals / RUM of any kind** in any app. Those are real gaps
rather than impossible ones — filed rather than assumed worthwhile, since each
has to answer what it tells us that we cannot already see.

### 10. The console sends exactly one `page_view` per page, with a real URL (AGL-1643)

Pageviews are the denominator of nearly every rate in the funnel, so both
defects here distorted rates rather than adding a missing number — the kind of
error that survives review because the report still renders.

**`page_location` was a bare pathname.** `usePathname()` returns `/org/hosts`,
and GA4 specifies `page_location` as the full URL and **derives the Hostname
dimension from it**. Hostname is how this one property separates `aglyn.com`
from `app.aglyn.com`, so the malformed value degraded exactly the dimension the
consolidation depends on — and the landing-page and page-referrer dimensions
with it. The console now sends `window.location.href`, reduced by
`sanitizeEventParams` to origin + pathname, which also closes the gap that this
was the one console event bypassing the sanitizer. That matters here more than
anywhere: a console URL is the value most likely to carry an address, since
prefilled invite and signup links put one in the query.

**The first pageview of every load was counted twice, and this was verified
rather than inferred.** Booting Firebase Analytics issues
`gtag('config', <id>, configProperties)`, and the vendored SDK's own comment on
that call reads: *"This will trigger a page_view event unless 'send_page_view'
is set to false in configProperties"*. `getAnalytics(app)` cannot pass
`configProperties` at all — it forwards `options?.config ?? {}` — so the key was
never present, on top of the layout's own effect firing for the same page.

The suppression goes on the **SDK's** hit, and the direction is the whole
decision. The SDK fires once per document load; the layout's effect fires on
mount **and** on every `usePathname` change, so it is a superset. Suppressing
the layout's instead would have dropped every client-side navigation and halved
console pageviews, with reports that looked entirely healthy. `firebase-services.tsx`
therefore calls `initializeAnalytics(app, { config: { send_page_view: false } })`,
which is the only form that can pass the flag, and
`analytics-page-view.spec.tsx` pins it.

Attribution does not move: the surviving hit is sent from the same document at
mount, so `document.referrer` — which gtag resolves into `page_referrer` itself,
and which carries marketing traffic source into the session — is still the
external referrer at that moment.

**Still true, and deliberate:** `usePathname()` does not change on a
query-string-only navigation, so paginated and filtered views do not re-report.
An event per filter change would burn the per-session budget for a breakdown
nobody reads.

**Still open:** two raw `logEvent(analytics, 'screen_view', …)` calls live
outside the taxonomy, in `hosts/[host]/setup/page.tsx` and `manage/user/page.tsx`.
They are legal — Firebase treats `screen_view` and the `firebase_` prefix
specially — but they are the one class of console event neither the compiler nor
the sanitizer sees.

---

## GA UI configuration

Done 2026-08-14 (AGL-1559) on property 302497406:

- cross-domain measurement and the unwanted-referrals list (above);
- **custom dimensions registered**, all event-scoped: `method`, `form_name`,
  `form_location`, `billing_interval`, `first_publish`. **A param that is not
  registered is collected but not reportable** — it simply does not appear as a
  breakdown, which reads exactly like the event not carrying it. The converse
  bit it: `first_publish` was registered and sent by nothing until AGL-1588,
  which reads the same way from the report end. Registration and a producer
  are two facts, and the doc has to state both;
- privacy posture verified: Google Signals **off**, ads personalization **0 of
  307 regions**, user-provided data collection **off**, no Google Ads link,
  data retention **14 months** (event and user), email redaction **on**.
  Leave all of it that way — the live privacy policy's flat "we do not sell or
  share" denial rests on it.

### Still outstanding

0. **Register five more custom dimensions** (AGL-1562), all **event-scoped**,
   before the events are worth reporting on. Every parameter the two link
   events carry is new, and an unregistered param is collected but never
   appears as a breakdown — which reads exactly like the event not carrying
   it:

   | Dimension name | Event parameter | Why |
   | --- | --- | --- |
   | Content type | `content_type` | Always `cta` today; the axis that keeps `select_content` separable if anything else is ever selected |
   | Content id | `content_id` | `section:label` — **the CTA metric**, "which part of the page sells" |
   | Link domain | `link_domain` | Outbound destination — the GitHub/docs leading indicator |
   | Link id | `link_id` | Which outbound link, by label |
   | Surface | `surface` | `site` vs `docs` (AGL-1579); Hostname covers the domains, this covers surfaces sharing one |

   **AGL-1579 adds nothing to this list.** Docs pageviews use only built-in
   dimensions, and the `click` events it produces come from GA4's enhanced
   measurement, whose `link_domain` / `link_id` are the same two params already
   queued above. `surface` will not carry the value `docs` until the shared
   listener can actually be installed there — see decision 7.

   `login` needs nothing new — `method` is already registered, and `sso` is a
   new VALUE of it, not a new dimension.

0b. **Register three more for the site-runtime events** (AGL-1591), all
   **event-scoped**:

   | Dimension name | Event parameter | Why |
   | --- | --- | --- |
   | Experiment id | `experiment_id` | Which experiment — without it every exposure is one undifferentiated count |
   | Variant id | `variant_id` | **The axis the whole event exists for**: exposures and conversions are only meaningful split by variant |
   | Experiment action | `experiment_action` | `exposure` vs `conversion` — the numerator and the denominator |

   `overlay_action` and `overlay_id` are deliberately NOT on that list. Overlay
   stats are already reported by the first-party collector
   (`/api/analytics/collect`, which increments each overlay's own counters), so
   the GA copy is a courtesy mirror for hosts running their own property; two
   registered dimensions on ours would buy a breakdown nobody reads against a
   quota of 50. Register them if the mirror ever becomes the source.

   **The commerce events need nothing.** `view_item`, `add_to_cart` and the
   storefront `begin_checkout` carry only `items`, and `item_id` / `item_name` /
   `price` / `quantity` are GA4 BUILT-IN ecommerce dimensions — they report
   without registration, which is a large part of why these use GA's reserved
   names and its exact `items` spelling. They also land in the merchant's
   property rather than ours (see the event map), so the registration decision
   there is the merchant's to make, not one we can make for them.

1. **Mark the remaining key events.** Admin → Events → *Mark as key event*.
   `sign_up` is marked; `purchase` is a key event by GA default. GA will not let
   an event be marked **until it has been seen at least once**, so
   `generate_lead`, `site_published`, `begin_checkout` and `stripe_connected`
   have to wait for their first hit. Until marked they are ordinary events and
   appear as conversions nowhere.

   The AGL-1562 additions join that queue. `select_content` and `click` have
   never been seen by the property — they had no call sites until now — so
   neither can be marked until the first real click on a published tenant
   page; `select_content` is the one worth marking (it is the top-of-funnel
   micro-conversion), `click` is engagement and is better left ordinary.
   `login` is not new to GA, but `method: 'sso'` is a new VALUE and only
   appears in the `method` breakdown after the first enterprise sign-in.
2. **Create `GA4_API_SECRET`** — Admin → Data streams → the stream → *Measurement
   Protocol API secrets* → Create. Then set it, plus `GA4_MEASUREMENT_ID`
   (`G-YW5PG16YTM`), in the Vercel production environment (marked sensitive).
   Without both, the server-side `purchase` is a silent no-op — which is the
   correct behaviour on self-hosted deployments and in development.

   **Both projects, not one (AGL-1589).** `purchase` is sent by the console and
   by the marketplace webhook; `site_published` is sent by the TENANT, from the
   publish-schedule beat.

   #### The env-var verdict (AGL-1636, settled 2026-08-14)

   The shared-variable question the previous pass left open is now **answered**,
   via the Vercel REST API rather than `vercel env ls` — which is the whole
   point, because the CLI listing does not show team-level shared variables and
   would have let either of the facts below pass as "absent".

   | Variable | Actually exists? | Reaches a deployment? |
   | --- | --- | --- |
   | `GA4_API_SECRET` | **Yes** — a team-level *shared* variable, created 2026-08-14T06:25:59Z, all three targets | **No.** Its `projectId` array is **empty**, so it is linked to zero projects |
   | `GA4_MEASUREMENT_ID` | **No** — absent from the shared set and from both projects' own environments | No |

   A shared variable is only injected into the projects it is explicitly linked
   to, and the contrast is visible in the same API response: `STRIPE_SECRET_KEY`
   carries `projectId: [<aglyn-tenant>, <aglyn-console>]` and works, while
   `GA4_API_SECRET` carries `[]` and does not. **This is the failure mode where
   a variable that plainly exists in the dashboard still reaches nothing** — so
   "I created the secret" and "the secret is deployed" are two facts, exactly
   like registration and a producer above.

   Consequence, stated plainly: **every server-side event is dead in production
   today** — the subscription `purchase`, the marketplace `purchase`, and the
   scheduled `site_published`. Not degraded: never sent, and silently, because
   `ga4Credentials()` returns null before any log line. The fix is two console
   actions, both Zach's, in the click-list on AGL-1637.
3. 🚨 **The published privacy policy says we run no third-party analytics.**
   `apps/console/constants/legal/v4/privacy.txt`, under *"Sale"/"sharing" under
   U.S. state laws*: "We use no advertising technology and no third-party
   analytics on our websites or the console" — identical wording in v2, v3 and
   v4. GA4 is third-party analytics, and it has been live on `app.aglyn.com`
   and `aglyn.com` since AGL-118, so **the sentence is already inaccurate for
   two surfaces before AGL-1579 adds a third.** Section 4 of the same document
   takes the opposite position ("cookies and similar technologies for
   authentication, security, preferences, and analytics"), so it contradicts
   itself independently of docs. It reads like it was drafted to mean "no
   adtech", which is true, but that is not what it says. **This is a legal-copy
   decision for Zach, not an engineering one** — and it should be settled
   before the docs tag is deployed, since deploying widens an existing
   inaccuracy rather than creating one. Filed as AGL-1594. The scope clause
   itself is fine: it names `docs.aglyn.com` explicitly in every version.

   **Decided (AGL-1594, 2026-08-14).** The replacement wording is approved and
   drafted on AGL-1594: keep "no advertising technology" and keep the CCPA
   "we do not sell or share" conclusion, both of which the GA configuration
   genuinely supports, and replace only the blanket "no third-party analytics"
   with a named, accurate description of the one analytics provider we run.
   **Not yet published** — the privacy page and the Cookie Policy are besigner
   content on the live marketing site, so the correction is a publication step,
   and the hashed v4 snapshot must be re-captured *after* it, never before: a
   snapshot is evidence of what a user was shown, so writing one for text that
   is not live would be its own false record. v4 is still unpromoted, so this
   folds into the existing v4 snapshot rather than forcing a v5 and a global
   clickwrap re-acceptance.

   **The Cookie Policy contradicts itself the same way, and worse.** Live at
   `aglyn.com/legal/cookies`: §2 *Analytics / performance* correctly discloses
   Google Analytics, while §4 *Your choices* states "we do not set analytics or
   marketing cookies, so there is no non-essential category to consent to, and
   we do not show a cookie banner" — with `_ga` and `_ga_YW5PG16YTM` listed in
   that same document's own cookie table two sections above. §2 also scopes GA
   to "the console (app.aglyn.com)" alone, which understates it: one stream
   serves all three domains. The AGL-1594 prediction that the proposed
   `cookies-corrections.md` text would compound the problem is confirmed — it
   is published.

   `apps/docs/src/pages/trust.md` now lists Google Analytics in its
   subprocessor table with the configuration above (2026-08-14); it made no
   analytics claim before, so it was an omission rather than a contradiction.
4. **Enhanced measurement's Site search on docs is unverified.** Docusaurus's
   local search navigates to `/search?q=…`, and `q` is one of the query keys
   enhanced measurement watches, so `view_search_results` may already be
   arriving for free. If it is, note that **`search_term` is untyped visitor
   input** and does not pass `sanitizeEventParams` — it never touches our code.
   Confirm what it collects before registering it as a dimension.

### Environment variables

| Var | Where | Purpose | State (2026-08-14) |
| --- | --- | --- | --- |
| `GA4_MEASUREMENT_ID` | Vercel production (console **and tenant**) | Target property for server-side `purchase` and `site_published`; value is `G-YW5PG16YTM` | ❌ **does not exist** anywhere |
| `GA4_API_SECRET` | Vercel production (console **and tenant**), **sensitive** | Measurement Protocol auth | ⚠️ **exists as a shared variable, linked to ZERO projects** — reaches nothing |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | already set | Console's client-side GA + `client_id` capture | ✅ set on both projects, `G-YW5PG16YTM` |

**`vercel env ls` cannot answer this question.** It lists a project's own
variables and omits team-level shared ones, so `GA4_API_SECRET` reads as absent
there while existing in the dashboard — and reads as present in the dashboard
while reaching no deployment. The authoritative check is the REST API, on the
`projectId` array of each shared variable:

```
GET https://api.vercel.com/v2/env?teamId=<team>   →  data[].key, data[].projectId
```

A shared variable with `projectId: []` is linked to nothing. Compare against
`STRIPE_SECRET_KEY`, which lists both project ids and works.

Documented in `apps/console/.env.development.local.example`.
