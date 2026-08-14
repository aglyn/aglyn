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
| **Google reCAPTCHA** | Bot protection on authentication and data access, via Firebase App Check. |
| **Google Analytics** | Product and site analytics for `aglyn.com`, the console and these docs — a single GA4 property. Configured for measurement only: Google Signals off, ads personalization disabled in every region, no Google Ads account linked, no user-provided data collection, email redaction on, 14-month retention. |
| **Vercel** | Application hosting and CDN for the console, published sites and docs. |
| **Stripe** | Payments. Card details go directly to Stripe; Aglyn never receives or stores a card number. |
| **Resend** | Transactional email delivery. |

The formal DPA and the authoritative subprocessor list are contract documents —
ask and we will send them. This table is the engineering view and may lag them.

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

- **Every read and write is gated by Firestore security rules** — an 883-line
  ruleset evaluated by Google's infrastructure, not by our application. A bug
  in our code cannot grant access the rules deny.
- Rules are **per document**, not per collection. Site collaborators scoped to
  one site cannot read another site's data, and that boundary is enforced at
  the database rather than in a UI filter.
- Server routes that use the Admin SDK — which bypasses rules by design —
  **re-check scope independently** before answering.

## API surface

- State-changing API routes authenticate with a **short-lived Firebase ID token
  in an `Authorization: Bearer` header**, not with a cookie. Browsers never
  attach that header to a cross-site request, so those routes are not reachable
  by cross-site request forgery.
- The one cookie-authenticated endpoint (silent sign-in across workspace
  subdomains) returns its response with no permissive CORS header, so a
  cross-origin page cannot read it, and it refuses to answer on any hostname
  that is not a registered workspace.
- **Firebase App Check** is enforced on Firestore and Authentication, so
  requests must come from an attested app rather than a script holding a
  stolen key.
- **Rate limiting** is durable and shared across serverless instances, rather
  than per-instance memory that resets on every cold start.

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

The marketplace runs third-party code, which we treat as untrusted:

- Plugin bundles execute on a **separate origin** under a restrictive Content
  Security Policy, so a plugin cannot reach the console's cookies or DOM.
- Every published version is **content-addressed by SHA-256**; the running
  bytes are the reviewed bytes.
- Staff can **revoke a plugin version platform-wide**, and revocation is
  enforced at render time rather than only blocking new installs.

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
