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

| Property                                                               | Measurement id                    | Surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Aglyn — Platform** (302497406)                                       | `G-YW5PG16YTM`                    | **the canonical property.** All three first-party domains — `app.aglyn.com`, `aglyn.com` and `docs.aglyn.com` (AGL-1579) — via one web stream, **ID 3230351080**. Linked to Firebase project `aglyn-main` (app "Aglyn - App Console"). Live since AGL-118. Renamed from "Aglyn — Console" on consolidation.                                                                                                                                                                                                |
| Aglyn — Marketing (archived 2026-08-14, pre-consolidation) (257010770) | `G-BQ49X14QCD`, stream 2220379072 | retired 2026-08-14. **Do not delete** — it holds the only copy of its own history **and is the Analytics link for the Firebase project `aglyn-app`**. Deleting it would sever that link. Its "Prod" tag and its "traffic in past 48 hours" flag both read as more alive than they are: year to date it has **30 views / 6 users**, ~24 of them `/signin` on Vercel _preview_ URLs of the console, plus one view of `/` on `aglyn.com`. `aglyn-app` is the retired marketing site's backend — see AGL-1590. |
| ~~aglyn-f375b (284263481)~~                                            | —                                 | **trashed 2026-08-14** (AGL-1581). Stray property, zero data streams, no measurement id, no traffic, no Firebase project of that name, unreferenced in the monorepo. Recoverable from the GA Trash Can until **2026-09-18**; permanently gone after that.                                                                                                                                                                                                                                                  |

`GA4_MEASUREMENT_ID` / `GA4_API_SECRET` and any Measurement Protocol secret
belong to **stream 3230351080 on property 302497406** — secrets are per-stream
and do not migrate.

**One property, one stream, three domains** (AGL-1559 for two, AGL-1579 for the
third, both 2026-08-14). A single measurement id serves every surface, because
the `_gl` linker is honoured per-tag: two ids would give a visitor a fresh
`client_id` on the domain hop. Separate the surfaces in reports with the
built-in **Hostname** dimension.

⛔ **THE SENTENCE THAT USED TO BE HERE WAS WRONG, AND IT MISLED A WHOLE SESSION
(2026-08-25).** It read: *"Google Signals is OFF and ads personalization is 0/307
regions on both. Keep it that way — the live privacy policy's flat 'we do not
sell or share' denial depends on it."*

**The Privacy Policy has no such flat denial and never did.** Read from the
master on 2026-08-25, it says: *"We do not 'sell' personal information **for
money**. With your consent, we do **'share'** personal information for
cross-context behavioral advertising"* — it names Google and Meta, describes the
EU/UK opt-in vs. rest-of-world opt-out split, and documents "Your Privacy
Choices" and Global Privacy Control. It is a **sale** denial, not a **share**
denial. Anyone reasoning from the old sentence will conclude retargeting is
legally blocked when it is not. ⚑ Read the master, not this file's summary of it.

⛔ **AND THE REPLACEMENT SENTENCE WAS WRONG TOO.** It said Google Signals was
off and "should stay off". Both halves were wrong: read from the property's own
Data collection page on 2026-08-27 (`302497406`, toggle blue and
`aria-checked="true"`), **Google Signals is ON** and allowed in 307 of 307
regions — and it is **meant to be on**. Signals is what makes cross-device
remarketing audiences possible, which is the point of the Google Ads link, so
the advice to keep it off contradicted the advertising posture the rest of this
file describes. The lesson the block above teaches is the one this file kept
failing: ⚑ read the setting, not the note about the setting.

**Current state, verified 2026-08-27 in the GA4 admin:**

| Setting | State |
| --- | --- |
| Google Signals | **ON**, allowed in 307 of 307 regions |
| Ads personalization | **307 of 307 regions** |
| Google Ads link | account `841-500-9958`, **Personalized Advertising ON** |
| Granular location and device data | **ON** |
| User-provided data collection | **ON**, auto-detection ON, receiving on 0 of 1 streams |
| Data retention | 14 months, event and user, reset on new activity |

Every row is intended, and the *published* subprocessor and cookie disclosures
describe them. Signals is cross-device identity built on signed-in Google users
— materially more than cookie retargeting — and that reach is the reason it is
on: audiences built from it are what the Google Ads link exports.

⚠️ **Turning any of these off is a legal edit, not just a settings change.** The
Subprocessors and Cookie Policy masters state what this table says; flipping a
toggle without correcting them leaves a published document describing tracking
that no longer happens, which is the same defect as the one that had them
describing tracking that did.

The server-side sender still asserts `non_personalized_ads: true` per hit
(`ga4-measurement-protocol.ts`), which is a per-event flag and does not depend
on any of the property settings above.

**The AGL-1559 posture line "no Google Ads link" expired on 2026-08-20.** GA4
audiences export to Google Ads, which is what makes Google remarketing possible
at all, and both legal masters describe it.

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

✅ **The `_gl` decoration itself is now PROVEN on the wire (2026-08-24).** A real
mouse click on the `/pricing` "Get started" CTA rewrote the anchor from
`https://app.aglyn.com/signup` to the same URL carrying `_gl=1*…*_ga*…*_ga_YW5PG16YTM*…`
— the client id and the session state, crossing the hop. The probe recorded the
href at **both** `mousedown` (undecorated) and `click` (decorated), so it is not
a green that could not have gone red: gtag decorates in its own click handler,
and the mousedown reading is the built-in negative control. The old note here —
"absence of `_gl=` on the landed URL is the tell" — is still true but is no
longer the only evidence available.

⚠️ **A landing route that redirects will strip it.** Measured in the same pass:
clicking the same CTA while signed in lands on `https://app.aglyn.com/` with no
`_gl`, because `/signup` bounces an authenticated user and the redirect drops
the query string. A logged-out visitor — the only one whose stitch matters —
renders `/signup` directly and the parameter is consumed. Do not read a bare
landed URL on a signed-in staff browser as a broken linker.

What is **still not** established is that GA4 then reports it as one session with
the original source retained, which needs DebugView or Realtime across the hop —
the console, and on the click-list. Two structural reasons it is best-effort
rather than certain, both worth knowing before reading the funnel:

- **The `_gl` decoration requires a loaded tag at click time.** On `aglyn.com`
  gtag is consent-gated and never loads for a visitor who has not granted, so
  their hop carries no linker parameter. US visitors default to an implied
  grant, so most do stitch; a declining or EU visitor does not, and cannot.
- **The tag only starts after hydration.** AGL-1538 recorded a tenant hydration
  stall of 30s+ on some pages; a CTA clicked before gtag exists is undecorated
  even for a consenting visitor. That makes hydration performance an
  _attribution_ problem, not only a speed one.

**`docs.aglyn.com` needed no GA admin change, and that was verified rather than
assumed** (AGL-1579, 2026-08-14). Both halves are substring conditions that a
subdomain already satisfies: cross-domain linking is `Contains aglyn.com`, and
the unwanted-referral list is a single `Referral domain contains aglyn.com`.
Checking mattered more than it sounds — the _second_ half is the one that gets
skipped, and skipping it is silent: a visitor going console → docs → console
would post a self-referral that overwrites the real acquisition source on
exactly the journeys the docs instrumentation exists to measure. Adding a
redundant `docs.aglyn.com` row would have been the other way to get this wrong.

⛔ **`stripe.com` IS NOT ON THE UNWANTED-REFERRAL LIST, AND CHECKOUT LEAVES THE
SITE.** Found 2026-08-25. The list is a single `Referral domain contains
aglyn.com`, which covers every first-party subdomain and nothing else. But
embedded checkout (`release_native_checkout`) is **`{"enabled": false,
"rolloutPercent": 0}` in LIVE Remote Config with no conditional overrides** — so
both the storefront cart and the console's own plan purchase still redirect to
**`checkout.stripe.com`** and come back.

That return is a cross-domain referral. GA4 starts a **new session with
source/medium `stripe.com / referral`**, which overwrites the acquisition source
— so the `purchase` key event, and therefore the Google Ads `purchase`
conversion imported from it, lands on `stripe.com / referral` instead of the ad
click that paid for it. **Every paid conversion is misattributed, and the
symptom is a campaign that looks like it produced no revenue.**

It would have bitten on **2026-09-01**, when commerce opens and `purchase` first
carries money.

✅ **FIXED 2026-08-25** — `Referral domain contains stripe.com` now sits beside
`aglyn.com` in the unwanted-referral list, and the panel was re-opened after
saving to confirm it stuck. ⛔ **If anyone ever "tidies" that list, the bug comes
straight back, and it is invisible** until someone asks why paid campaigns show
no revenue.

⚑ The panel is a cross-origin iframe inside GA4 that swallows agent clicks — but
the same tag opens **top-level** at `tagmanager.google.com` → **Google tags** tab
→ the tag by id, where everything works normally. Tracked on AGL-2193.

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

