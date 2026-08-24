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

**Leave the `TXT` record in place after verification.** We re-check it weekly,
because a domain that changes hands should not keep routing sign-ins to
whoever set it up first.

If the record stops answering, nothing happens to your sign-in. We do not
remove a domain automatically, and a failed lookup on our side is never
treated on its own as proof the record is gone — a DNS outage looks identical
to a deleted record, and we would rather ask you than lock your team out.

What happens instead: after the check fails three weeks running, we email
your organization's owners and admins asking you to restore it. Your SSO keeps
working the whole time. Removing a domain is always a deliberate act by you,
in **Organization → Settings → SSO**, or by us with your agreement.

So if you migrate DNS providers, carry `_aglyn-challenge.yourdomain.com` across
with the rest of your records.

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

#### Rotating your signing certificate

There is a **second certificate field**, and it exists so rotation never has a
moment you have to time exactly right. Every IdP publishes the replacement
certificate before the current one expires; paste the new one into the second
field while the old one is still in the first, and we accept assertions signed
by either. Once your provider has switched over, clear the old one.

Doing it as a straight swap instead means picking an instant: too early and
your IdP is still signing with a certificate we no longer accept, too late and
it is signing with one we do not know yet. Either way every sign-in fails
signature validation, and if you have enforced SSO there is no password to fall
back on.

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

### You must keep one way in that does not go through your IdP

Enforcing is **refused** until your organization has a way in that survives your
identity provider failing. This is not a warning you can dismiss — the button
stays disabled and the sweep will not run.

The reason is the failure it protects against. After enforcement, every account
in your pool holds nothing but the link to your identity provider. If that
provider stops answering — a lapsed signing certificate, an application deleted
during a migration, a tenant moved — nobody can sign in, and **we cannot let you
back in either**: your accounts live in your own pool and their only credential
is the one that stopped working.

There are two ways to satisfy the requirement, and for most organizations only
the first is available.

#### An owner who signs in outside your identity pool

Enforcement sweeps your identity pool and nothing else. An **organization
owner** whose account is not in that pool is not merely spared — the sweep
cannot see the account at all, so no certificate, application or provider
change on your side can lock them out. Nothing has to be ticked: they already
hold the key.

To count, the owner must:

- have the **Owner** role in the organization — Admin is not enough;
- sign in **outside the identity pool**, with their own password or social
  login. In practice this is an address your identity provider does not
  govern — the founding admin who set the organization up before SSO, or a
  deliberate administrative account on a different domain;
- have a **verified email address** and not be disabled. An unverified address
  cannot reach organization settings, so it could not turn enforcement back
  off — which is the entire job.

The rehearsal names them. If your organization has none, you change who holds
the role yourself — but read the next paragraph first, because it is not what
you might expect.

**An organization has exactly one Owner.** There is no way to appoint a second
one, and the Members page offers only Admin, Editor and Viewer. What you can do
is **transfer** the role, under **Settings → Transfer ownership**: the person
you choose becomes the Owner and you become an Admin. So satisfying this
requirement means handing the Owner role to whoever signs in outside your
identity pool — often the account that set the organization up in the first
place — and staying on as an Admin yourself.

Admin keeps organization settings, members, invites and every host, so the
day-to-day does not change. Four things move with the role: transferring
ownership again, changing the workspace URL, deleting the organization, and
being exempt from an admin-initiated password reset. Decide with that in mind —
the person you transfer to is the person who can transfer it back.

One residual worth knowing: if that owner's login and your identity provider
are the same vendor — a Workspace SAML application plus a Workspace Google
login — then deleting the whole vendor account takes both. A lapsed certificate
or a removed SAML application, the failures this exists for, do not.

#### Or a break-glass account inside the pool

If an account in your pool already holds a password or another linked login —
which happens for pools created before self-serve setup — you can designate it
instead. Designate from the rehearsal: it lists every account in the pool with a
**Break-glass** checkbox, then **Save break-glass accounts**.

Only an account that already holds a password or another linked login can be
ticked. Designating an account whose sole credential is the SAML link looks
exactly like protection and provides none — it fails in precisely the situation
break-glass exists for — so both the checkbox and the server refuse it, and the
refusal names which of your picks was ineffective.

For a pool we created for you, **no account can qualify**: the pool is created
with password sign-in disabled, passwords cannot be set on accounts inside it,
and social logins cannot be linked to a governed account. That is the isolation
working as intended, and it is why the owner route above is the normal answer.

Keep any designation current. It is a standing bypass of the enforcement you
bought, which is the point, but it also means a departed admin left on it is a
standing password into your organization. Saving replaces the list rather than
adding to it, so removing someone is a matter of unticking them.

#### Transferring ownership while you are enforcing

Because there is only one Owner, that single account usually *is* your whole
way back in. So while single sign-on is enforced, we **refuse an ownership
transfer that would leave you without one** — moving the role onto an account
inside your identity pool would undo the requirement above without anyone
noticing, at a moment when the rehearsal is not running and the pool has
already been swept.

The refusal happens before anything is written, and it is recorded on your
organization's activity log so the attempt is visible rather than silent. If
the transfer is what you actually want, **stop enforcing single sign-on first**,
transfer, then turn enforcement back on — the rehearsal will run again and tell
you where you stand. A designated in-pool break-glass account also satisfies
this, since that designation belongs to the organization rather than to the
Owner and a transfer cannot take it away.

The same refusal applies to us. Support cannot transfer your organization past
this check either.

#### If we cannot check

The owner check can fail on our side. When it does, enforcement is **refused**
and the page says the check did not complete rather than telling you your
organization has nobody. Nothing changes; rehearse again.

An ownership transfer refuses on the same terms, for the same reason: an
unanswered check is not a reason to move the only key you have.

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
