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
| `site_published` | `apps/console/constants/screen-publishing.ts` (`publishScreenRoute` — the routing-map primitive every publish surface passes through) and the besigner's two publish handlers; **server-side** from `libs/tenant/runtime/…/apply-publish-schedule.ts` when a due schedule registers a NEW routing entry (AGL-1589) |
| `stripe_connected` | `libs/plugins/commerce/.../payments-settings-card.component.tsx`; `apps/console/components/org-seller-panel.component.tsx` |
| `begin_checkout` | `apps/console/app/(app)/[orgSlug]/billing/page.tsx` |
| `purchase` | `libs/tenant/data/admin/src/lib/server/ga4-measurement-protocol.ts`, called from the platform webhook's `invoice.paid` branch and from the marketplace webhook handler |

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

   **AGL-1579 adds nothing to this list.** Docs pageviews use only built-in
   dimensions, and the `click` events it produces come from GA4's enhanced
   measurement, whose `link_domain` / `link_id` are the same two params already
   queued above. `surface` will not carry the value `docs` until the shared
   listener can actually be installed there — see decision 7.

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

   **Both projects, not one (AGL-1589).** `purchase` is sent by the console and
   by the marketplace webhook; `site_published` is sent by the TENANT, from the
   publish-schedule beat. Verified 2026-08-14 with `vercel env ls production`:
   neither variable is listed on **aglyn-tenant**, and neither is listed on
   **aglyn-console** either — so unless they are team-level shared variables
   (which that listing does not show), the server-side `purchase` is also
   no-opping in production today. Worth checking in the dashboard before
   assuming any server-side event is arriving.
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
4. **Enhanced measurement's Site search on docs is unverified.** Docusaurus's
   local search navigates to `/search?q=…`, and `q` is one of the query keys
   enhanced measurement watches, so `view_search_results` may already be
   arriving for free. If it is, note that **`search_term` is untyped visitor
   input** and does not pass `sanitizeEventParams` — it never touches our code.
   Confirm what it collects before registering it as a dimension.

### Environment variables

| Var | Where | Purpose |
| --- | --- | --- |
| `GA4_MEASUREMENT_ID` | Vercel production (console **and tenant**) | Target property for server-side `purchase` and `site_published` |
| `GA4_API_SECRET` | Vercel production (console **and tenant**), **sensitive** | Measurement Protocol auth |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | already set | Console's client-side GA + `client_id` capture |

Documented in `apps/console/.env.development.local.example`.
