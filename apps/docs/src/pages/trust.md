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
of intent, and we would rather say so than imply an assurance programme that
does not exist.

## Where data lives

| Subprocessor | Purpose |
| --- | --- |
| **Google Cloud / Firebase** | Primary datastore (Firestore), authentication, file storage. US region. |
| **Google reCAPTCHA** | App Check attestation for Firebase client SDK traffic (invisible v3). Not a user-facing challenge, and not used on site forms. |
| **Google Analytics** | Product and site analytics for `aglyn.com`, the console and these docs — a single GA4 property. Configured for measurement only: Google Signals off, ads personalization disabled in every region, no user-provided data collection, email redaction on, 14-month retention. The three advertising consent signals (`ad_storage`, `ad_user_data`, `ad_personalization`) are denied from the first hit on all three surfaces, and every event we send server-side asserts `non_personalized_ads`. Those denials are worth separating: on the console and on these docs they are typed constants, so widening them takes a code change; on `aglyn.com` they follow the site's own consent configuration, and were last checked against the live page on 20 August 2026. The remaining settings — Signals, ads personalization, user-provided data collection, email redaction, the retention period — are GA property configuration, set and verified by hand in the Google Analytics console on 14 August 2026. Nothing in our build re-checks those five, so read them as a statement about how the property was configured rather than as a control we can demonstrate on demand. Whether this property is linked to Google Ads is stated in the row below, so there is one place to change and not two. |
| **Google Ads** | Advertising for Aglyn's own site: buying clicks to `aglyn.com` and, once conversion measurement is turned on, counting which of them become signups. It processes no customer data — this is an advertising account we hold, not a subprocessor in the DPA sense, and it is listed here because a reviewer should not have to discover it somewhere else. As configured today: no Aglyn surface loads a Google Ads tag, the account is not linked to the GA4 property above, and enhanced conversions is off. We expect all three to change, which is why they are written as current configuration and not as an assurance. **This row used to end with an ordering argument that no longer holds, and replacing it rather than patching it is the honest move.** It said the [Privacy Policy](https://aglyn.com/legal/privacy) stated we use no advertising technology, and that the policy therefore had to be republished before any tag shipped. That republication has since happened: §3 of the published policy now describes cross-context behavioural advertising as U.S. state privacy laws define it, names Google and Meta, records that it is consent-gated in the EU, the UK and any region we cannot determine, and commits us to honouring Global Privacy Control. So the gate that sentence described is not pending — it is passed, and what remains is the register rather than the policy. See the paragraph below the table. |
| **Vercel** | Application hosting and CDN for the console, published sites and docs. |
| **Stripe** | Payments. Card details go directly to Stripe; Aglyn never receives or stores a card number. |
| **Resend** | Transactional email delivery. |

The authoritative versions are published, not gated: the
[Data Processing Addendum](https://aglyn.com/legal/dpa) and the
[subprocessor list](https://aglyn.com/legal/subprocessors). Read them without
asking anyone. This table is the engineering view and may lag them, so where
the two disagree the published list is the one that governs.

The lag has run the other way at least once, so it is worth saying which
direction it is running now, and there are two gaps rather than one.

The **Google Ads** row above is not on the published list yet, because the
account exists and nothing is wired to it. A published register is meant to be
exhaustive, and "we told you first on the engineering page" is not a defence
for a register that is missing a row — so if that row is still absent from the
published list once a tag is live, the register is wrong and we would like to
hear about it at `privacy@aglyn.com`.

The second gap runs the opposite way, and this table is the one at fault. The
platform can load a **Meta Pixel** on a surface where a pixel id is configured
— it is a first-class advertising vendor in our own code, consent-gated, with
its `_fbp`/`_fbc` cookies named in our cookie inventory and a documented
teardown path — and the Privacy Policy names Meta. This table has no Meta row.
It is listed here now; whether a pixel is configured on any Aglyn surface is a
setting rather than something this page can demonstrate, which is exactly why
the capability is disclosed instead of the rollout state.

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
