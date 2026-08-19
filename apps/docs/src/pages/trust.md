---
title: Trust & security
description: How Aglyn handles security, data and availability — including what we do not yet have.
---

# Trust & security

Written for the security review that precedes an enterprise purchase. Every
control below exists in the product today. The section on what we **do not**
have is deliberately first, because that is the part a reviewer needs and the
part a page like this usually buries.

_Last reviewed 14 August 2026._

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
| **Google Analytics** | Product and site analytics for `aglyn.com`, the console and these docs — a single GA4 property. Configured for measurement only: Google Signals off, ads personalization disabled in every region, no Google Ads account linked, no user-provided data collection, email redaction on, 14-month retention. |
| **Vercel** | Application hosting and CDN for the console, published sites and docs. |
| **Stripe** | Payments. Card details go directly to Stripe; Aglyn never receives or stores a card number. |
| **Resend** | Transactional email delivery. |

The authoritative versions are published, not gated: the
[Data Processing Addendum](https://aglyn.com/legal/dpa) and the
[subprocessor list](https://aglyn.com/legal/subprocessors). Read them without
asking anyone. This table is the engineering view and may lag them, so where
the two disagree the published list is the one that governs.

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
  closed when the signing key is absent.
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
