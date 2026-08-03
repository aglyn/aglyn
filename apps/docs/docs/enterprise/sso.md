---
sidebar_position: 2
title: Single sign-on (SAML)
description: How SAML SSO works on Aglyn, how it is provisioned, what enforcement does, and the consequences of SSO accounts living in their own identity pool.
---

# Single sign-on (SAML)

SSO signs your team in against your own identity provider. It is an
**Enterprise** feature and it is **provisioned by Aglyn** — there is no
self-serve toggle in **Organization → Settings**, because setting it up means
creating an identity pool for your organization on our side and exchanging
metadata with your IdP.

## How it works

Each SSO organization gets its **own identity pool**. Your users authenticate
against your IdP, and their Aglyn accounts live in that pool rather than in the
shared one. That isolation is the point — your directory governs who can sign
in, and removing someone there removes their access here.

Signing in goes through a dedicated route rather than the normal email/password
form, so people arrive by way of your IdP.

## Enforcement

An organization can turn on **SSO enforcement**, which is a separate step from
having SSO configured.

- **Configured, not enforced** — SSO is available, and other sign-in methods
  still work.
- **Enforced** — other sign-in methods are stripped from accounts in the pool.
  Passwords stop being an option, not merely a discouraged one.

Enforcement is applied by a sweep over the pool, and it can be rehearsed
against an organization before it is switched on, so you can see exactly which
accounts change before anything does.

## Consequences worth knowing before you switch

**Passwords cannot be set for SSO accounts.** The console refuses rather than
silently doing nothing — your IdP owns the credential.

**SSO users are in a separate pool.** This is the isolation working, but it has
practical effects the platform has to account for explicitly: an SSO user is
not returned by ordinary account lookups unless the lookup searches every pool.
Staff surfaces label these accounts with the pool they belong to, so
"can't find them" and "they're an SSO account" are distinguishable.

**Social sign-in is not automatically linked.** An account in your pool is not
the same identity as the same email address signing in with Google elsewhere.

## Testing it

SSO redirects cannot be exercised from `localhost` — the flow fails with a
missing-initial-state error before it reaches your IdP. Test on a deployed
environment.

## Related

- [Signing in and sessions](../workspace-and-billing/signing-in-and-sessions.md)
- [Trust & security](/trust) — the security posture behind an enterprise review
