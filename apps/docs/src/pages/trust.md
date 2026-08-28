---
title: Trust & security
description: How Aglyn handles security, data and availability — including what we do not yet have.
---

# Trust & security

Written for the security review that precedes an enterprise purchase. Every
control below exists in the product today. The section on what we **do not**
have is deliberately first, because that is the part a reviewer needs and the
part a page like this usually buries.

_Last reviewed 24 August 2026._

## What we do not have

Being straight about this is faster for both sides than having it surface in a
questionnaire three weeks in.

| | |
| --- | --- |
| **SOC 2** | No report, and no audit in progress. |
| **ISO 27001 / HIPAA / FedRAMP** | None. |
| **Third-party penetration test** | Not yet commissioned. |
| **Bug bounty** | None. Security reports still get read — see below. |
| **Published uptime SLA** | No committed percentage. We measure availability and will commit to a number backed by data rather than one chosen to close a deal. Live status: [/status](/status). |
| **Formal 24/7 on-call rotation** | No. Support response targets by plan are documented in [Support & community](/workspace-and-billing/support-and-community). |

Aglyn is a small team. Several of the above are a function of size rather than
of intent, and we would rather say so than imply an assurance program that
does not exist.

## Where data lives

| Subprocessor | Purpose |
| --- | --- |
| **Google Cloud / Firebase** | Primary datastore (Firestore), authentication, file storage. US region. |
| **Google reCAPTCHA** | App Check attestation for Firebase client SDK traffic (invisible v3). Not a user-facing challenge, and not used on site forms. |
| **Google Analytics** | Product and site analytics for `aglyn.com`, the console and these docs — a single GA4 property. Its advertising features are on, and that is the position rather than an oversight: Google Signals is enabled in all 307 regions, ads personalization in all 307, user-provided data collection is on, and the property is linked to our Google Ads account with personalized advertising enabled on that link — so what this property collects also builds and exports advertising audiences. Email redaction is on and retention is 14 months. Read as a whole: Aglyn advertises, remarkets, retargets and measures across all three of its own surfaces, and the line we hold is that we do not **sell** the data. That is a narrower promise than "we do not track", and it is meant to be read as the narrower one. Those settings were read from the GA4 admin on 27 August 2026. **The three advertising consent signals (`ad_storage`, `ad_user_data`, `ad_personalization`) are no longer denied by default, and this row used to say that they were on all three surfaces.** What replaced that one claim differs by surface, so it is set out in [Advertising tags, per surface](#advertising-tags-per-surface) below rather than compressed back into a single sentence here. Every event we send server-side still asserts `non_personalized_ads`, which is a property of the server-side Measurement Protocol path alone and says nothing about what a tag in a browser does. Nothing in our build re-checks them, so read them as a statement about how the property is configured rather than as a control we can demonstrate on demand. The Google Ads row below carries the rest of that account's configuration. |
| **Google Ads** | Advertising for Aglyn's own site: buying clicks to `aglyn.com` and, once conversion measurement is turned on, counting which of them become signups. It holds none of the content or records we process on customers' behalf, but it is no longer true to say it learns nothing about our customers: its tag runs on signed-in console pages, and audiences built in the GA4 property linked to it are exported to it. It belongs on the published register alongside Meta and LinkedIn rather than being argued out of it on a definitional point — see the paragraph below for where that stands. As configured today: a Google Ads tag can load on all three Aglyn surfaces under the gates set out below the table; the account **is** linked to the GA4 property above, with personalized advertising enabled on that link; and enhanced conversions is still off. The first two of those were the opposite when this row was written, which is why they are kept as current configuration and not as an assurance. **This row used to end with an ordering argument that no longer holds, and replacing it rather than patching it is the honest move.** It said the [Privacy Policy](https://aglyn.com/legal/privacy) stated we use no advertising technology, and that the policy therefore had to be republished before any tag shipped. That republication has since happened: §3 of the published policy now describes cross-context behavioral advertising as U.S. state privacy laws define it, names Google, Meta and LinkedIn, records that it is consent-gated in the EU, the UK and any region we cannot determine, and commits us to honoring Global Privacy Control. So the gate that sentence described is not pending — it is passed, and what remains is the register rather than the policy. See the paragraph below the table. |
| **Meta** | The Meta Pixel, on all three Aglyn surfaces, under the gates set out below the table. It receives page views and conversion events with the identifiers the pixel sets, and on the console those page views come from a signed-in account holder. It is on the published [subprocessor list](https://aglyn.com/legal/subprocessors), where its entry still describes it as something a site owner turns on for their own site — see the paragraph below. |
| **LinkedIn** | The LinkedIn Insight Tag, on the same three surfaces and under the same gates, with the same entry problem on the published list. One difference worth knowing: LinkedIn also sets cookies on its own domain, which a page on our origin can neither read nor clear, so a withdrawal made here cannot remove those and browser controls are the only route to them. |
| **Vercel** | Application hosting and CDN for the console, published sites and docs. |
| **Stripe** | Payments. Card details go directly to Stripe; Aglyn never receives or stores a card number. |
| **Resend** | Transactional email delivery. |

The authoritative versions are published, not gated: the
[Data Processing Addendum](https://aglyn.com/legal/dpa) and the
[subprocessor list](https://aglyn.com/legal/subprocessors). Read them without
asking anyone. This table is the engineering view and may lag them, so where
the two disagree the published list is the one that governs.

The lag has run the other way at least once, so it is worth saying which
direction it is running now. Both of the gaps this section used to describe
have moved, and neither moved the way we expected.

The **Meta** gap is closed in the direction that mattered. This table now
carries a Meta row and a LinkedIn one, and the published register names both.

The **Google Ads** gap is still open and is now worse than the bookkeeping
point it started as: the published register has no Google Ads row, and a Google
Ads tag can now load on all three of our surfaces. There is a second, narrower
gap in that same register — its Meta and LinkedIn entries describe those
vendors as something a site owner enables on their own site, which was true
when they were written and is no longer the whole picture, because both now
run on Aglyn's own surfaces as well. A published register is meant to be
exhaustive, and "we told you first on the engineering page" is not a defense
for a register that is missing a row. A Google Ads row and corrected Meta and
LinkedIn entries are drafted and awaiting publication. If you are reading this
and the published list still says otherwise, the register is wrong and we would
like to hear about it at `privacy@aglyn.com`.

### Advertising tags, per surface {#advertising-tags-per-surface}

Aglyn runs advertising tags on all three of its own surfaces: a Meta Pixel, a
Google Ads tag, a LinkedIn Insight Tag, and optionally a Google Tag Manager
container. A tag loads only where an account id is configured for that build,
and unset means nothing loads — which is how a self-hosted deployment runs none
of ours. Past that, the three surfaces gate them by three different mechanisms,
and the differences are large enough to be worth one at a time rather than a
single sentence covering all three.

- **`aglyn.com`** — the marketing site runs on the same consent gate we ship to
  customers, which is the strongest of the three: a per-visitor record, a region
  lookup, and a tag that never loads at all for a visitor without a grant. In
  the EU, the EEA, the UK and any region we cannot determine, nothing loads
  until the visitor accepts. Everywhere else an implied grant is recorded on the
  first visit and the tags run from that first paint, with "Your Privacy
  Choices" standing as the opt-out. Global Privacy Control is honored as an
  automatic opt-out under both postures.
- **The console (`app.aglyn.com`, `auth.aglyn.com`)** — the same posture, decided
  by the console's own machinery: a region endpoint, a prior-consent region set
  which for our own surfaces adds Switzerland to the EEA/UK one, GPC, and an
  explicit answer from the account menu or from the "Your Privacy Choices"
  control on the signed-out pages. Denied in those regions until the visitor
  accepts; granted on an implied record everywhere else. This includes the pages
  you use **while signed in**, which is the part of this page a customer should
  read twice — see below.
- **These docs (`docs.aglyn.com`)** — the weakest gate of the three, and the
  limit is worth stating because it cuts against us rather than for us. The docs
  site has no consent dialog and no region lookup of its own, so for Meta,
  LinkedIn and Google Ads it reads the console's consent record through a cookie
  shared across `aglyn.com` subdomains. **No record means no tags at all.** A
  reader who arrives from a search result and has never signed in to the console
  gets none of the three, which also caps how much of our docs traffic these
  tags can ever see. What this surface does declare for itself is a
  region-conditional Google Consent Mode default — granted outside the EEA, the
  UK and Switzerland, denied inside them — and that reaches the Google tags that
  read Consent Mode and nothing else does. A withdrawal made in the console
  reaches an already-open docs tab the next time that tab is looked at, not in
  the same instant.

**Signed-in console pages are included, and this is what that means if you are
a customer.** The console's tags are not confined to the sign-in and signup
pages; they run on the authenticated console too. An advertising tag reports
the address of the page it is on, and console addresses carry your
organization's slug, identify the site you are working in, and name the area of
the product you are in — billing, team, plugins, a site's settings. So Google,
Meta and LinkedIn can infer that your organization is an Aglyn customer, and
can see roughly which parts of the product your people use. That is a decision
taken deliberately, with that consequence understood, and it is written here
because a customer should not have to discover it by reading a network log. Two
things bound it, and neither is a promise about intent: the advertising grant is
yours to withdraw at any time from "Your Privacy Choices" in the console account
menu, which stops the tags on that pageview and clears the cookies we can reach;
and in the EU, the EEA, the UK and Switzerland nothing loads until you accept in
the first place.

## Hosts our customers choose, which are not on that list {#hosts-our-customers-choose-which-are-not-on-that-list}

The table above, and the published register it defers to, list the parties
**Aglyn** engages. There is a second set of recipients that a reviewer should
know about and that neither list can ever contain.

A site built on Aglyn can reference an image, stylesheet or font that lives
somewhere else — a URL pasted into a component or a post, a cover image, or a
`url(...)` an author writes in their own CSS. That is a deliberate feature of
the builder and we do not intend to remove it. Its consequence is worth stating
plainly: **we do not proxy those requests.** The visitor's browser fetches the
file from that host directly, so the host learns the visitor's IP address,
their browser user-agent and the address of the page they are on, and can set
its own cookies.

We do not choose those hosts and we cannot enumerate them — they are picked
per site by each site owner and can change with any edit — so they are not
Aglyn subprocessors and do not belong on Annex III. The site owner engaged
them and is the controller for their own visitors; the
[DPA](https://aglyn.com/legal/dpa) says so in contract terms, and the site
owner is responsible for naming them in their own privacy notice. The same
applies to a URL typed while editing in the console: it loads the same way for
anyone who opens that editor.

**A plugin can be the chooser instead of the site owner, and then that
paragraph does not hold.** An installed marketplace plugin may ship its own
stylesheet, which we render into the published page's own CSS — the same
unlayered slot a Custom HTML `css` block occupies, through the same scheme
filter. A `url(...)` in it reaches the visitor's browser by exactly the route
described above, except that the host was picked by the **plugin's publisher**,
on a site whose owner did not choose it and generally cannot see it. So we do
not put that one on the site owner to name: they could not enumerate it if they
tried. What stands behind it instead is narrower than "we reviewed it", and the
exact shape is worth having. Plugin code that can render on a published site
runs only on the staff-signed realm tier, so it needs a staff trust grant, its
bytes are pinned by SHA-256 and its signature is checked before it executes,
and staff can withdraw that version platform-wide at render time. Marketplace
review is the ordinary route to publishing a version but it is not a universal
guarantee — a publisher may install their own not-yet-reviewed build on their
own workspace. And none of it is a proxy: the request still travels from the
visitor's browser to the publisher's host. If you have installed a plugin and
want to know what it references, write to `privacy@aglyn.com` and we will tell
you what is in the version you are running.

What we do about it, written as current configuration rather than as an
assurance:

- The surfaces that put an author's URL into a page's own stylesheet — the
  Custom HTML block's CSS, `style` attributes inside it, and the Styles panel —
  accept only `https:`, `data:` and `blob:`. A refused reference is rewritten
  to `url(about:invalid)`, which loads nothing and leaves the surrounding CSS
  rule valid rather than corrupting it.
- A plugin's own stylesheet goes through that same filter, on the published
  page and in the editor canvas alike. The host is not restricted there either,
  and there it is the publisher's host rather than the site owner's.
- Markdown and post images, collection covers, event covers and the marketing
  popup refuse `http:` for the same reason.
- **The storefront image fields do not yet.** Product, cart, wishlist, related
  products and the product feed emit the stored string unchecked, so an
  `http:` URL entered there ships as typed. On an https page a browser blocks
  it as mixed content, but that is the browser's behaviour and not a control of
  ours. Closing this is open work; until it is closed, this is what those
  fields actually do.
- Published sites carry a **report-only** `img-src` policy, so off-site image
  loads are counted rather than blocked. It is report-only on purpose and will
  stay that way while the feature stands: an enforcing policy would silently
  blank images on sites that are already published, revoking a documented
  capability from customers with no error and no way for them to find out.

## Authentication

- **Firebase Authentication** for all accounts. Passwords are never stored by
  Aglyn in any form.
- **SAML SSO** for enterprise workspaces, via Google Cloud Identity Platform.
  Each SSO org gets its own isolated tenant pool, so its users are not
  enumerable from the shared project.
- **Email verification** is enforced before privileged actions, not merely
  encouraged.
- **Session cookies** are `HttpOnly`, `Secure`, `SameSite=Lax`, and scoped to
  the workspace domain. A session cookie is never readable by page JavaScript.
- **Staff impersonation** of a customer account is possible for support, is
  recorded on the session itself, and is surfaced in the UI while it is
  happening. It cannot be done silently.

## Authorization

- **Every read and write made from the browser is gated by Firestore security
  rules** — evaluated by Google's infrastructure, not by our application. A bug
  in our code cannot grant access the rules deny.
- Rules are **per document**, not per collection. Site collaborators scoped to
  one site cannot read another site's data, and that boundary is enforced at
  the database rather than in a UI filter.
- Server routes that use the Admin SDK — which bypasses rules by design —
  **re-check scope independently** before answering. A substantial part of the
  product runs on that path, so the ruleset is the authority over client
  traffic rather than a single chokepoint in front of everything.
- **Cloud Storage is a different shape.** Its ruleset denies direct client
  access outright; every legitimate file read or write goes through an Admin
  SDK route or a per-object download token. Nothing there is gated by rules
  because nothing there is permitted by rules.

## API surface

- State-changing API routes authenticate with a **short-lived Firebase ID token
  in an `Authorization: Bearer` header**, not with a cookie. Browsers never
  attach that header to a cross-site request, so those routes are not reachable
  by cross-site request forgery.
- The one cookie-authenticated endpoint (silent sign-in across workspace
  subdomains) returns its response with no permissive CORS header, so a
  cross-origin page cannot read it, and it refuses to answer on any hostname
  that is not a registered workspace.
- **Firebase App Check** (invisible reCAPTCHA v3) is enforced on **Firebase
  client SDK traffic** — Firestore reads and writes made from the browser, and
  Identity Platform — so that traffic must come from an attested app rather
  than a script holding a stolen key. It does **not** cover our own API routes:
  those run on the Admin SDK, which is outside the attestation boundary.
- **The public form-submission endpoint has no attestation and no CAPTCHA.** A
  published site's lead-capture form is open to the internet by design. What
  stands in front of it is a honeypot field, a durable per-IP rate limit, and a
  per-site ceiling that caps what a submission flood can add to your bill.
  Whether attestation belongs there is an open question we have not settled;
  until we do, this is what the endpoint actually has.
- **Rate limiting** is durable and shared across serverless instances —
  Firestore-backed, rather than per-instance memory that resets on every cold
  start — on the endpoints where a single success is expensive or the limit is
  a published number: sign-in and passkey flows, password reset, email
  verification, workspace creation, form submission, page-protection unlock,
  and the per-key quota on the public REST API. What remains on an in-process
  counter is the high-volume telemetry that carries no access: the analytics
  beacon and client error reports. If the durable store is unreachable the
  limiter degrades to that in-process counter rather than failing open, and
  records the degraded window so it can be reviewed afterwards.

## Customer data and deletion

- **Account closure is self-serve.** It requires re-authentication within the
  last five minutes and an explicit typed confirmation, and it refuses to
  proceed while the account still owns organizations — naming them, rather
  than failing opaquely.
- **Organization erasure** is a genuine recursive delete of documents, files
  and back-references, behind an explicit request and a seven-day hold so an
  accidental or malicious deletion can be reversed.
- **Audit logging** records administrative actions across roughly thirty write
  sites, including who acted, on what, and what changed.

## Third-party plugins

The marketplace runs third-party code. Most of it we treat as untrusted, and we
are explicit below about the tier that is not:

- **Sandboxed by default.** A plugin's UI executes in an iframe on a **separate
  origin** under a restrictive Content Security Policy, so it cannot reach the
  console's cookies or DOM. The console refuses to render a plugin at all if
  that origin is ever configured same-origin. Outbound network access is
  proxied through an allowlisted egress route that carries none of your
  credentials.
- **A staff-signed "realm" tier runs inside the application.** Plugins that
  register real components need the app's own realm, with the access that
  implies — so that tier is not sandboxed, and saying otherwise would be the
  more comfortable claim rather than the true one. It is gated on a staff trust
  grant plus an **Ed25519 signature** verified before execution, and it fails
  closed when the signing key is absent. The egress proxy in the bullet above
  is a property of the sandbox and does not extend to this tier: whatever a
  realm plugin's components and stylesheet reference is fetched by the
  visitor's own browser, as described under [Hosts our customers
  choose](#hosts-our-customers-choose-which-are-not-on-that-list).
- Every published version is **content-addressed by SHA-256**, and the hash is
  recomputed over the fetched bytes before they execute — on both tiers — so
  the running bytes are the reviewed bytes.
- Staff can **revoke or take down a plugin version platform-wide**, and that is
  enforced at render time on plugins already installed, not only against new
  ones. A review *rejection* is a weaker thing and we do not conflate them: it
  blocks new installs and leaves existing ones running.

## Availability

Live service status, checked from your browser: **[/status](/status)**.

The status page is served from a different deployment than the services it
reports on, so it stays up when they do not.

## Reporting a vulnerability

Email **security@aglyn.com** — or **help@aglyn.com** if that bounces — with
enough detail to reproduce. We will acknowledge, and we will tell you honestly
what we can fix and when.

We do not run a bug bounty and cannot offer payment. We also will not threaten
anyone who reports a problem in good faith.
