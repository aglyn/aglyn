---
sidebar_position: 2
title: Single sign-on (SAML)
description: How to set up SAML SSO yourself, how domain verification works, what enforcement does, and the consequences of SSO accounts living in their own identity pool.
---

# Single sign-on (SAML)

SSO signs your team in against your own identity provider. It is an
**Enterprise** feature, and once your organization is on Enterprise you set it
up yourself in **Organization → Settings → Single sign-on**. There is no
provisioning step on our side and nothing to wait for.

## Setting it up

### 1. Verify your domain

Add each email domain your team signs in with. We give you a DNS `TXT` record
to publish:

| Record | Value |
| --- | --- |
| `_aglyn-challenge.yourdomain.com` | `aglyn-domain-verification=…` |

Publish it at your DNS provider, then press **Verify**. DNS can take a few
minutes to propagate; re-checking is safe and costs nothing.

**This step is not a formality.** A verified domain is what tells us to send
that domain's sign-ins to your identity provider. If anyone could claim a
domain without proving they own it, they could point *your* domain at *their*
IdP and intercept your team's logins. So nothing else works until a domain
passes, and we re-check the record rather than taking your word for it.

Public mailbox domains — `gmail.com`, `outlook.com` and the like — cannot be
used. They are shared with millions of people outside your organization.

### 2. Connect your identity provider

The settings page shows the two values your IdP asks for when you create the
Aglyn application:

- **Reply / ACS URL**
- **Entity ID / Audience**

Create the application in your IdP, then paste its details back: the **entity
ID**, the **sign-in URL** (which must be `https://`), and the **X.509 signing
certificate**. Saving creates your identity pool and its SAML provider.

Saving does **not** switch anything on. Your configuration sits inactive until
you turn it on, so a half-entered setup can never start routing sign-ins.

### 3. Turn it on

Once at least one domain is verified and your provider is saved, **Turn on**
publishes the routing for your verified domains and SSO goes live.

Turning it off later stops the routing but **keeps your identity pool and every
account in it**, so you can turn it back on without anyone losing their
account.

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

Enforcement is applied by a sweep over the pool. **Rehearse it first** — the
settings page has a rehearsal that changes nothing and lists exactly which
accounts would lose which sign-in methods. An account whose only way in is the
method being removed is reported and skipped rather than orphaned.

Enforcement cannot be undone by turning it off. We remove a linked credential;
we do not keep a copy to put back. Anyone affected re-links for themselves.

## Consequences worth knowing before you switch

**Passwords cannot be set for SSO accounts.** The console refuses rather than
silently doing nothing — your IdP owns the credential.

**SSO users are in a separate pool.** This is the isolation working, but it has
practical effects the platform has to account for explicitly: an SSO user is
not returned by ordinary account lookups unless the lookup searches every pool.
Staff surfaces label these accounts with the pool they belong to, so
"can't find them" and "they're an SSO account" are distinguishable.

**Social sign-in cannot be linked to an SSO account at all.** Not automatically,
and not by the user either — the option is not offered, and the account page
says why. Your identity provider is the single gate you bought: you revoke
there, you enforce MFA there, you offboard there. A personal Google account
linked to a governed identity would be a way in that your directory can neither
see nor revoke, so we do not allow one to be created.

This holds whether or not you have turned enforcement on. Enforcement decides
whether we **remove** sign-in methods that already exist; it was never a licence
to keep handing out new ones in the meantime. Nothing about this can lock anyone
out, because refusing to add a method never takes away a method someone already
has.

An account in your pool is also simply not the same identity as the same email
address signing in with Google elsewhere, so the two never merge.

## Testing it

SSO redirects cannot be exercised from `localhost` — the flow fails with a
missing-initial-state error before it reaches your IdP. Test on a deployed
environment.

## Related

- [Signing in and sessions](../workspace-and-billing/signing-in-and-sessions.md)
- [Trust & security](/trust) — the security posture behind an enterprise review
