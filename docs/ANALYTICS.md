# Analytics — the GA4 event taxonomy

One taxonomy, two surfaces. This is the map; the code is
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
| **Aglyn — Platform** (302497406) | `G-YW5PG16YTM` | **the canonical property.** Both `app.aglyn.com` and `aglyn.com`, via one web stream, **ID 3230351080**. Linked to Firebase project `aglyn-main` (app "Aglyn - App Console"). Live since AGL-118. Renamed from "Aglyn — Console" on consolidation. |
| Aglyn — Marketing (archived 2026-08-14, pre-consolidation) (257010770) | `G-BQ49X14QCD`, stream 2220379072 | retired 2026-08-14. **Do not delete** — it holds the only copy of its own history **and is the Analytics link for the Firebase project `aglyn-app`** (tagged Prod). Deleting it would sever that link. |
| aglyn-f375b (284263481) | — | stray, **zero data streams**, so no measurement id and no traffic. No Firebase project of that name exists. Retirement candidate; see AGL-1581. |

`GA4_MEASUREMENT_ID` / `GA4_API_SECRET` and any Measurement Protocol secret
belong to **stream 3230351080 on property 302497406** — secrets are per-stream
and do not migrate.

**One property, one stream, both domains** (AGL-1559, done 2026-08-14). A single
measurement id serves both surfaces, because the `_gl` linker is honoured
per-tag: two ids would give a visitor a fresh `client_id` on the domain hop.
Separate the surfaces in reports with the built-in **Hostname** dimension.

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
| **`site_published`** | Custom | Console | `first_publish?` | **Activation — "% who publish a site"** |
| `stripe_connected` | Custom | Console | — | **Activation — "% who connect Stripe"** |
| `begin_checkout` | Reserved | Console | `currency`, `value`, `items`, `billing_interval` | Revenue — checkout funnel |
| `purchase` | Reserved | **Server** | `transaction_id`, `currency`, `value`, `items`, `billing_interval` | Revenue — paid conversions, ARPA, annual mix |

`method` values: `password`, `google_popup`, `google_redirect`, `google_signin`
(the AGL-1497 door where "Sign in with Google" created the account and bounced
the person to `/signup`), plus `passkey` and `sso` for `login`.

`item_category` separates the two revenue lines: `subscription` and
`marketplace`.

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
| `site_published` | `apps/console/constants/screen-publishing.ts` (`publishScreenRoute` — the routing-map primitive every publish surface passes through) and the besigner's two publish handlers |
| `stripe_connected` | `libs/plugins/commerce/.../payments-settings-card.component.tsx`; `apps/console/components/org-seller-panel.component.tsx` |
| `begin_checkout` | `apps/console/app/(app)/[orgSlug]/billing/page.tsx` |
| `purchase` | `libs/tenant/data/admin/src/lib/server/ga4-measurement-protocol.ts`, called from the platform webhook's `invoice.paid` branch and from the marketplace webhook handler |

---

## Five decisions worth knowing

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

> 🚨 **`purchase` stays dark until AGL-1551 is fixed.** The live platform
> webhook currently rejects **every** Stripe delivery with `400 Invalid
> signature` (100% error rate). The code below it is correct and will start
> reporting the moment the signing secret is fixed — but no revenue reaches GA
> before then.

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

### 5. A scheduled publish is not an activation, and cannot be

`applyDuePublishSchedule` runs from a cron beat and from ISR revalidation with
no browser present, so client-side GA cannot see it — the obvious fix is to
send `site_published` over the Measurement Protocol like `purchase`. It is not
sent, because it would not be true.

A due publish writes the version pointer and the schedule status and **never
touches `hosts/{hostId}.screens`**, the routing map that decides which paths
exist. So a scheduled publish can only ever swap which saved version an
already-live route serves — a content update — and `site_published` counts a
route GOING LIVE, not a republish. Sending it would let one activated org look
like many.

The gap AGL-1562 worried about (a first publish that is scheduled rather than
clicked, going uncounted) cannot occur for the same reason: nothing in that
path makes an unpublished screen reachable. `apply-publish-schedule.spec.ts`
pins it, so if the executor ever learns to register a route, the case goes red
and the analytics decision gets made again with it.

---

## GA UI configuration

Done 2026-08-14 (AGL-1559) on property 302497406:

- cross-domain measurement and the unwanted-referrals list (above);
- **custom dimensions registered**, all event-scoped: `method`, `form_name`,
  `form_location`, `billing_interval`, `first_publish`. **A param that is not
  registered is collected but not reportable** — it simply does not appear as a
  breakdown, which reads exactly like the event not carrying it;
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

   `login` needs nothing new — `method` is already registered, and `sso` is a
   new VALUE of it, not a new dimension.

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

### Environment variables

| Var | Where | Purpose |
| --- | --- | --- |
| `GA4_MEASUREMENT_ID` | Vercel production (console) | Target property for server-side `purchase` |
| `GA4_API_SECRET` | Vercel production (console), **sensitive** | Measurement Protocol auth |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | already set | Console's client-side GA + `client_id` capture |

Documented in `apps/console/.env.development.local.example`.