| Event                          | Kind            | Surface                                                | Params                                                                                    | GTM §6 metric it serves                                                                              |
| ------------------------------ | --------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `sign_up`                      | Reserved        | Console                                                | `method`                                                                                  | Acquisition — signups                                                                                |
| `login`                        | Reserved        | Console                                                | `method`                                                                                  | engagement / returning users                                                                         |
| `generate_lead`                | Reserved        | Marketing                                              | `form_name`, `form_location`                                                              | Acquisition — cost/lead, demo bookings                                                               |
| `select_content`               | Reserved        | Marketing                                              | `content_type`, `content_id`, `surface`                                                   | Acquisition — CTA funnel                                                                             |
| `click`                        | Reserved        | Marketing                                              | `link_domain`, `link_id`, `surface`                                                       | Acquisition — outbound to docs/GitHub                                                                |
| `org_created`                  | Custom          | Console                                                | `plan?`                                                                                   | Activation                                                                                           |
| `host_created`                 | Custom          | Console                                                | —                                                                                         | Activation                                                                                           |
| **`site_published`**           | Custom          | Console + **Server** (tenant)                          | `first_publish?`                                                                          | **Activation — "% who publish a site"**                                                              |
| `stripe_connected`             | Custom          | Console                                                | —                                                                                         | **Activation — "% who connect Stripe"**                                                              |
| `begin_checkout`               | Reserved        | Console + Tenant                                       | `currency`, `value`, `items`, `billing_interval?`                                         | Revenue — checkout funnel                                                                            |
| `purchase`                     | Reserved        | **Server** (ours) + Tenant storefront **and bookings** (the merchant's) | `transaction_id`, `currency`, `value`, `items`, `billing_interval?`, `shipping?`          | Revenue — paid conversions, ARPA, annual mix; and the merchant's own ecommerce **and service** revenue |
| `view_item`                    | Reserved        | Tenant (storefront)                                    | `items`                                                                                   | Merchant's own product funnel                                                                        |
| `add_to_cart`                  | Reserved        | Tenant (storefront)                                    | `items`                                                                                   | Merchant's own product funnel                                                                        |
| `aglyn_overlay`                | Custom          | Tenant (marketing)                                     | `overlay_action`, `overlay_id?`                                                           | Engagement — announcement bars and popups                                                            |
| `aglyn_experiment`             | Custom          | Tenant (marketing)                                     | `experiment_id`, `variant_id`, `experiment_action`                                        | Engagement — experiment exposures/conversions                                                        |
| `refund`                       | Reserved        | **Server** (AGL-1850)                                  | `transaction_id` (the ORIGINAL purchase's), `currency`, `value`                           | Revenue — nets refunded revenue against `purchase`; without it GA can only ever drift UP from Stripe |
| `subscription_cancelled`       | Custom          | **Server** (AGL-1851)                                  | `plan` (the tier being LEFT), `billing_interval?`, `tenure_days?`                         | Churn rate, plan-tier churn mix, tenure at cancellation                                              |
| `churn_survey_submitted`       | Custom          | Console (AGL-1865)                                     | `reason` (closed set), `surface`, `plan?`                                                 | **Retention — why people leave, broken down by tier**                                                |
| `downsell_accepted`            | Custom          | Console (AGL-1865)                                     | `from_plan`, `to_plan`, `surface`                                                         | Retention — saves by downgrade, and what they cost                                                   |
| `winback_discount_accepted`    | Custom          | Console (AGL-1865)                                     | `percent_off`, `duration_months`, `surface`, `plan?`                                      | Retention — saves by discount, and what they cost                                                    |
| `cancellation_completed`       | Custom          | Console (AGL-1865)                                     | `surface`, `funnel_completed`, `plan?`                                                    | Retention — the funnel's denominator                                                                 |
| `plan_downgrade_scheduled`     | Custom          | Console (AGL-2235)                                     | `from_plan`, `to_plan`, `interval`, `effective_at?`                                       | Retention — downgrades taken from the plan grid, and the gap between decision and effect             |
| `plan_upgraded`                | Custom          | Console (AGL-2235)                                     | `from_plan`, `to_plan`, `interval`                                                        | Revenue — expansion from EXISTING subscribers, which `purchase` never saw                            |
| `assistant_message_sent`       | Custom          | Console (AGL-1860)                                     | `tier`, `grounded`                                                                        | Assist usage, and the docs-gap signal ungrounded questions carry                                     |
| `assistant_feedback`           | Custom          | Console (AGL-1860)                                     | `feedback`                                                                                | Assist answer quality, explicitly rated                                                              |
| `assistant_proposal_shown`     | Custom          | Console (AGL-1988)                                     | `action`                                                                                  | Is the confirm gate a real choice, or a speed bump? — the denominator                                |
| `assistant_proposal_confirmed` | Custom          | Console (AGL-1988)                                     | `action`                                                                                  | ...and the numerator; a ratio near 1 means the card is not being read                                |
| `LCP` / `CLS` / `INP` / `TTFB` | web.dev pattern | Console + Tenant (AGL-1642)                            | `value` (=delta), `metric_id`, `metric_value`, `metric_delta`, `metric_rating`, `surface` | Real-user performance; the hydration-stall attribution question                                      |

`method` values: `password`, `google_popup`, `google_redirect`, `google_signin`
(the AGL-1497 door where "Sign in with Google" created the account and bounced
the person to `/signup`), plus `passkey` and `sso` for `login`.

`item_category` separates the THREE revenue lines in OUR property:
`subscription`, `marketplace` and `booking` (AGL-2481). Storefront and booking
items in a MERCHANT's property carry none — there a constant category is a
column with one value in it, and their real product/service categories are not
on the payloads the tenant builds. A merchant running both plugins would
otherwise get a half-populated dimension: products with no category, bookings
with one, which GA cannot distinguish from missing data.

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

| Event              | Call site                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sign_up`          | `apps/console/app/(auth)/signup/page.tsx` (password + Google popup + the `?consent=required` bounce); `apps/console/hooks/use-google-redirect-result.tsx` (mobile redirect)                                                                                                                                                                                                         |
| `login`            | `apps/console/app/(auth)/signin/page.tsx` (password, Google popup, passkey); `use-google-redirect-result.tsx` (mobile redirect); `apps/console/app/(auth)/sso/page.tsx` (`method: 'sso'`, both the desktop popup and the mobile redirect return — AGL-1562)                                                                                                                         |
| `select_content`   | `libs/aglyn/src/lib/app-utils/analytics-link-clicks.ts`, installed by `apps/tenant/app/[host]/[[...slug]]/site-analytics.tsx` (AGL-1562)                                                                                                                                                                                                                                            |
| `click`            | the same listener                                                                                                                                                                                                                                                                                                                                                                   |
| `generate_lead`    | `libs/plugins/mui/src/lib/components/form.tsx` (the generic lead form — `/contact`); `libs/plugins/commerce/src/lib/components/newsletter-signup.tsx` (AGL-301 subscribe)                                                                                                                                                                                                           |
| `org_created`      | `apps/console/components/create-org-dialog.component.tsx`; `provisionSignUpOrg` in the signup page                                                                                                                                                                                                                                                                                  |
| `host_created`     | `apps/console/components/create-host-dialog.component.tsx`                                                                                                                                                                                                                                                                                                                          |
| `site_published`   | `apps/console/constants/screen-publishing.ts` (`publishScreenRoute` — the routing-map primitive every publish surface passes through) and the besigner's two publish handlers; **server-side** from `libs/tenant/runtime/…/apply-publish-schedule.ts` when a due schedule registers a NEW routing entry (AGL-1589)                                                                  |
| `stripe_connected` | `libs/plugins/commerce/.../payments-settings-card.component.tsx`; `apps/console/components/org-seller-panel.component.tsx`; **server-side** from `libs/tenant/data/admin/…/connect-account-status.ts` when `account.updated` is what first flips `stripeChargesEnabled` on (AGL-1580). Both browser emitters gate on the profile still reading "not connected" at click time, and the AGL-1997 webhook lands while the merchant is still on Stripe's hosted onboarding — so on a deployment that HAS a Connect webhook destination the browser guard is already shut by the time they return, and this was the reason the event had never been seen. The two guards read the same stored flag from opposite sides, so exactly one of them can be open per account                                                                                                                                                                                                                                                          |
| `begin_checkout`   | `apps/console/app/(app)/[orgSlug]/billing/page.tsx` (plan checkout); `libs/plugins/commerce/src/lib/components/cart.tsx` (storefront cart checkout — AGL-1591)                                                                                                                                                                                                                      |
| `view_item`        | `libs/plugins/commerce/src/lib/components/product-detail.tsx`, when the product payload resolves                                                                                                                                                                                                                                                                                    |
| `add_to_cart`      | the same file, on a successful add                                                                                                                                                                                                                                                                                                                                                  |
| `aglyn_overlay`    | `libs/plugins/marketing/src/lib/components/site-runtime.tsx` (`sendOverlayBeacon`)                                                                                                                                                                                                                                                                                                  |
| `aglyn_experiment` | the same file, from the experiments runner's exposure/conversion beacon                                                                                                                                                                                                                                                                                                             |
| `purchase`         | **Ours:** `libs/tenant/data/admin/src/lib/server/ga4-measurement-protocol.ts`, called from the platform webhook's `invoice.paid` branch, from the marketplace webhook handler, and from the bookings webhook handler (AGL-2481). **The merchant's:** `libs/plugins/commerce/src/lib/utils/use-storefront-purchase-event.ts`, mounted by `cart.tsx` and `product-detail.tsx`; and `libs/plugins/bookings/src/lib/utils/use-booking-purchase-event.ts`, mounted by `booking.tsx` — the pages Stripe returns a buyer to (AGL-1641/AGL-2481) |

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

| Sender                      | Where the map comes from                                                               |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `publishScreenRoute`        | one `getDoc` on the host, paid for deliberately — see below                            |
| the besigner's two handlers | the live-subscribed `routingMap`, captured at the top of the handler before the writes |
| `apply-publish-schedule.ts` | the `hostRef.get()` it already makes to decide whether to register an entry            |

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

## The 2026-08-17 coverage pass (AGL-1636 sweep), in brief

Six additions in one pass, each with its own spec and Linear issue; the
decisions in full live on the issues.

- **Real-user Core Web Vitals (AGL-1642)** — `web-vitals` (already a
  transitive dep of `@firebase/performance`; 2.6KB gz as a lazy chunk) →
  GA4 events in web.dev's exact shape, from
  `libs/aglyn/src/lib/app-utils/web-vitals-rum.ts`. Delivery is
  `window.gtag` on both surfaces, so the tenant consent gate stays
  structural: no grant, no tag, no hit. Metrics that report before the
  late-loading tag are held in memory ~60s and flushed when it arrives; a
  visitor whose tag never appears produces nothing — the hold is NOT the
  forbidden pre-consent queue (`web-vitals-rum.spec.ts` pins both halves).
  Console mount: `WebVitalsReporter` in the root layout, the ErrorBeacon
  shape. The AGL-1582 `traffic_type` stamp rides these hits — Firebase's
  `setDefaultEventParameters` is a global `gtag('set')`, verified against
  the SDK's `wrapGtag`.
- **`refund` (AGL-1850)** — subscription refunds from the platform webhook's
  `charge.refunded` (charge must carry an invoice AND resolve through the
  `stripeCustomers` index); `platformRevenue/{invoiceId}` carries a running
  `refundedCents` so the CUMULATIVE `amount_refunded` becomes a delta.
  Marketplace full refunds reverse at **platform net** off the ledger split,
  keyed by the session id; `refundedAt` doubles as the redelivery guard.
- **`subscription_cancelled` (AGL-1851)** — churn, server-side (no browser
  is present when a subscription ends). Reports the plan being LEFT, never
  the `free` the org mirror writes — the assembly spec pins that exact trap.
- **Retention funnel (AGL-1865)** — `churn_survey_submitted`,
  `downsell_accepted`, `winback_discount_accepted`, `cancellation_completed`,
  all client-side from `retention-funnel.dialog.tsx`, under one of two
  `surface` values: `subscription_cancel` or `account_delete`. The funnel's
  conversion rate is `downsell_accepted` + `winback_discount_accepted` over
  `churn_survey_submitted`; `cancellation_completed` is the departures that
  got all the way out.
  - **`cancellation_completed` is NOT `subscription_cancelled`.** They count
    different things at different times and must never be summed. The first
    is client-side at the moment the customer confirms; the second is
    server-side from the webhook when the subscription actually ends — which
    for an end-of-cycle cancel is up to a month later, and which also fires
    for departures that never touched the funnel at all (Stripe dashboard,
    support ops, dunning exhaustion). `subscription_cancelled` is the churn
    number; `cancellation_completed` is the funnel's exit count.
  - `funnel_completed` on `cancellation_completed` mirrors the inverse of the
    `funnelSkipped` marker the cancel/delete routes write to
    `orgs/{orgId}/retention`, so GA and Firestore cannot disagree about how
    many departures were ever surveyed. A survey that failed to store reports
    `false` rather than going silent.
  - `winback_discount_accepted` reports the SERVER's minted terms, not the
    constants the dialog was shown — the margin question ("what did this save
    cost?") is answered wrong by anything else.
- **Plan changes from the grid (AGL-2235)** — `plan_downgrade_scheduled` and
  `plan_upgraded`, client-side from the billing page's plan grid. The four
  retention events above fire from the funnel dialog and from NOWHERE else, so
  the identical move made by clicking Downgrade on a plan card was counted by
  nothing: "how many orgs moved down" was unanswerable, and
  `downsell_accepted` undercounted by exactly the share that took the direct
  route while reading like a total.
  - **`plan_downgrade_scheduled` is not `downsell_accepted`.** The first is
    every downgrade; the second is only the downgrades the cancel funnel
    saved. `downsell_accepted` over `plan_downgrade_scheduled` is the share of
    downgrades that were RETENTION saves — sum them and you double-count the
    funnel's own.
  - `effective_at` is the period end Stripe scheduled, not the click. A
    scheduled downgrade is not a completed one, and the gap — up to a full
    cycle — is the window in which "keep my plan" can still save the org.
  - `plan_upgraded`, never `app_upgrade`: that name is GA4-reserved and the
    hit would be DROPPED. `purchase` covers only the Checkout path, so before
    this, expansion from customers who already had a subscription was dark.
  - Both fire from the server's answer, after the switch is confirmed — a
    refused or declined switch reports nothing.
- **`org_plan` / `org_role` user properties (AGL-1852)** — the active
  workspace's tier and role, read through `useOrgPlans` (enterprise
  override, no-field-means-free). `buildOrgUserProperties` owns the clearing
  rule: every unknown is an explicit null, because GA user properties
  persist and the console does not remount across re-auth.
- **`content_group` (AGL-1857)** — `console` on the `initializeAnalytics`
  config, `marketing` on `aglyn.com`'s own tag only (discriminated by the
  platform measurement id — a customer's property gets no group of ours),
  `docs` via a head `gtag('set')` that covers route-change pageviews
  (initial hit best-effort; the built HTML renders the set after the
  preset's config). Built-in Content group dimension — no registration.
- **CTA tier qualification (AGL-1858)** — a CTA whose destination href
  carries `?plan=` reports `content_id` as `label:plan=<tier>`, because five
  of the eight live pricing tier CTAs are labelled Choose/CHOOSE with no
  authored section. ONLY the `plan` key is read; the spec pins that an email
  or token in the same query never reaches the dimension. The authored
  `data-analytics-section` half is a besigner content edit (click-list).

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

> ✅ **`purchase` reaches GA4. The blocker moved twice and is now gone**
> (AGL-2327). AGL-1551 — the platform webhook rejecting every Stripe delivery
> with `400 Invalid signature` — was fixed and closed 2026-08-14. The env-var
> blocker that replaced it was fixed **2026-08-17 12:15 UTC**, when
> `GA4_MEASUREMENT_ID` and `GA4_API_SECRET` landed on all three production
> projects (see _Environment variables_).
>
> ⚠️ **Do not quote the paragraph this replaced.** It said "`purchase` reaches
> nothing today", and it stayed on the page after it stopped being true — a
> 2026-08-19 smoke pass read it and concluded every server-side event was dead
> in production, which was wrong and would have been acted on.
>
> The silence property still holds and is still the real hazard: the sender
> returns `{ sent: false, reason: 'not-configured' }` **without logging**, so a
> configuration regression is invisible from the application side. That is why
> the verdict has to be re-derived from a deployment's own env key list rather
> than remembered from this document.

#### What `purchase` will report once it is on, and where it disagrees with Stripe

Worth settling before the tap opens, because GA revenue that disagrees with
Stripe is worse than no GA revenue — it gets quoted. Four known divergences,
none of them yet observable since nothing has sent:

| #   | Behaviour                                                                                          | Effect on the number                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Subscription `value` is `amount_paid / 100` off `invoice.paid`, keyed on the **invoice id**        | Correct, and includes **renewals** — GA "revenue" is billings, not new-business MRR. Do not read it as either without splitting on `billing_interval` and first-vs-repeat      |
| 2   | Marketplace `value` is `amount_total / 100` — the **tax-inclusive gross**                          | Overstates our revenue: the ledger doc written two lines above splits `taxCents` and `transferCents`, and the seller's share is not ours. GA will not match the Stripe balance |
| 3   | `billing_interval` falls back to `'monthly'` whenever the price interval is absent or unrecognised | An annual plan whose line item does not expose `recurring.interval` reports as monthly, quietly biasing the §6 annual-mix metric toward monthly                                |
| 4   | ~~Marketplace `clientId` reads `metadata.ga_client_id`, which nothing ever writes~~ — **FIXED**    | The marketplace checkout now captures the id with `readGaClientId` and writes `metadata[ga_client_id]` (`libs/plugins/marketplace/src/lib/server/checkout.ts`), so a marketplace sale joins the session that produced it. Kept here struck through, not deleted, because the un-fixed version was quoted as current state after the fix landed |

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

- _"the return URL carries no amount and no session id"_ — it does now.
  `success_url` gained `session_id={CHECKOUT_SESSION_ID}`, and
  `/api/commerce/order-analytics` returns a PII-free projection of the order
  the webhook wrote. The Stripe session id is the bearer credential: it is
  unguessable, it is handed only to the buyer, and the lookup is scoped to the
  host that owns the order.
- _"it would re-fire on a refresh"_ — `transaction_id` is a deterministic id
  for the money that moved (that same session id for a one-time order; the
  opening **invoice** id for a subscription, see below), and GA4 de-duplicates
  purchases on it. A `sessionStorage` guard is the cheap second layer, not the
  guarantee.

**Whose revenue the number is.** The merchant's. This is the inverse of the
marketplace call (AGL-1639): there the property is ours and `value` is platform
net, because our fee is what Aglyn was paid. On a tenant storefront the merchant
is the seller, so Aglyn's `feeCents` is **not** subtracted — it is their cost of
sale, not a reduction in what they sold, and subtracting it would show every
merchant a revenue figure a few percent of their real one.

**The number itself** is `totalCents - taxCents`. `totalCents` is Stripe's
`amount_total` written verbatim by the webhook, so it reconciles with Stripe by
construction; `taxCents` is the tax the webhook stored, excluded because tax
collected is money held for a taxing authority rather than sales revenue —
by Aglyn where Terms §10.7 gives it a facilitator collection obligation
(AGL-1956), by the merchant where the rate was their own. As in
AGL-1639, **no GA4 `tax` param** is sent beside an ex-tax `value`.

`taxCents` was described here as simply `total_details.amount_tax`, and on the
cart path it is. On the **buy-now** path it was not, and the difference was a
live AGL-1639-shaped overstatement (AGL-1711). `checkout.ts` sends manual
destination tax to Stripe as an ordinary `line_items[1]` product line, so
`amount_tax` is 0 while the tax sits inside `amount_total`; the webhook then
stored `taxCents: 0`, and this `value` — `totalCents - 0` — reported
**tax-inclusive gross** into the merchant's own GA4 property on every taxed
buy-now sale. The same commit fixed the two other components the event reads:
`items[].quantity` was hardcoded to 1 regardless of how many units were bought,
and `items[].price` was the whole session total rather than the unit price, so
a 3 × $100 purchase reported as one $300 unit. `computeBuyNowOrder` now
composes `taxCents` from `amount_tax` plus the line-item tax carried in the
session metadata, and the quantity and unit price from the metadata too — so
`value`, `price` and `quantity` are all right without this event changing at
all. It reads stored fields; the fix belonged under it.

**A `shipping` param IS sent** (AGL-1722), and the asymmetry with `tax` above is
deliberate. Do not make the two consistent with each other in either direction.
`shipping` is a **component of the `value`** reported beside it — `value` is
`totalCents - taxCents`, and the shipping the shopper paid is inside that
number — so the param decomposes the value rather than contradicting it, and a
merchant reads "of the $105 you sold, $10 was shipping" with nothing counted
twice. `tax` is the opposite: `value` already excludes it, so a `tax` beside it
would assert a relationship that does not hold and invite the subtraction that
removes tax a second time.

It took three changes to become sendable, and the reason for withholding it
expired twice along the way. It began as a live defect: the webhook read two of
`total_details`' three siblings and skipped `amount_shipping`, so every online
order stored `shippingCents: 0` while the shipping the shopper paid sat inside
`amount_total` — sending the param then would have asserted **free shipping on
every order**. AGL-1698 fixed the storage: `computeCheckoutSessionTotals` passes
it and the stored parts sum to the stored total. It stayed unsent because the
figure was still structurally zero — no Checkout Session we created declared
`shipping_options`, so Stripe never offered a shipping choice.

AGL-1707 closed that: `cart-checkout.ts` declares the merchant's configured
zones and rates as `shipping_options`, so `amount_shipping` is a real number on
any cart session for a merchant who set shipping up. It was the RIGHT number
only once AGL-1721 followed: AGL-1707 declared every zone's rates on a session
that accepted an address anywhere, and Stripe charges whichever rate the
shopper picks without comparing it to the address, so a shopper could report a
domestic rate on an international parcel. `planCheckoutShipping` now pairs the
rates with the countries the session will accept, which means `amount_shipping`
is a rate that actually applies to the `shipping_details` sitting beside it —
worth knowing before the two are ever reconciled. What was left was plumbing,
and AGL-1722 built it — `shippingCents` rides `StorefrontPurchaseSource` from
the stored order out to the wire shape, and `buildStorefrontPurchaseParams`
emits `shipping: toAmount(shippingCents)`.

The param is **always sent, including as 0**. A download ships nothing, a
merchant who saved no rates charges nothing, and POS and draft orders resolve no
shipping; on all of those `shipping: 0` is a true statement about that order
rather than the old structural zero, and omitting it would leave the merchant's
shipping column sparse for a reason GA cannot tell apart from "not tracked".
Orders written before AGL-1698 do report `shipping: 0` where the shopper in fact
paid shipping — unrecoverable, and it does not touch `value`, which comes off
`totalCents` for exactly this kind of reason.

The **shipping amount** crosses the wire; the **shipping address** never does.
They sit next to each other on the stored order and `order-analytics.spec.ts`
pins the projection's key list exhaustively so widening it stays a decision.

AGL-1720 then closed the same gap on buy-now, which had declared neither
`shipping_address_collection` nor `shipping_options` and so charged nothing
however many rates the merchant saved — the same merchant and product billing
two different totals depending on which button the shopper pressed. Buy-now
resolves through the same AGL-1707 translation, narrowed to physical one-time
sales: a digital or service product ships nothing, and a subscription session
is excluded on a product question rather than a recording gap. The gap itself
is closed — AGL-1732 gave the initial charge a home on the subscription
document, `amount_shipping` included, and AGL-1743 records every paid invoice
after it, reading `shipping_cost.amount_total` (an invoice has no
`total_details`). What is unanswered is whether a rate editor written for
one-time orders should express a rate re-charged every cycle at all, given
Stripe bills a subscription's one-time line items on the first invoice only.
So `amount_shipping` is now a real number on both storefront paths for a
merchant who set shipping up, and structurally 0 only for one who did not.
Draft orders and POS still resolve no shipping. Both paths, and the subscription
invoice path, reach GA through the same reducer: `toStorefrontPurchaseSource`
reads `totals.shippingCents` whatever wrote it — `total_details.amount_shipping`
on a session, `shipping_cost.amount_total` on an invoice, which has no
`total_details`.

`value` still comes off `totalCents`, and deliberately so. Deriving it from the
stored parts would have **dropped that shipping revenue entirely** — the same
failure shape as the AGL-1639 overstatement with the opposite sign. AGL-1698
makes the parts complete, so the two now agree; the reason to keep `totalCents`
is no longer that the parts are short but that `totalCents` is Stripe's own
number verbatim and reconciles by construction, while `itemsCents` is priced
from the host's product docs and a price edit mid-session would diverge.
`purchase-analytics.spec.ts` still pins the decomposition, and
`commerce-orders.spec.ts` now pins the reconciliation.

#### A storefront SUBSCRIPTION sale reports its first payment, once (AGL-1746)

A subscription writes no order document — deliberately, on the evidence
gathered in AGL-1732 — so `/api/commerce/order-analytics` looked up an order
that would never exist and 404'd forever. The merchant's property therefore
showed traffic and `begin_checkout` on the subscription product and then no
`purchase` at all, which does not read as an unmeasured path: it reads as a
**100% checkout abandonment rate**, authoritatively.

The route now falls back from the missing order to the subscription that
session created (`subscriptions` where `checkoutSessionId ==` the session id)
and answers from that subscription's **opening invoice** — the
`subscription_create` one AGL-1743 records beneath it. Both reads are
single-field equality queries with `limit(1)`, served by Firestore's automatic
single-field indexes; there is no composite index here to create.

**The invoice, not the subscription document, because of the id.** The invoice
id is Stripe's own id for the money that moved, it is unique per cycle, and it
is stable — the same sale resolves to the same invoice on every poll, so a
shopper who refreshes the return page cannot produce a second `purchase` under
a different id. Its `lineItems` and `totals` were built by
`computeSubscriptionInvoiceOrder`, which is the helper that knows **an invoice
is not a Checkout Session**: AGL-1743 found invoices carry no `total_details`
at all, that tax is `tax` or `total_taxes` by API version, discount is
`total_discount_amounts[]`, and the fee is a real `application_fee_amount`.
Reading the stored figures inherits all of that rather than re-deriving it
against the wrong shape.

`value` needs no special case: it flows through the same
`toStorefrontPurchaseSource` / `buildStorefrontPurchaseParams` pair, so the
storefront rule above applies unchanged — the merchant is the seller, Aglyn's
fee is **not** subtracted, tax is excluded, and no GA4 `tax` param is sent.

**A trial answers 409, not a $0 purchase.** Nothing was charged, so there is no
revenue to report, and the refusal is terminal rather than retryable because it
will never become true for that invoice.

**Renewals send nothing, and could not.** On the merits, `purchase` is what
GA4's acquisition and ROAS reporting is terminated by, so firing one per cycle
would credit a single acquisition to its campaign once a month and inflate
return on ad spend by the subscriber's whole lifetime. But it does not come
down to the merits: this sender is the shopper's browser, and a renewal months
later has no browser in it. Reaching the merchant's property server-side would
need a per-host Measurement Protocol API secret this product does not collect
and has nowhere to store — the same conclusion decision 1 reached from the
other direction. `ga4-measurement-protocol.ts` is not that channel: its single
`GA4_MEASUREMENT_ID`/`GA4_API_SECRET` pair is **ours**, reporting our revenue.
Row 1 of the decision table above still holds and is about that property, not
this one. So the storefront reports the first payment and stops — mirroring
AGL-1743's own refusal to re-count the opening invoice where the checkout
session had already counted it.

`order-analytics.spec.ts` pins each of these: the transaction id is the invoice
id and not the session id, a renewal invoice is never what answers, the two
webhook races stay retryable, and the projection still withholds the
subscriber's email, name and our fee.

#### A paid BOOKING reports twice, to two properties, at two different figures (AGL-2481)

The bookings plugin sent **zero** analytics events of any kind while its
billing webhook computed real money and spent it on a contact record and a
confirmation email. So booking revenue was invisible in both properties at
once, and the two absences failed differently: ours simply had no service
revenue line, while a merchant selling appointments saw traffic on the page and
then nothing — which does not read as "bookings are not measured", it reads as
a **100% abandonment rate** on every service they sell, because GA4's ecommerce
reports and shopping funnel are all terminated by `purchase`.

It is closed by mirroring what commerce and marketplace already settled, and
the two hits carry deliberately different numbers:

| | Aglyn's property | the merchant's property |
| --- | --- | --- |
| sender | `ga4-measurement-protocol.ts`, from the webhook | the merchant's `gtag`, in the guest's browser |
| `value` | platform **net** — the fee we charged | **gross ex-tax** — what they sold |
| Aglyn's fee | IS the value | **not** subtracted; their cost of sale |
| tax | excluded, no `tax` param | excluded, no `tax` param |
| `item_category` | `booking` | none — see the event map |
| `transaction_id` | the Checkout Session id | the same id |

Reporting one figure into both is the expensive mistake in either direction: a
gross booking figure in **our** property would put a $95 massage beside a $95
subscription as though Aglyn earned both and make every combined total, ARPA
and revenue audience wrong (the AGL-1639 rule); platform net in the
**merchant's** would show them a few percent of their real revenue (AGL-1641).
Nothing is double-counted across them — they are two properties measuring two
businesses, and within each GA4 de-duplicates on `transaction_id`.

**The fee is the measured one.** `value` on our side comes off the session's
`metadata.feeCents`, the `application_fee_amount` Stripe was actually told to
charge — never the plan's rate re-applied at report time. The rate follows the
plan and the plan moves, so a later re-derivation reports a share that was
never taken; this is the "records a constant instead of the measured value"
trap in its exact local form, and it would look right in any test written
against a single-tier fixture. `billing-webhook-ga-purchase.spec.ts` pins it
with a fee that is not a round percentage of the charge.

**Idempotency is placement, not a new mechanism.** The send sits *after*
`if (!confirmedNow) return`, inside the existing AGL-1755/AGL-2315 redelivery
guard, so a Stripe replay — which this endpoint invites, since it 500s on
purpose — is dropped before it can inflate our own reported revenue. The
transaction id is the same key the guard turns on, so GA's de-duplication is a
second, independent line of defence.

**Scheduling.** `after()`, never a bare `void promise` — this handler runs
inside the console's `/api/billing/webhook` invocation, which is frozen the
moment the response is sent (AGL-2327/AGL-2346, the bug that had marketplace
revenue reporting to nothing).

**A booking sends no `shipping` param at all**, where a storefront order always
sends one even as 0. That is not an inconsistency: on a storefront 0 is a true
statement about an order that carried no shipping, whereas an appointment has
no shipping concept to be zero, and sending one would put every service
business into a shipping report they are not in.

**The guest's return URL now carries the session id.** `success_url` was
`/?booking=paid` — the word "paid" and nothing else — so the merchant-side hit
had nothing to look itself up by. It is now
`/?booking=paid&session_id={CHECKOUT_SESSION_ID}`, resolved by
`bookings/booking-analytics`, which is authorised by that unguessable id, is
scoped to the host, refuses anything not `confirmed`, and answers with a
projection carrying no guest email, name, appointment time or our fee.

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

A consequence worth stating: `generate_lead` fires on _every_ tenant site, not
only `aglyn.com`, and reports into whatever measurement id **that host**
configured. A customer's contact form reports to the customer's property;
`aglyn.com`'s reports to ours. That is the intended behaviour.

#### What the consent tool declares to Google (AGL-1606/1608/1622)

The gate above decides whether the tag LOADS. Three commits then settled what
a loaded tag is _told_, and the posture they implement, stated as the decision
was made (decided): **load-then-restrict is approved for the United
States**, where the implied-consent posture already permits the load and the
restriction signals act on a tag that is legitimately resident.
**EU/UK/EEA and unknown-region visitors are unchanged** — the gate still means
the tag never loads without an explicit accept, because loading an analytics
tag before consent is the specific act prior-consent law prohibits.
Load-then-restrict is additive to the gate, never a replacement for it.

**The signal set.** `analytics_storage` follows the visitor's grant.
`ad_storage`, `ad_user_data` and `ad_personalization` are **denied from the
first hit**, and on the great majority of sites they are denied
unconditionally and in both directions: a site that has not turned the
advertising question on asks its visitors about analytics and nothing else,
so there is no advertising basis on file to grant. This is a change from the
pre-AGL-1622 state, where a freshly loaded tag ran with `ad_storage`
unrestricted: anyone reading GA4 Ads-linked reporting for a tenant site needs
to know why the numbers moved on 2026-08-14.

**A host CAN now ask for an advertising basis** — AGL-1649 shipped in
`7901f7332`, and the "open question" this section used to end on is settled.
The category is off for every site that exists and is gated on the host
turning it on **and** an analytics id being configured
(`hostAsksAboutAdvertising()`); turning it on grants nothing by itself, it
adds a second, separate question to the banner and to the preferences panel
so a visitor has somewhere to say yes. Default-deny survives it: only an
explicit `accepted` grants advertising, in both postures and every region, so
a record written before the category existed reads
as never-asked rather than as a yes, the grant is re-derived on every read and
write (so a hand-edited `localStorage` entry, or one left behind after a host
switched the category back off, decays to denied), and advertising is clamped
to analytics — `ad_storage: 'granted'` alongside `analytics_storage: 'denied'`
is not a state this tool can reach.

**The status set has moved three times, and the ORDER is the lesson.** AGL-2402
(`a410d8785`, 2026-08-21) made the opt-out posture's `implied` default carry
advertising, arguing it was safe by geography — an `implied` record can only
ever be written outside the prior-consent regions, which is true and is still
asserted in `visitor-consent-advertising.spec.ts`. What did not hold was the
disclosure half. That commit stated the published Cookie Policy had been updated
first; read against the live page it said two different things — its "Marketing
/ advertising" paragraph described the opt-out posture, but the per-cookie table
said `_gac`, `_gcl_au`, `_fbp` and `_fbc` are "set only where you have allowed
advertising cookies", and "Your choices" repeated it. So on **2026-08-24** the
behaviour was narrowed back to agree with the strictest published statement.

On **2026-08-25** it was widened again, and this time in the right order: those
five opt-in-only sentences were rewritten in the **Cookie Policy master first**,
and only then did `advertisingGrantedByStatus` follow. The Privacy Policy needed
no change and never did — it already said *"With your consent, we do 'share' …
for cross-context behavioral advertising"*, named Google and Meta, and described
the EU/UK-ask-first vs. elsewhere-from-first-visit split.

⛔ **This document previously paraphrased that policy as a flat "we do not sell
or share" denial, and reasoning from that paraphrase is what treated retargeting
as legally blocked when it was not.** Read the master, never a doc's summary of
it. Re-narrowing is a policy act: move the published masters first and let the
code follow. `consent-advertising-copy-drift.spec.ts` is the lock that makes the
copy move with the rule in either direction — it has now gone red in both.

**Two payload builders, and the split is deliberate.** Both live in
`libs/aglyn/src/lib/app-utils/visitor-consent.ts`, and between them they are
the **single source** for every declaration — the load-time `default` and the
withdrawal `update` alike — so the two directions cannot drift:

- `analyticsConsentSignals(granted)` — the analytics-only path, feeding
  `GA_CONSENT_DEFAULT_SNIPPET`. Its return type still declares the three ad
  signals as the literal `'denied'`, so a caller that only knows about
  analytics **cannot** express an advertising grant it has no answer for.
- `consentModeSignals({ analytics, advertising })` — the advertising path,
  feeding `GA_CONSENT_DEFAULT_WITH_ADS_SNIPPET`. A separate function rather
  than a widening of the first, precisely so that reaching an advertising
  grant is a different call with a different argument: a thing a reviewer can
  see in a diff.

Read the payloads there rather than trusting any restatement here.

The three mechanisms, in the order a visitor meets them:

- **A consent-mode `default` is declared before the first hit** (AGL-1622).
  `site-analytics.tsx` (`apps/tenant/app/[host]/[[...slug]]/`) emits it
  **inside the gated block**, in the same inline script that creates
  `dataLayer`, ahead of `gtag('js')` and `gtag('config')` — so it exists only
  on a pageview the AGL-1498 gate already permitted, and no hit is ever sent
  before the tag has been told what it may store. It is deliberately **not**
  declared when the host runs their own CMP (`consent.disabled`): their
  solution owns the default, and a second one racing it would overwrite their
  visitor's answer.
- **A withdrawal silences the already-resident tag before sweeping**
  (AGL-1608). Unmounting the `<script>` cannot unload `gtag.js`, and enhanced
  measurement re-creates `_ga` on the next scroll. So
  `setResidentAnalyticsTags` (same module) sets `window['ga-disable-<id>']`
  for every resident measurement id AND sends
  `gtag('consent', 'update', analyticsConsentSignals(false))` — two signals
  because they fail differently: the flag reaches a tag that never got a
  default, the update reaches a GTM-delivered tag whose id we never saw.
  Order is load-bearing: **silence, then sweep**. Symmetric on a same-pageview
  re-grant, which restores analytics only — the ad signals stay denied in
  both directions.
- **A non-granting state expires the GA cookies** (AGL-1606).
  `clearAnalyticsCookies` (same module) expires every cookie matching
  `ANALYTICS_COOKIE_PREFIXES` (`_ga`, `_gid`) at the host itself and at every
  domain up the ladder to the registrable one, and returns the names it acted
  on so the sweep is assertable.

**Where the guard lives:** `apps/tenant/specs/consent-mode-default.spec.tsx`
walks **every member of `PRIOR_CONSENT_COUNTRY_CODES`** and fails if any
prior-consent region emits any GA artefact — a `default`, a `config`, a
script request — before consent; it asserts the consent banner IS present in
the same breath, so it cannot pass vacuously if the component throws. The
tempting misreading it exists to catch is hoisting the `default` into the
page for everyone, the way third-party CMPs do — that compiles, keeps every
other consent spec green, and is a compliance defect. Siblings:
`ga-consent-gate.spec.tsx` (the gate), `consent-resident-tag.spec.tsx`
(AGL-1608), `consent-cookie-cleanup.spec.tsx` (AGL-1606).

### 3. No PII, enforced rather than promised

Every payload passes `sanitizeEventParams` before reaching a transport:

- an exact-key denylist drops `email`, `org_name`, `first_name`, `phone`, … —
  exact-key, because substring matching would wrongly drop the legitimate
  `form_name` / `item_name` / `link_domain`;
- any value that merely _looks like_ an email drops its key entirely;
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

> **Deployment gap — CLOSED 2026-08-17** (AGL-1846/AGL-2327). This said
> `GA4_MEASUREMENT_ID` / `GA4_API_SECRET` were not set on the **aglyn-tenant**
> project, which is where this code runs, so the event was a clean no-op
> there. Both keys landed on the tenant project's production deployment at
> 12:15 UTC that day and the scheduled-publish sender is live. See the
> _Environment variables_ table, and re-derive the verdict from a deployment's
> own env key list rather than from this line.

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
  the authored events and ours land in the _same_ property — `generate_lead`
  from the form element, `select_content`/`click` from the link listener — so
  an authored `purchase` would mix hand-authored hits into a real revenue
  number.

Refusal is also what keeps the two separable in reports: an event that is not
one of the eleven taxonomy names is, by construction, authored. Deliberately
**not** a `site_*` prefix, which would have renamed events already flowing into
customers' properties and broken every report and key-event conversion built on
the old name.

**A refused event is not silently dropped where it counts.** The runtime cannot
tell the author anything — it is executing for a _visitor_ of their site, and
turning an author's config mistake into something a visitor sees would be worse
than the missing metric — so it drops the event and warns once per name in the
browser console. The author-facing half is `validateHostAction`, which refuses
to **save** a name the runtime would refuse to send. A silent drop is therefore
only possible for a step authored before AGL-1587.

Not done, and why: no cap on the _number_ of authored params (GA4 ignores past
25 and there is no privacy or pollution consequence), and no normalization of
param _keys_ (an invalid key costs that one param, again with no safety
consequence). Both are formatting nits on a path whose real risk was PII.

### 7. The docs site buys its instrumentation from the tag, not from our code (AGL-1579)

`docs.aglyn.com` had no analytics at all, which mattered more than a coverage
gap: there is no in-product onboarding, tour or checklist anywhere in the
console (verified in the AGL-1576 audit), so the getting-started guides _are_
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
and the choice of API is the load-bearing part. Since AGL-2087 the write goes
via the single owner `apps/console/utils/analytics-default-params.ts`, because
`page_title` needed the same API from a different effect and two raw callers
race each other at boot — see §11. GA4's internal-traffic filter
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
from every report. The clear survives the move to the shared owner — a key
patched to `undefined` stays in the composed object as `undefined` rather than
being dropped from it, which is the difference between clearing a stamp and
leaving the previous value standing.

**Known gap — and it is WIDER than "the first `page_view`" (measured on
production, 2026-08-24).** The claims read is asynchronous and the tag is not,
so the boot burst ships before the stamp lands. Read off `window.dataLayer` on
`app.aglyn.com`, signed in as staff, with the browser override deliberately
cleared (`?aglyn_internal=0`):

```
0:consent 1:consent 2:set{}       3:set+title  4:set+title  5:js
6:config  7:config  8:event page_view  11:event TTFB
…
19:set STAMPED  …  23:set STAMPED
```

The first `set` carrying `traffic_type` is index **19**. Both `config` calls,
the manual `page_view` and the first web-vitals hit are already gone by then.
GA4's data filter matches per EVENT, so those hits — which include
`session_start` and `first_visit` — are not filterable: **an un-opted-in staff
browser still contributes one user and one session to every report**, which is
precisely the outcome §8 says `setDefaultEventParameters` avoids. It avoids the
_taxonomy_ version of that failure, not the _timing_ one.

The same page with the override ON puts a stamped `set` at index **2**, ahead
of `js` and `config` — every hit of the session carries it, because a
`localStorage` read is synchronous and a token read is not.

So the ordering of mechanisms is the opposite of the intuitive one. **The
browser opt-in (§8b) is the primary mechanism on the console too**, not a
supplement for the logged-out surfaces; the claims predicate is what covers the
_rest_ of the session, catches a browser nobody remembered to mark, and is the
only thing that follows the actor into an impersonation session. Neither is
redundant, and neither is sufficient alone.

**Do not "fix" this by writing the override from the claims.** A browser
auto-marked because staff signed in there once stays marked after a customer
signs in on the same browser — and clearing it on a non-staff session would
wipe the deliberate opt-in the release drills depend on (§8b). Wrongly flagging
a real customer erases them from every report, permanently. The GA-side IP rule
(§8d) is the mechanism that closes the boot window without that risk, because
GA applies it server-side at collection time, to hit zero, with no race at all.

### 8b. Claims are not enough — the browser-pinned override (AGL-2064/AGL-2065)

The claims predicate is correct and covers about half the traffic. Two
populations it cannot reach, and could not be widened to reach:

- **Logged-out browsing of the marketing surface.** `aglyn.com`, `/pricing`,
  `/legal/*` and every published test site are served by the tenant runtime,
  which has no account to consult. This is the larger half: it needs no
  sign-in, so it happens all day.
- **Drills that REQUIRE a non-staff account.** The marketplace publisher drill
  cannot be run by staff at all — the thing being exercised is a publisher
  installing their own unreviewed version. Those sessions emit `sign_up`,
  `org_created`, `host_created`, `site_published` and `begin_checkout`, and
  widening the predicate to catch them would flag by identity, which is the
  point of the drill.

So there is a second, **opt-in** mechanism that asks a different question —
_is this BROWSER ours_ — and never consults the account:

> Visit any surface with **`?aglyn_internal=1`**. Take it back off with
> `?aglyn_internal=0`.

It is remembered in `localStorage` under `aglyn_traffic_type` and survives
reloads, client-side navigations, sign-outs and re-auth. `localStorage` is
**origin-scoped**, so the opt-in must be done **once per surface**:

| Surface            | Where to do it                                                                |
| ------------------ | ----------------------------------------------------------------------------- |
| Console            | `https://app.aglyn.com/?aglyn_internal=1`                                     |
| Marketing / tenant | `https://aglyn.com/?aglyn_internal=1`                                         |
| Docs               | `https://docs.aglyn.com/?aglyn_internal=1`                                    |
| Local dev          | once per `localhost:PORT` — though local builds now emit nothing at all (§8c) |

Being per-origin is a feature as much as a cost: it is what makes it
impossible for an opt-in on our console to leak a stamp into a CUSTOMER's
property while we click through their published site.

**Three implementations, one definition.** `INTERNAL_TRAFFIC_PARAM` /
`INTERNAL_TRAFFIC_VALUE` and both readers live in
`libs/aglyn/src/lib/app-utils/internal-traffic.ts`:

- The **console** calls `readInternalTrafficOverride()` and ORs it into the
  claims predicate, inside the one `setDefaultEventParameters` call.
- The **tenant runtime** inlines `INTERNAL_TRAFFIC_GTAG_SNIPPET` — a
  _constant_ string of JavaScript — into its `ga-init` block, between the
  `dataLayer` shim and `gtag('config', …)`. Constant because these pages are
  ISR-cached and the served bytes must not vary by visitor; positioned there
  because `gtag('set', …)` applies to hits processed _after_ it, and the hits
  that leak are the automatic ones.
- **`apps/docs`** carries a verbatim copy of the same string in its
  `headTags`, because a Docusaurus app cannot import from `libs/` (AGL-1595).
  `apps/console/specs/docs-internal-traffic-snippet.spec.ts` fails if the two
  drift — a stale copy would run without error and stamp a parameter nobody
  filters on.

**On our measurement id only.** The tenant stamp is emitted only when the
resolved id is `G-YW5PG16YTM`. A customer's property gets no opinion of ours:
wrongly flagging a real visitor erases them from every report, and that is the
expensive direction.

### 8d-pre. The SERVER hits were the surface no browser stamp could reach (AGL-1582)

Everything above is a browser mechanism — `setDefaultEventParameters` on the
console, a `gtag('set', …)` snippet on the tenant runtime and on docs. The four
Measurement Protocol events never touch a browser, so `purchase`, `refund`,
`subscription_cancelled` and `site_published` were the one surface the
internal-traffic filter could not reach.

That is not academic in the launch window: the final week before September 1
is a scheduled rehearsal of **real paid transactions**, and a data filter is
not retroactive. An unstamped rehearsal purchase is real revenue in the real
property, permanently.

**The carrier is the opt-in that already exists**, not a new notion of "an
internal org" — there is no such concept in this repo and inventing one would
flag by identity, which is the expensive direction. The browser that starts
checkout reports `readInternalTrafficOverride()` in the checkout body; the
route writes `subscription_data[metadata][traffic_type] = internal`; the
webhook compares it against the shared constant and hands `internal: true` to
the sender, which adds the parameter centrally in `postGa4Event` — centrally,
so a fifth sender added later is not unstamped by default.

**On the SUBSCRIPTION's metadata, not the session's**, so a renewal months
later is stamped too, exactly as `ga_client_id` is.

**The refund had to be solved with it, or the fix would have been worse than
nothing.** A refund arrives on a charge, which carries no subscription
metadata. An internal `purchase` discarded by the filter with its `refund`
kept would net the reports **negative** by the rehearsal's value. So the flag
is also written onto the `platformRevenue` ledger row the purchase records,
which both refund branches already read. (The pre-AGL-1811 branch, which has
no row, can only fire for invoices that predate this feature — so no internal
purchase can exist there.)

**Only ever added, never `false`.** GA4's filter matches on the parameter
being present with this value. A `traffic_type: 'external'` on every real hit
would be a second dimension nobody filters on, and one bad predicate away from
erasing paying customers from reports that cannot be recovered. The metadata
is client-supplied, so it is compared against `INTERNAL_TRAFFIC_VALUE` rather
than tested for truthiness — "any value present means ours" is how a stray
metadata edit deletes a customer.

**Still uncovered, deliberately:** the marketplace `purchase`/`refund` pair
(a plugin checkout does not carry the flag yet) and `site_published` from a
scheduled publish of one of our own hosts — the sender accepts `internal` but
no caller sets it, because a publish has no browser to ask. Both are smaller
than the rehearsal hole and neither is on the revenue path.

### 8c. Non-production builds do not report at all (AGL-2067)

The stamp only helps once the filter is Active, and a filter is not
retroactive. So localhost and preview traffic is handled by not emitting:

| Environment                                                      | Emits?                |
| ---------------------------------------------------------------- | --------------------- |
| `NODE_ENV !== 'production'` (any dev server, jest, local e2e)    | **no**                |
| Vercel **preview** (`NODE_ENV` _is_ `production` there)          | **no**                |
| Vercel production                                                | yes                   |
| Unknown deploy env + `NODE_ENV === 'production'` — **self-host** | **yes**, deliberately |

`libs/aglyn/src/lib/app-utils/analytics-environment.ts` holds the predicate.
The console's `FirebaseServicesProvider` skips `initializeAnalytics` outright
and the tenant runtime drops the tag from its render condition — _not_
initialized rather than initialized-and-suppressed, because a resident tag
reports on its own (the AGL-1608 lesson).

`VERCEL_ENV` is server-only, so each app maps it into the client bundle as
`NEXT_PUBLIC_DEPLOY_ENV` through its own `next.config` `env` block. Relying on
Vercel's "automatically expose System Environment Variables" project setting
would be a gate no spec in this repo can see.

Self-host emits on purpose: those builds point at the operator's own Firebase
project and their own GA property, and silencing a customer's analytics to fix
our leak is the worse failure.

**Escape hatch.** `NEXT_PUBLIC_ANALYTICS_ALLOW_NONPROD=1` re-enables a
silenced build for DebugView work, and such a build stamps
`traffic_type: 'internal'` on **every** hit unconditionally — it emits only
because someone asked it to. A _production_ build with the flag set never
blanket-stamps; that would delete every paying customer from every report.

**This is why the archived Marketing property reads the way it does.** Its
whole year-to-date history is 30 views / 6 users, ~24 of them `/signin` on
Vercel _preview_ URLs of the console. Preview traffic reaching a production
property was not a risk — it was most of what that property ever recorded.

**Verified live on `localhost:4200`, 2026-08-24, not inferred from the code.**
This is worth re-measuring rather than trusting, because
`apps/console/.env.development.local` still sets
`NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID="G-YW5PG16YTM"` — the **production**
stream. The gate is the only thing between a dev server and the live property.
A signed-in console page on the dev server reported `typeof window.gtag ===
'undefined'`, `window.dataLayer.length === 0`, and **zero** of its 83 loaded
resources on any Google Analytics host.

The negative is a real one rather than a blind grep: the same inventory _does_
list five `*.google*` resources (`recaptcha/api.js`, two
`*.googleapis.com` auth calls, an avatar) — so the probe can see Google traffic
when there is Google traffic, and simply found no tag. What it did find is
`_ga` and `_ga_YW5PG16YTM` cookies still sitting on `localhost` — residue from
before AGL-2067, and proof the hole was real. They are per-origin, so they
cannot reach the production property; they are stale, not active.

### 8d. What is left to click in the console

🔴 **The Internal Traffic data filter is ACTIVE, not Testing — corrected
2026-08-24 by reading Admin → Data filters on the live property.** It shows
`Internal Traffic · Internal Traffic · Exclude · **Active**`. Property change
history records four `Data filter / Internal Traffic / Modified` entries, the
last at **2026-08-18 19:38 GMT-5 (2026-08-19 00:38 UTC)**, and nothing since.
The earlier "reverted to Testing the same day" note described 2026-08-18
14:16 GMT-5 and was overtaken that evening; it stood here stale for five days.

This matters because it changes what a mistake costs. An Active filter
**permanently and irrecoverably discards** every matching hit at collection
time, so any surface that wrongly stamps `traffic_type: 'internal'` is not
mis-labelling data, it is deleting it — and every day since 2026-08-19 has been
filtered, not merely flagged. AGL-2065 (the console stamp fires only for STAFF)
and AGL-2064 (the marketing/docs stamp) are therefore both live-data decisions
now, not staging ones.

✅ **`traffic_type` is already registered** as an event-scoped custom dimension
— it is one of the 18 counted off the live property on 2026-08-24 (see *Still
outstanding*). Earlier versions of this section and of AGL-1637 said to register
it; that instruction is spent.

Remaining, and all of it is his click — nothing in this repo can do it:

1. **Opt each browser in, once per origin — do this FIRST, not last.** The
   three URLs in §8b. It was written last here for years and that ordering was
   wrong: §8's measurement shows an un-opted-in browser is only stamped from
   part-way through the session, so on the console this step is what makes the
   user and session counts correct at all, not a tidy-up. Forgetting it is
   silent. (Verified present on this machine's Chrome profile for
   `app.aglyn.com`, `aglyn.com` and `docs.aglyn.com` on 2026-08-24.)
2. **Add the IP rule as well, and for a better reason than "a weaker net".**
   Admin → Data Streams → (3230351080) → Configure tag settings → Show all →
   **Define internal traffic**. GA applies an IP rule server-side at collection
   time, so it stamps `traffic_type=internal` on **hit zero** — including the
   `session_start` / `first_visit` pair the browser mechanisms cannot reach on
   a cold load. It is not a lesser version of the parameter; it is the only
   thing covering the boot window. Its real limits are the ones AGL-1582 gives:
   a dynamic residential IP, and staff working from anywhere. Keep the default
   rule name `internal` so it writes the same value the code writes.
3. ✅ **Verified in Testing, then set Active — both DONE 2026-08-18/19.** The
   Testing-mode check was run in both directions on the `Test data filter name`
   dimension (a staff session matched `Internal Traffic`; an ordinary session in
   the *same city* did not, so it keyed on `traffic_type` and not on geography),
   and the filter was set Active at 2026-08-19 00:38 UTC. Kept because the
   two-direction requirement is the reusable part: a filter verified in one
   direction only is the one that erases real users.
4. ✅ **Already Active.** ⚠️ Restated because it is now load-bearing rather than
   hypothetical: an Active filter **permanently and irrecoverably discards**
   everything it matches, and it is not retroactive in either direction — data
   already collected is not re-filtered, and data discarded while Active cannot
   be recovered. Any change to who gets stamped `internal` now changes what is
   deleted.

Click-list on AGL-1637.

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

**Firebase Performance Monitoring is still not initialised anywhere** — zero
import sites; the package is in the closure only because the `firebase`
umbrella ships every entry point, and "in package.json" is not integration.

⚠️ **The sentence that used to sit here — "there is no Web Vitals / RUM of any
kind in any app" — is FALSE and has been since 2026-08-18.** AGL-1642 shipped
`web-vitals` → GA4 on both the console and the tenant; it is in production and
described in "The 2026-08-17 coverage pass" above, in this same document. The
stale claim is corrected rather than deleted because this section is the one a
reader lands on when asking "what performance telemetry do we have", and it
was answering "none".

**Firebase Perf is deferred, not missing (AGL-1856).** Page-load metrics are
covered by AGL-1642, so the only thing it would add is automatic **network
request** monitoring — client-observed latency and success rate per URL
pattern, which neither GA4 nor the error beacon can see. The decision rule is
on AGL-1856: adopt only if a real "what is the client-observed success rate /
latency of endpoint X" question goes unanswered once the RUM data is
reportable. **The CWV breakdown dimensions (`metric_rating`, `metric_id`) were
only registered 2026-08-24** (AGL-2327), and GA4 dimensions are not
retroactive, so the first reportable RUM data starts then — the evaluation
window opens ~2026-09-07, after the beta launch, not before it.

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
that call reads: _"This will trigger a page_view event unless 'send_page_view'
is set to false in configProperties"_. `getAnalytics(app)` cannot pass
`configProperties` at all — it forwards `options?.config ?? {}` — so the key was
never present, on top of the layout's own effect firing for the same page.

The suppression goes on the **SDK's** hit, and the direction is the whole
decision. The SDK fires once per document load; the layout's effect fires on
mount **and** on every `usePathname` change, so it is a superset. Suppressing
the layout's instead would have dropped every client-side navigation and halved
console pageviews, with reports that looked entirely healthy. `firebase-services.tsx`
therefore calls `initializeAnalytics(app, CONSOLE_ANALYTICS_OPTIONS)` — the only
form that can pass the flag, carrying `send_page_view: false` alongside
`content_group` — and `analytics-page-view.spec.tsx` pins it, including that the
boot never takes the config-less `getAnalytics` door.

Attribution does not move: the surviving hit is sent from the same document at
mount, so `document.referrer` — which gtag resolves into `page_referrer` itself,
and which carries marketing traffic source into the session — is still the
external referrer at that moment.

**Still true, and deliberate:** `usePathname()` does not change on a
query-string-only navigation, so paginated and filtered views do not re-report.
An event per filter change would burn the per-session budget for a breakdown
nobody reads.

### That boot can be lost, and losing it used to crash the console (AGL-1979)

`initializeAnalytics(app, options)` throws `already-initialized` unless the
options match the ones the instance was first created with. Matching is a true
recursive `deepEqual`, so re-entry with an equal literal is safe — remounts,
StrictMode's double invoke and Fast Refresh all cannot cause this. What can is
**an options-less initialization getting there first**: `getAnalytics()` is one
door, and `@firebase/remote-config` is the other with no help from us, since
`addExperimentToAnalytics` calls `analyticsProvider.getImmediate({ optional:
true })` and `optional` only suppresses the throw, not the initialization. The
conflict is then permanent for that document, and the tag that survives is the
config-less one — **no `content_group`, and the startup `page_view` back**.

Two consequences the code now holds:

- the config is one module-scope object, so re-entry matches by identity, and
  the provider falls back to `getAnalytics(app)` on a throw. A degraded
  instance beats `undefined`, and the conflict is logged rather than swallowed;
- **`useAnalytics()` can still return `undefined`** — it is typed as always
  returning an `Analytics` and strictNullChecks is off repo-wide, so nothing
  makes a call site consider it. `logEvent(undefined, …)` reads `.app` and
  throws out of an effect; that was the top Cloud Error Reporting group. Every
  console binding therefore lives in `AnalyticsBindings`, a child mounted only
  when an instance exists. Guarding call sites one at a time was tried first
  (526608b9) and got half applied — which is the whole argument for a gate.

Worth knowing for anything that ever adds a second Firebase app: the SDK's
`initializationPromisesMap` is module-scope and keyed by **appId**, so a second
`FirebaseApp` sharing the primary's `appId` — `use-presence.ts` builds exactly
one — would throw `already-exists` if analytics were ever initialized on it.

**Still open:** one raw `logEvent(analytics, 'screen_view', …)` call lives
outside the taxonomy, in `hosts/[host]/setup/page.tsx`. It is legal — Firebase
treats `screen_view` and the `firebase_` prefix specially — but it is the one
class of console event neither the compiler nor the sanitizer sees. Its own
`firebase_screen` / `firebase_screen_class` values are authored strings and were
never the problem; what rode alongside them was the ambient `page_title`, closed
by AGL-2087 in §11.

`manage/user/page.tsx` had the second one. Its sections are routes now
(AGL-693), so each one reports through the shared `page_view` effect in
`firebase-app.layout.tsx` — which fires on every pathname change — rather than
through a hand-written event a tab click had to remember to send.

### 11. `page_title` is sent explicitly, and is not the tab title (AGL-2060)

The Firebase overview report, read on 2026-08-18, showed one console page as
three separate rows:

| Page title and screen class             | Views |
| --------------------------------------- | ----- |
| Secure Platform Console – Aglyn         | 6.2K  |
| **(4)** Secure Platform Console – Aglyn | 2.2K  |
| **(5)** Secure Platform Console – Aglyn | 1.7K  |

Two separate defects, one dimension.

**The badge.** `notifications-menu.component.tsx` writes the unread count into
`document.title` — a real feature, "Unread count in tab title", on by default
and in the console tour. GA4 builds `page_title` from `document.title` **at
the instant the hit fires**, so a per-user, per-moment counter became a
reporting dimension value. Views for a page were divided across an unbounded
set of rows, and because the count correlates with engagement, the most active
users fragmented the most.

The console now passes `page_title` explicitly on its `page_view`, stripped by
`stripUnreadBadge` in `apps/console/utils/notification-alerts.ts` — the exact
inverse of the `unreadBadge` that writes it, living beside it so the writer and
the reporter cannot drift on the `\d+\+?` shape (the badge caps at `(99+)`, and
a pattern without the `\+?` would leave it on exactly the busiest accounts).
The badge itself is untouched: only its reflection in analytics goes away.

**The generic row.** The 6.2K is mostly _history_, not a live bug. Until
2026-07-28 the console had exactly ONE titled layout — the root — because
pages titled themselves through `NextPageTitle`, which renders via `next/head`
and **is inert in the App Router**. Every console route therefore reported the
root default. AGL-1059 fixed it by adding 61 layouts in one commit (`4b5567f`),
so most of that row predates the fix. GA4 dimension values are not retroactive;
it will never repair.

One route had been missed: `(auth)/sso`, a client component with no layout
beside it, still answered with the root default in production. It now titles
itself, and `apps/console/app/page-title.spec.ts` fails on any `page.tsx`
whose only titling ancestor is the root layout — inheriting that default IS
the bug, so the root is deliberately excluded as a provider.

**The rest of the hits, and the one owner that closes them (AGL-2087).** An
explicit param fixes `page_view` and nothing else: gtag attaches `page_title`
from `document.title` to _every_ hit it assembles, so the badge still reached
the two raw `screen_view` calls and the SDK's automatic `session_start` /
`first_visit` / `user_engagement`, which no call site writes at all.

The only mechanism that rides those is `setDefaultEventParameters` — the same
one the `traffic_type` stamp uses (§8), and _not_ safe to call twice:

```js
function setDefaultEventParameters(customParams) {
  if (wrappedGtagFunction) wrappedGtagFunction('set', customParams)
  else _setDefaultEventParametersForInit(customParams) // bare ASSIGNMENT
}
```

Before gtag is wrapped — the whole boot window, which is exactly when both
effects first run — it **replaces** the pending default set instead of merging
into it. A second caller added naively would have dropped `traffic_type`
silently: the events still ship, GA4's internal-traffic filter just stops
matching them, our own browsing rejoins the launch metrics, and a data filter is
not retroactive. That is a worse failure than the fragmentation being fixed,
which is why AGL-2060 stopped where it did.

So there is exactly one owner: `apps/console/utils/analytics-default-params.ts`
keeps the composed set and re-sends **all** of it on every update. Each concern
patches only its own keys and cannot express "drop everyone else's", and the
bare-assignment branch is handed the full object, which is what it wants. The
`page_title` patch is refreshed from the same effect that fires the `page_view`
— already running on mount and on every route change — using
`buildConsolePageTitle`, the same helper the event param goes through, so the
stripping rule has one definition and two readers. An explicit param beats a
default, so the `page_view` hit is unchanged.

`apps/console/specs/analytics-default-params.spec.ts` asserts the composed set
carries `traffic_type` **and** a stripped `page_title` at once, that neither
survives at the other's expense across an update or a clear, and — the part
that keeps the design true for a contributor who has read none of this — that
this module is the only place in `apps/console` whose _code_ names
`setDefaultEventParameters` at all. Prose about the API is exempt; the guard
strips comments first.

**Also measured, and worth knowing.** Next 16 streams metadata for any route
whose `generateMetadata` awaits I/O. On
`/{org}/marketplace/{listingId}`, whose social card does a Firestore read,
`</head>` lands at byte 40934 with **no `<title>` in it** and the real title
arrives at byte 80279 of 83383 — hydration, and so the `page_view`, can beat
it. That is why an empty title omits the `page_title` key rather than sending
`''`: an empty string would report those views under an empty title, whereas
omitting lets GA4 fall back to its own reading. Routes with static or
non-awaiting metadata are unaffected — `/signin` ships its title at byte 6669,
well inside the head.

**Prefer `page_location` or `content_group` over page title** in reports
regardless. Paths are stable; titles are authored strings that change without
notice, and everything above is a demonstration of that.

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
  ⚑ **"no Google Ads link" expired on 2026-08-20** — see the coupled-controls
  warning at the top of this doc. Everything else in this bullet was re-verified
  on 2026-08-25 and still holds.

**Bookings (AGL-2481) needs NO new custom dimension.** Stated positively so
nobody goes looking: the booking `purchase` carries only `transaction_id`,
`currency`, `value` and `items` — all GA4 built-ins — and the one field that
separates it from the other revenue lines, `item_category: 'booking'`, is a
built-in **item-scoped** dimension, not an event-scoped custom one. Booking
revenue is therefore readable the day the first payment lands, by filtering
Item category in the standard ecommerce reports, with nothing to click first.

The one thing worth doing by hand is optional and is reporting, not
collection: if booking revenue should stand on its own in a dashboard rather
than inside the combined `purchase` total, build a comparison or an exploration
segmented on Item category = `booking` / `marketplace` / `subscription`.
Registering `item_category` as a custom dimension would be the wrong fix — it
is already there, and a duplicate registration reads as a second, half-empty
dimension.

### 12. Where an account came from is captured at signup (AGL-1731)

Until this landed, `sign_up` carried `method` and nothing else, so a paid
click, an organic visit and a partner link arrived indistinguishable. That is
free while nothing is being spent and expensive the day advertising starts,
because **attribution is not retroactive either**: a signup that lands
unattributed is unattributed forever, and a September ad spend with no
attribution cannot be evaluated at all.

`libs/aglyn/src/lib/app-utils/campaign-attribution.ts` owns the contract.
Three parameters, allowlisted:

| URL parameter  | `sign_up` param   | Stored as         |
| -------------- | ----------------- | ----------------- |
| `utm_source`   | `campaign_source` | `source`          |
| `utm_medium`   | `campaign_medium` | `medium`          |
| `utm_campaign` | `campaign_name`   | `campaign`        |

**Renamed off the `utm_` spellings on purpose.** These are our own registered
dimensions; the `utm_` names belong to GA's automatic campaign collection, and
a custom parameter wearing a name the platform also owns is how one dimension
quietly comes to mean two things.

**`utm_term` and `utm_content` are deliberately out**, matching the refusal the
tenant's own first-party collector already made (`apps/tenant/app/api/analytics/collect/route.ts`):
keyword- and variant-level labels multiply cardinality without answering a
question anyone asks of a signup, and a keyword string is the likeliest of the
five to carry something a person typed. `gclid` is out too — it is an
ads-click identifier and this property runs with ads personalization off in all
307 regions.

**The allowlist is the privacy mechanism, not a convenience.** A parser that
copied "the campaign-ish parameters" would be one marketing link away from
putting `?email=` on `users/{uid}`. On top of the allowlist each value is
trimmed, refused if email-shaped, and capped at 100 characters — and that
scrub lives in the parser rather than in `sanitizeEventParams`, because a
campaign leaves the process **twice** and only one exit is sanitized:

- onto the GA4 `sign_up` hit, which does pass `sanitizeEventParams`;
- into **`users/{uid}.signupCampaign`**, which does not.

#### Why it is stored on the account, and why that is the erasure-safe shape

The hit answers "how many signups did the campaign produce". It cannot answer
the question the spend is judged on — "how much **revenue**" — because that
arrives weeks later from a Stripe webhook with no browser session and no
memory of a URL. So the campaign is remembered on the account, the same
document and the same wire-form-plus-re-parse contract as the AGL-1535 plan
intent it sits beside (`apps/console/utils/signup-campaign.ts`).

A **field on `users/{uid}`** rather than a `signupCampaigns` collection,
deliberately. `eraseUser` does a `recursiveDelete(users/{uid})` and the
personal-data export reads the document whole, so a field there is erased and
disclosed automatically. AGL-1448 had to go and find three org-keyed
collections the cascade could not see; the invisible shape is always a new
top-level collection or a doc keyed outside those trees, and a field on a
document already swept is the one shape that cannot become a fourth.

Unlike the plan intent it is **never consumed and never expires** — it is a
fact about how the account began, and a campaign that stopped being true after
seven days could not be joined to a purchase that closed in week three, which
is the join it exists for.

Wired on all four doors: the password and Google-popup doors in
`apps/console/app/(auth)/signup/page.tsx`, and the mobile **redirect** door —
the majority door — inside `apps/console/hooks/use-google-redirect-result.tsx`,
which has to be handed the params because the page carrying the marketing URL
is gone by the time the redirect lands. `login` never carries them: a
returning user's session was not produced by today's campaign, and stamping
one on it would credit the ad for revenue it did not cause.

#### 12a. Feeding the capture — the domain hop (AGL-1731)

The parser, the four doors and the durable write all worked from the day §12
landed, and **nothing reached them**. That was a second defect, not the same
one, and it is what this section is about.

`aglyn.com` is a tenant site and `app.aglyn.com` is the console — a real
cross-origin hop, and until this section's fix nothing in this repository
forwarded a query parameter across it. `onboardingSignupHref`
(`libs/aglyn/src/lib/app-utils/onboarding-deep-link.ts`) builds a **fresh**
`?plan=…&interval=…` URL, has no parameter through which a caller could pass
anything else, and has **zero production callers** — by design, because the
pricing CTAs are authored besigner content on `aglyn.com`, not repo files.

So `utm_*` reached `/signup` only if a human had typed it into the CTA href.
That is worse than nothing: a hardcoded `utm_source=google` is **static**, so
every visitor who clicks that button is attributed to Google whether they came
from Google, Hacker News or a bookmark. Confidently wrong attribution is harder
to detect than absent attribution and reaches the same spend decisions — which
is why a campaign the visitor actually arrived with now REPLACES an authored
one rather than deferring to it.

**What was actually needed** is per-visitor forwarding: the landing page copies
the campaign off its OWN inbound URL onto the console-bound href at click time.

**That is what `campaign-forwarding.ts` now does** (`libs/aglyn/src/lib/app-utils/`),
installed by `site-analytics.tsx` beside the click and web-vitals listeners.
`AppLink` (`libs/shared/ui/jsx`) was the obvious seam and is the wrong one
twice over: it would need `useSearchParams` in a component the console renders
on every page — a dynamic-rendering hazard on statically generated surfaces,
paid on every route to fix a link on one — and it would still miss the links
that matter, because besigner rich-text and Custom HTML anchors are written
with `dangerouslySetInnerHTML` and have no React handler at all. A
capture-phase listener on `document` sees every one of them, costs one
listener, and renders nothing. It is the same seam, and the same argument, as
the AGL-1562 click listener beside it.

Two tiers, because nobody signs up from the page the ad landed on:

| Tier | Source | Storage | Consent |
| --- | --- | --- | --- |
| 1 | `window.location.search` at click time | none | none needed — nothing is written to the device |
| 2 | first touch of the visit, `sessionStorage` under `aglyn:campaign` | session-scoped, dies with the tab | `analytics_storage`, the same grant the tag waits for |

Tier 2 wins when both exist: first touch is the question being asked, and last
touch would disagree with GA4's own session attribution. Tier 1 is what still
works for a visitor who declined analytics and converts from the landing page.
A `sessionStorage` that throws reports **`unreadable`**, a third state distinct
from "no campaign", and falls through to tier 1 rather than to silence — a
`catch` returning null there is exactly how an unreadable source becomes a
measured zero.

Never gated on advertising storage: nothing here reads or writes an
advertising identifier or sets a cookie, and AGL-1649 has advertising denied
with no route for a host to grant it, so that gate would make the feature dead
by construction rather than off.

The three `utm_*` keys are replaced **wholesale**, never merged key by key, so
a visitor's `utm_source` cannot be married to an author's `utm_campaign` and
describe a campaign nobody ran. Everything else on the href — `plan`,
`interval`, the AGL-1535 intent — is preserved. Only links to the configured
`NEXT_PUBLIC_CONSOLE_URL` origin are touched; a third-party link never gets our
campaign labels.

**Accepted consequence:** the tenant runtime serves every customer site too, so
a customer linking to our signup forwards their own inbound campaign into our
acquisition report. Gating on "is this the operator's marketing host" needs a
second configured origin, and a deployment that forgot to set it would forward
nothing while looking healthy — a silent zero is the failure this issue is
about, and it is worse than a few rows GA's Hostname dimension can separate.

A side effect worth knowing: because real `utm_*` now arrives on
`app.aglyn.com`, GA4's own **automatic** campaign collection reads them on the
console landing pageview. The custom dimensions below are what joins a campaign
to revenue; GA's session source/medium is fixed by the same forwarding for
free. GA4's `_gl` linker still carries the **session** rather than `utm_*` into
`users/{uid}`, and §"One property, one stream, three domains" above records why
it is best-effort rather than certain.

The one hop this repo *does* own was dropping the campaign and now does not:
`sendToConsentGate` (`apps/console/utils/legal-consent.ts`) bounces the fourth
account-creation door from `/signin` to `/signup` and used to build a bare
`?consent=required`. It now re-parses the campaign through the same allowlist
and re-serialises it — a parse-and-rebuild, not a string copy, so a marketing
link cannot push anything else onto a URL this code owns.

#### 12b. ⚠️ The capture is not gated on consent, and that is unresolved

Both exits — the GA4 hit and the `users/{uid}` write — run for **every**
signup, including a visitor who declined analytics on `aglyn.com` and a visitor
whose browser sends Global Privacy Control.

This is not a regression; it is the console's standing posture. `app.aglyn.com`
has no consent banner, no region gate and no GPC handling
(`platform-consent-default.ts` states it outright — "GA loads unconditionally
on both (no gate can run here)"), and `hasGlobalPrivacyControl()` is read
**only** on the tenant runtime. What §12 changed is *what* that ungated hit
carries: a marketing label now travels with it and is stored durably against an
identified person.

Two things make this a question for counsel rather than a bug to fix here:

- The pinned privacy policy (v2) has **no** marketing-attribution category in
  its §1.1 account-data enumeration. The nearest disclosure is "referring URLs,
  and similar analytics" under *automatically collected usage data* — a stretch
  to read as covering a durable label joined to revenue.
- §3 of that same policy promises a "Your Privacy Choices" control **on any
  page**. On the console no such control exists on any page.

Pinned as an executable assertion in
`apps/console/specs/signup-campaign-attribution.spec.tsx` ("captures even under
GPC, because the console has no gate"), so that answering the question requires
deliberately changing that test rather than silently changing the product.

### 13. Why a server event can still report nothing with the credentials in place (AGL-2327)

Three distinct causes have been mistaken for each other, twice. Check them in
this order, because each one makes the next invisible:

1. **Credentials.** ✅ Resolved 2026-08-17 12:15 UTC. Re-derive it from
   `GET /v13/deployments/{id}` — a deployment's own env key list — never from
   `vercel env ls`, never from the project's env list, and never from this
   document. Always diff an older deployment as a negative control.
2. **Scheduling.** A bare `void somePromise()` in a route handler **does not
   run**: AGL-1133 measured on production that the serverless function is
   frozen the moment the response is sent. The console's `/api/billing/webhook`
   was migrated to `after()` for exactly this (AGL-2346) — and the marketplace
   handler, which runs **inside that same invocation**, was not. So marketplace
   `purchase` and `refund` were genuinely reporting to nothing, with the
   credentials present and the sender returning `{ sent: true }` to a caller
   that never got resumed. Fixed in `libs/plugins/marketplace/src/lib/server/billing-webhook.ts`;
   pinned by `billing-webhook.spec.ts`'s "the beacon is SCHEDULED through
   `after()`" case, which records **where** the beacon was fired from rather
   than counting `after()` calls — a count was measured failing to fail,
   because these handlers schedule other work through `after()` too.
3. **Dimension registration.** An unregistered param is collected and never
   reportable, which from the report end is indistinguishable from the event
   not carrying it. This is where a still-missing breakdown most likely lives
   now. See "Still outstanding" below.

4. **Address.** The two credentials travel in the QUERY STRING, and GA4's
   Measurement Protocol answers **2xx to almost anything** — including a hit
   whose `api_secret` is missing or wrong, which it accepts and then silently
   discards. So `response.ok` cannot detect a misaddressed hit and
   `{ sent: true }` is not evidence of delivery. A mutation run on 2026-08-24
   confirmed the consequence: the collector host could be changed to
   `example.invalid` and `api_secret` dropped from the URL entirely, and the
   suite stayed **green** — every assertion read the request BODY and nothing
   read where it was going. Now pinned by "the hit is addressed correctly, not
   merely shaped correctly" in `ga4-measurement-protocol.spec.ts`. A test is
   the ONLY place this class of mistake can be caught.

The sender is silent by design on cause 1 — `{ sent: false, reason:
'not-configured' }`, no log — cause 2 is silent by construction, because
the process is gone, and cause 4 is silent by Google's design. None shows up
as an error anywhere, which is why the order above matters more than usual.

#### ✅ The transport is PROVEN live — measured 2026-08-24, from the property

The strongest available evidence, and it needed no test hit: **the property has
received `subscription_cancelled`** (Admin → Events → Recent events, 28-day
window). That event has **no client-side emitter anywhere in the repo** — it
exists only in `sendGa4SubscriptionCancelled`, over the Measurement Protocol.
Its arrival therefore proves, end to end, that the credentials are present on
the running lambda, the endpoint is right, the payload is accepted, and the
`after()` scheduling actually runs. `purchase` — also server-only — corroborates.

That retires the "four server events ship to nothing" finding on evidence
rather than on this document's say-so. Note what it does NOT prove: `refund`
and `stripe_connected` have not been received, but both go through the same
`postGa4Event` on the same credentials as the two that landed, so the transport
is not the explanation — no refund and no Connect activation has occurred in
the window. Absence of an event is not evidence of a broken sender, and this is
the distinction the 2026-08-19 smoke pass got wrong in the other direction.

⚠️ **Never verify by sending a test hit into property 302497406.** It is the
property the September funnel is read from, MP hits cannot be deleted, and a
rehearsal `purchase` becomes permanent revenue. Use GA4 **DebugView** with a
`debug_mode` hit, or the `/debug/mp/collect` validation endpoint, which
validates a payload and stores nothing.

### Still outstanding

> **⚑ READ THIS FIRST — the live property was counted on 2026-08-24 (AGL-2327),
> and most of the list below is DONE.** Read from the property, not from this
> document and not from the repo: a custom definition is property-side state
> that no code can observe, and the previous version of this section listed as
> outstanding fourteen dimensions that had already been registered a week
> earlier. That is the same failure this whole §13 is about — a stale note is
> not inert, and this one would have sent someone to re-do finished work while
> the genuinely missing items stayed missing.
>
> **⚑⚑ RE-READ 2026-08-24 (later the same day, AGL-1637 audit): EVERY
> registration item below is now DONE.** The 18/2 reading quoted here was taken
> in the morning; the remaining 15 definitions were registered at 06:25–06:27
> GMT-5, and the property now reads **30 event-scoped dimensions and 5 custom
> metrics**. Counted row by row off Admin → Data display → Custom definitions
> (both tabs, both pages of the dimension list), and corroborated by Account
> change history, which logs each `Created` with a timestamp and `zach@aglyn.com`.
>
> | Registry | Used (2026-08-24 AM) | Used (2026-08-24 PM) | Cap |
> | -- | -- | -- | -- |
> | Custom dimensions, **event**-scoped | 18 | **30** | 50 |
> | Custom dimensions, user-scoped | 2 | 2 | 25 |
> | Custom dimensions, item-scoped | 0 | 0 | 10 |
> | Custom **metrics**, event-scoped | 2 | **5** | 50 |
> | Calculated metrics | 0 | 0 | 5 |
>
> **Registered event-scoped dimensions (30):** `action`, `billing_interval`,
> `campaign_medium`, `campaign_name`, `campaign_source`, `content_id`,
> `content_type`, `effective_at`, `experiment_action`, `experiment_id`,
> `feedback`, `first_publish`, `form_location`, `form_name`, `from_plan`,
> `funnel_completed`, `grounded`, `interval`, `link_domain`, `link_id`,
> `metric_id`, `metric_rating`, `method`, `plan`, `reason`, `surface`, `tier`,
> `to_plan`, `traffic_type`, `variant_id`.
> **Registered user-scoped:** `org_plan`, `org_role`.
> **Registered custom metrics (5):** `duration_months`, `metric_delta`,
> `metric_value`, `percent_off`, `tenure_days`.
>
> So: **0, 0b, 0c, 0d, 0e and 0g are ALL DONE.** `metric_delta` — the item this
> section called "the lowest-priority item on this whole page" — is registered
> too. **Nothing on the registration list is outstanding.** 20 dimension slots
> and 45 metric slots remain spare, so the cap never became a constraint.
>
> ⚠️ Note the display-name trap that bit one of these: `interval` had to be
> named **`Plan change interval`** — GA4 rejects parentheses in a display name.
> The parameter name is what reports key on, so the rename is cosmetic only.

0. ✅ **DONE 2026-08-17.** ~~Register five more custom dimensions~~ (AGL-1562), all **event-scoped**,
   before the events are worth reporting on. Every parameter the two link
   events carry is new, and an unregistered param is collected but never
   appears as a breakdown — which reads exactly like the event not carrying
   it:

   | Dimension name | Event parameter | Why                                                                                                  |
   | -------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
   | Content type   | `content_type`  | Always `cta` today; the axis that keeps `select_content` separable if anything else is ever selected |
   | Content id     | `content_id`    | `section:label` — **the CTA metric**, "which part of the page sells"                                 |
   | Link domain    | `link_domain`   | Outbound destination — the GitHub/docs leading indicator                                             |
   | Link id        | `link_id`       | Which outbound link, by label                                                                        |
   | Surface        | `surface`       | `site` vs `docs` (AGL-1579); Hostname covers the domains, this covers surfaces sharing one           |

0d. ✅ **DONE 2026-08-17** — verified against the property 2026-08-24. `plan`
   is an event-scoped **dimension** and `tenure_days` is an event-scoped
   custom **metric**, which is the right pair of registries. Kept for the
   warning below, which is the reusable part.

   ~~Register `plan` as a dimension and `tenure_days` as a METRIC~~
   (AGL-2327). Both are sent by `sendGa4SubscriptionCancelled` and appeared on
   **neither** the registered list above **nor** either outstanding list — so
   the churn event arrived as one undifferentiated count and plan-tier churn
   mix and tenure-at-cancellation, the two numbers it exists for, were
   unreachable. `plan` is event-scoped custom **dimension**.

   ⚠️ `tenure_days` is NOT a dimension, and registering it as one is the
   plausible mistake that would leave the number still unreachable after the
   work looked done. It is a NUMBER, and GA4 splits the two registries: a
   custom **dimension** buckets by string, so a day count becomes one report
   ROW per distinct tenure — hundreds of one-org rows, against the 50-dimension
   quota — and cannot be averaged. "Tenure at cancellation" is an AVERAGE, and
   only a custom **metric** (Admin → Custom definitions → **Custom metrics**,
   event-scoped, unit **Standard**) can produce one. Same registry, different
   tab; the parameter name is unchanged.

0e. ✅ **DONE 2026-08-24** — `metric_delta` was registered at 06:27 GMT-5 and
   verified on the *Custom metrics* tab the same day; both rows below are now
   green. ~~⚠️ **HALF DONE.**~~ **Register the Core Web Vitals custom METRICS**
   (AGL-1642). Numeric, so they belong in the **Custom metrics** tab — every
   audit before 2026-08-20 read only the DIMENSIONS list, and a metric is
   invisible from there. Without them the CWV events arrive as a count of
   measurements with no measurement in it, and "what is real-user LCP" stays
   the unanswerable question AGL-1642 existed to answer.

   | Metric name  | Event parameter | Unit     | State | Why                                                            |
   | ------------ | --------------- | -------- | ----- | -------------------------------------------------------------- |
   | Metric value | `metric_value`  | Standard | ✅ registered 2026-08-17 | The metric's current value — the number the report is OF |
   | Metric delta | `metric_delta`  | Standard | ✅ registered 2026-08-24 | Its change since the last report, for the multi-report metrics |

   `value` needs nothing — it is GA4's built-in event value, and because
   `reportMetric` sends `value: metric.delta`, the delta is *already* readable
   as Event value. `metric_delta` is therefore the lowest-priority item on
   this whole page: register it for an explicit column, not to make a number
   reachable. `metric_id`, `metric_rating` and `surface` are strings and
   belong on the DIMENSION list above — `surface` is registered, the other two
   are in 0g.

   ⚠️ **`FCP` is NOT emitted, and any list saying otherwise is wrong.**
   `METRIC_HANDLER_NAMES` in `web-vitals-rum.ts` is `['onCLS', 'onINP',
   'onLCP', 'onTTFB']` — four, deliberately. The live property agrees exactly:
   `CLS`, `INP`, `LCP` and `TTFB` appear in Admin → Events → Recent events and
   `FCP` does not. Registering anything "for FCP" buys a permanently empty
   report.

0c. ✅ **DONE 2026-08-20** — all three verified on the property 2026-08-24,
   which means the "before the first ad runs" deadline was met and September
   signups will be attributable. ~~Register the three campaign dimensions~~
   (AGL-1731), all
   **event-scoped**, and do it BEFORE the first ad runs — an unregistered
   param is collected but not reportable, so the campaign would be on every
   hit and in no report:

   | Dimension name  | Event parameter   | Why                                                          |
   | --------------- | ----------------- | ------------------------------------------------------------ |
   | Campaign source | `campaign_source` | Which channel bought the signup — the axis spend is judged on |
   | Campaign medium | `campaign_medium` | `cpc` vs `email` vs `referral`                                |
   | Campaign name   | `campaign_name`   | Which push, so two campaigns can be compared                  |

   **AGL-1579 adds nothing to this list.** Docs pageviews use only built-in
   dimensions, and the `click` events it produces come from GA4's enhanced
   measurement, whose `link_domain` / `link_id` are the same two params already
   queued above. `surface` will not carry the value `docs` until the shared
   listener can actually be installed there — see decision 7.

   `login` needs nothing new — `method` is already registered, and `sso` is a
   new VALUE of it, not a new dimension.

0b. ✅ **DONE 2026-08-17** — all three verified on the property 2026-08-24.
~~Register three more for the site-runtime events~~ (AGL-1591), all
**event-scoped**:

| Dimension name    | Event parameter     | Why                                                                                                     |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| Experiment id     | `experiment_id`     | Which experiment — without it every exposure is one undifferentiated count                              |
| Variant id        | `variant_id`        | **The axis the whole event exists for**: exposures and conversions are only meaningful split by variant |
| Experiment action | `experiment_action` | `exposure` vs `conversion` — the numerator and the denominator                                          |

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

0f. **Three money paths send nothing at all**, found in the 2026-08-20 audit.
   Ranked, because they are not the same kind of gap:

   - **A paid BOOKING is invisible in both properties.** `libs/plugins/bookings`
     contains **zero** analytics calls of any kind — no `trackEvent`, no
     `sendGa4*`, no `readGaClientId`. Its webhook computes the real money
     (`amount_total` → `paidAmountCents`, `server/billing-webhook.ts`) and
     spends it on a contact record and a confirmation email. This is the one
     that is a genuine hole rather than a limit: bookings is a September
     revenue line, and the storefront pattern next door
     (`use-storefront-purchase-event.ts` + `/api/commerce/order-analytics`)
     already shows how a merchant-property `purchase` gets sent from the
     confirmation screen. **Needs a decision before it can be built**: whose
     property, and whether the platform fee is reported the marketplace way
     (net, to ours) or the storefront way (gross, to the merchant's).
   - **A storefront REFUND is not sent.** `commerce/src/lib/server/refund.ts`
     has no GA call, so a merchant's GA revenue only ever goes up — the
     one-directional problem AGL-1850 fixed for subscriptions and marketplace.
     **This one is blocked, not forgotten**: the storefront `purchase` is
     client-side because the hit belongs in the MERCHANT's property, and a
     refund has no browser to send from. It needs a per-host Measurement
     Protocol secret, the same missing thing that keeps storefront RENEWALS
     dark. Do not "fix" it by sending the refund to our property; that would
     subtract a merchant's refund from Aglyn's revenue.
   - **The console's `begin_checkout` `value` is a source-code constant.** It
     is derived from `PLAN_PRICING` in `plan-entitlements.ts`, not from a
     Stripe Price lookup, so if the two ever diverge the event lies with no
     symptom. Acceptable while pricing is frozen for Sept 1 and the table IS
     the source of truth; revisit the moment a price is changed in Stripe
     first. `purchase` is unaffected — it reads `amount_paid` off the invoice.

0g. ✅ **DONE 2026-08-24** — all 12 dimensions and all 3 metrics below were
   registered at 06:19–06:27 GMT-5 and counted off the live property that
   afternoon. Kept for the reasoning, and for the two traps it records (the
   `interval`/`billing_interval` collision, and numbers belonging in the metric
   registry). ~~**Two whole event families carry params on no registration
   list**~~, so
   they ~~currently~~ *used to* arrive as undifferentiated counts — the same
   failure mode item 0 describes, one level larger. Found 2026-08-20 by diffing
   the fired params against every list above:

   Re-derived against the live property 2026-08-24: `surface` was on this
   list and is in fact **registered**, so the real total is **15**, not 16.
   This is now the complete outstanding set — the click-list, in order.

   **Custom dimensions** — Admin → Data display → Custom definitions →
   *Custom dimensions* → Create, all **Event**-scoped (12; takes 18/50 → 30/50):

   | Dimension name   | Event parameter    | Fired by                                  | Why |
   | ---------------- | ------------------ | ----------------------------------------- | --- |
   | Metric rating    | `metric_rating`    | CWV (AGL-1642)                            | `good`/`needs-improvement`/`poor` — **the entire point of RUM**, and readable without percentile math |
   | Metric id        | `metric_id`        | CWV (AGL-1642)                            | Per-pageview dedup/grouping key |
   | Churn reason     | `reason`           | `churn_survey_submitted`                  | **Why they left** — the one question the survey exists to ask |
   | From plan        | `from_plan`        | `downsell_accepted`, `plan_downgrade_scheduled`, `plan_upgraded` | The tier left — one dimension serves all three events |
   | To plan          | `to_plan`          | same three                                | The tier taken; the pair is the whole movement |
   | Funnel completed | `funnel_completed` | `cancellation_completed`                  | Separates surveyed departures from support/dashboard ones |
   | Billing interval (plan change) | `interval` | `plan_downgrade_scheduled`, `plan_upgraded` | Cadence of the new plan. NOTE it is `interval`, **not** the already-registered `billing_interval` — a different param name, so it needs its own dimension |
   | Effective at     | `effective_at`     | `plan_downgrade_scheduled`                | Decision date vs effect date — the window a save is still possible in |
   | Assist tier      | `tier`             | `assistant_message_sent`                  | `free` vs `entitled` |
   | Assist grounded  | `grounded`         | `assistant_message_sent`                  | Ungrounded questions at volume ARE the docs-gap signal |
   | Assist feedback  | `feedback`         | `assistant_feedback`                      | `up`/`down` — otherwise thumbs are one undifferentiated count |
   | Assist action    | `action`           | `assistant_proposal_shown`/`_confirmed`   | The shown-to-confirmed ratio per action; a ratio near 1 means the confirm gate is a speed bump |

   **Custom metrics** — same screen, *Custom metrics* tab, **Event**-scoped,
   unit **Standard** (3; takes 2/50 → 5/50):

   | Metric name      | Event parameter   | Why |
   | ---------------- | ----------------- | --- |
   | Percent off      | `percent_off`     | The discount a save was bought with |
   | Duration months  | `duration_months` | How long that discount runs — with `percent_off`, the cost of the save |
   | Metric delta     | `metric_delta`    | Lowest priority — already readable as GA4's built-in Event value (see 0e) |

   `percent_off` and `duration_months` are NUMBERS — custom **metrics**, like
   `tenure_days`, not dimensions; a save recorded without an averageable price
   reads as free, which is the exact thing AGL-1620 reported them to prevent.
   `grounded` and `funnel_completed` are booleans and are **dimensions**: GA
   reports them as the strings `true`/`false`, which is a breakdown, not a
   number to average.

   The dimension quota is **50 event-scoped** against 18 used, and the metric
   quota 50 against 2, so this is a clicking job rather than a prioritization
   one — everything above fits with 20 dimension slots still spare.
   Register nothing speculatively: an unregistered param is still COLLECTED,
   so registration can wait for the question, but the answer is unavailable for
   the period before it — GA does not backfill a dimension.

   ⚠️ **Ordering is not cosmetic.** `metric_rating` and the four retention
   params are the ones whose events are firing TODAY; the Assist four fire
   only where Assist is used. Every day a param is unregistered is a day of
   that breakdown lost permanently, so register top-down.

1. **Mark the remaining key events.** Admin → Events → _Mark as key event_.
   Re-read from the property 2026-08-24: **`sign_up`, `purchase`,
   `select_content` and `site_published` are already marked.** GA will not let
   an event be marked **until it has been seen at least once**, so the rest
   split by whether the property has seen them:

   - ✅ **`generate_lead` was marked 2026-08-24** (change history: `Key event
     settings / Modified`, 06:29 GMT-5). The **Key events** tab now reads 5 of
     5: `generate_lead`, `purchase`, `select_content`, `sign_up`,
     `site_published`.
   - **`begin_checkout` and `stripe_connected` still cannot be** — re-read from
     Admin → Events → *Recent events* on 2026-08-24: the property has seen **19**
     event names in the last 28 days (`click`, `CLS`, `first_visit`,
     `generate_lead`, `INP`, `LCP`, `login`, `page_view`, `purchase`,
     `screen_view`, `scroll`, `select_content`, `session_start`, `sign_up`,
     `site_published`, `subscription_cancelled`, `TTFB`, `user_engagement`,
     `view_search_results`) and neither of those two is among them. Re-check
     after the first paid beta checkout and the first merchant Connect
     onboarding; this is a sweep to run a few days into beta, not now.

   > 🟢 **Note what that 19-event list independently proves:** `purchase` and
   > `subscription_cancelled` are **server-only** events sent by the Measurement
   > Protocol, and both have been received. The transport is live on the running
   > lambdas — no further env-var archaeology is warranted, and `FCP` is absent
   > exactly as `METRIC_HANDLER_NAMES` predicts.

   Until marked they are ordinary events and appear as conversions nowhere.

   The AGL-1562 additions join that queue. `select_content` and `click` have
   never been seen by the property — they had no call sites until now — so
   neither can be marked until the first real click on a published tenant
   page; `select_content` is the one worth marking (it is the top-of-funnel
   micro-conversion), `click` is engagement and is better left ordinary.
   `login` is not new to GA, but `method: 'sso'` is a new VALUE and only
   appears in the `method` breakdown after the first enterprise sign-in.

2. **Create `GA4_API_SECRET`** — Admin → Data streams → the stream → _Measurement
   Protocol API secrets_ → Create. Then set it, plus `GA4_MEASUREMENT_ID`
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

   | Variable             | Actually exists?                                                                          | Reaches a deployment?                                                        |
   | -------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
   | `GA4_API_SECRET`     | **Yes** — a team-level _shared_ variable, created 2026-08-14T06:25:59Z, all three targets | **No.** Its `projectId` array is **empty**, so it is linked to zero projects |
   | `GA4_MEASUREMENT_ID` | **No** — absent from the shared set and from both projects' own environments              | No                                                                           |

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
   actions, both in the click-list on AGL-1637.

   #### ✅ RESOLVED 2026-08-17 — everything above this line is HISTORY

   > ⚠️ **Read this before quoting the table above.** The 2026-08-14 verdict is
   > kept for the lesson (a shared variable linked to zero projects reads as
   > present and reaches nothing), **not as current state**. It has since been
   > fixed, and the stale table has already manufactured one false finding — a
   > 2026-08-19 smoke pass concluded "every server-side event is dead in
   > production" off these lines alone, four days after the flip landed.
   >
   > **Verified 2026-08-19 against `GET /v13/deployments/{id}`**, which returns
   > the env KEY list actually baked into a deployment. `GA4_API_SECRET` **and**
   > `GA4_MEASUREMENT_ID` are present on the current production deployment of
   > **all three** projects — `aglyn-console`, `aglyn-tenant` and `aglyn-docs`.
   >
   > Negative control, same method, same project (`aglyn-console`):
   >
   > | Deployment                    | Created (UTC)    | GA4 keys                               |
   > | ----------------------------- | ---------------- | -------------------------------------- |
   > | `dpl_BFaD8SRzhx…` (#848)      | 2026-08-14 07:03 | **none**                               |
   > | `dpl_Cw6WY8Esd…` (#853)       | 2026-08-17 12:15 | `GA4_API_SECRET`, `GA4_MEASUREMENT_ID` |
   > | `dpl_HxSv1gGEt…` (#859)       | 2026-08-18 06:39 | both                                   |
   > | `dpl_DQW8oCPkR…` (#862, live) | 2026-08-19 01:03 | both                                   |
   >
   > So the transport is LIVE and the flip is dated: **2026-08-17 12:15 UTC**.
   > A server-side event that does not appear in GA4 today is no longer
   > explained by credentials, and must not be written off as "the transport is
   > dead" — look at dimension registration (AGL-1637 item 3) instead.
   >
   > **`vercel env ls` still cannot answer this question, and neither can the
   > project's env list** — only the deployment's own key list proves what a
   > running lambda actually has. Ask the deployment, and always diff against an
   > older one as a negative control.

   #### `DOCS_GA_TRACKING_ID` — created and deployed 2026-08-24 ✅

   Re-confirmed in a browser on 2026-08-24 while verifying AGL-1582:
   `docs.aglyn.com` now loads the tag and configs `G-YW5PG16YTM` with
   `anonymize_ip: true`, and the internal-traffic snippet's
   `gtag('set', {traffic_type:'internal'})` sits at `dataLayer` index 3 —
   after `content_group: 'docs'`, before `config`, which is the order it has
   to be in. AGL-1637 item 2b is **done**; any list still showing it open is
   stale.

   Verified 2026-08-19: the live `aglyn-docs` production deployment
   (`dpl_DEMJtAphsh…`) carried `GA4_API_SECRET` and `GA4_MEASUREMENT_ID` but
   **not** `DOCS_GA_TRACKING_ID`. Since AGL-2124 the docs gtag preset is
   `docsGaTrackingId ? {…} : undefined`, so docs.aglyn.com loaded no GA tag at
   all.

   ⚠️ **This section previously recorded that the variable was set to
   `G-YW5PG16YTM` on 2026-08-23. That was wrong, and it went unchallenged for a
   day.** Measured on
   **2026-08-24**: `aglyn-docs` had **zero** project-level environment variables,
   and `DOCS_GA_TRACKING_ID` was absent from the team shared set as well (15
   shared keys, checked via `GET /v1/env` — the source `vercel env ls` cannot
   see). The variable had never existed on any scope, so `docs.aglyn.com` served
   no GA tag at all for the whole period this file claimed it was configured.

   Created **2026-08-24** as `encrypted` (**not** `sensitive` — a GA4 measurement
   id is public and ships in client JS; marking it sensitive would only destroy
   verifiability) on all three targets, then redeployed. Docusaurus bakes env
   vars into the static build, so the redeploy was required, not optional.

   Verified on the live page rather than from the dashboard — `gtag/js?id=G-YW5PG16YTM`
   is present and `dataLayer` reads `consent default` → `consent default (EEA/UK)`
   → `set content_group` → `js` → `config`, which is the AGL-1597 ordering holding.

   **The lesson, since this file was the thing that lied:** a written record that
   an env var was set is not evidence it was set. Read the wire.

   ⚠️ **That deploy was, until AGL-1597's second pass, going to publish an
   ungated tag.** The consent-mode default was present in the head but emitted
   AFTER the gtag preset's `config`, which makes it a no-op — proven on the
   wire: the first `page_view` carried no `gcs` parameter and set `_ga`. It was
   invisible precisely because the id was unset: with no preset output, our
   snippet was the only thing in the head and appeared first. Setting the id is
   what exposed it. Fixed by moving the bootstrap into `ssrTemplate`, which is
   the only lever that lands ahead of a preset plugin's tags; the same pageview
   now carries `gcs=G101`.

3. 🚨 **The published privacy policy says we run no third-party analytics.**
   `apps/console/constants/legal/v4/privacy.txt`, under _"Sale"/"sharing" under
   U.S. state laws_: "We use no advertising technology and no third-party
   analytics on our websites or the console" — identical wording in v2, v3 and
   v4. GA4 is third-party analytics, and it has been live on `app.aglyn.com`
   and `aglyn.com` since AGL-118, so **the sentence is already inaccurate for
   two surfaces before AGL-1579 adds a third.** Section 4 of the same document
   takes the opposite position ("cookies and similar technologies for
   authentication, security, preferences, and analytics"), so it contradicts
   itself independently of docs. It reads like it was drafted to mean "no
   adtech", which is true, but that is not what it says. **This is a legal-copy
   decision for the account owner, not an engineering one** — and it should be settled
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
   and the hashed v4 snapshot must be re-captured _after_ it, never before: a
   snapshot is evidence of what a user was shown, so writing one for text that
   is not live would be its own false record. v4 is still unpromoted, so this
   folds into the existing v4 snapshot rather than forcing a v5 and a global
   clickwrap re-acceptance.

   **The Cookie Policy contradicts itself the same way, and worse.** Live at
   `aglyn.com/legal/cookies`: §2 _Analytics / performance_ correctly discloses
   Google Analytics, while §4 _Your choices_ states "we do not set analytics or
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

| Var                                   | Where                            | Purpose                                                                                                                      | State (**2026-08-19**, read off the live deployments)                                                             |
| ------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GA4_MEASUREMENT_ID`                  | Vercel production                | Target property for server-side `purchase`, `refund`, `subscription_cancelled` and `site_published`; value is `G-YW5PG16YTM` | ✅ **present on `aglyn-console`, `aglyn-tenant` and `aglyn-docs`** since 2026-08-17 12:15 UTC                     |
| `GA4_API_SECRET`                      | Vercel production, **sensitive** | Measurement Protocol auth                                                                                                    | ✅ **present on all three** since 2026-08-17 12:15 UTC (was a shared variable linked to zero projects until then) |
| `DOCS_GA_TRACKING_ID`                 | `aglyn-docs`, all three targets  | Loads the docs gtag at all — `undefined` means **no tag** (AGL-2124)                                                         | ✅ **created 2026-08-24** as `encrypted`, `G-YW5PG16YTM`, and confirmed live on the wire. The prior "set 2026-08-23" entry was **false** — the var had never existed on any scope. |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | already set                      | Console's client-side GA + `client_id` capture                                                                               | ✅ set, `G-YW5PG16YTM`                                                                                            |

> The dated 2026-08-14 verdict earlier in this file describes the **pre-flip**
> state and is kept only for its lesson. Do not quote it as current — it has
> already caused one smoke pass to declare the transport dead four days after
> it was fixed.

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
