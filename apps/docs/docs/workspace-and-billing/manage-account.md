---
sidebar_position: 3
title: Manage Account
description: Your personal account — email, sign-in methods, avatar, name, and password.
---

# Manage Account

**Manage Account** is your personal account page, separate from your workspace and
its team roster. Open it from the **account menu** (your avatar, top right) — click
your name in the menu header, or the gear icon beside it.

Everything here is yours alone: changing it follows you into every workspace you
belong to. Workspace-level things — the team roster, roles, billing — live under
[Organization → Team](teams-and-roles/overview.md) and
[Billing](billing-and-plans/overview.md) instead.

The page is five tabs.

## Account

Your **primary email** and how you sign in.

The email field here is read-only, with an **Email verified** or **Email unverified**
chip beside it. It shows your **primary** address — the one Aglyn's sign-in record
holds. To add other addresses, or to make a different one primary, use the
[Email addresses](#email-addresses) tab.

### Sign-in methods

Below the email, every method linked to your account is listed:

- **Google** — shows the connected Google address and a **Disconnect** button.
- **Email & password** — carries a **Required** chip. Password sign-in is permanent:
  it's the method that always works, so it can't be disconnected.

If Google isn't linked yet, a **Continue with Google** button connects it. Linking
both means you can sign in either way with one account — the same profile, the same
workspaces, no duplicate account.

You can never remove your **last** sign-in method; the attempt is refused rather
than locking you out. Closing the Google popup mid-flow simply cancels — nothing
changes.

:::note If your organization uses single sign-on
Accounts that sign in through a company identity provider **cannot link Google or
any other method** — the option is shown as unavailable, with the reason. That is
deliberate, not a limitation we intend to lift.

Single sign-on exists so your organization's identity provider is the *only* gate:
they revoke access there, require MFA there, and offboard people there. A linked
personal Google account would be a way in that your IT administrators cannot see
or revoke, which is the thing SSO is bought to prevent.

If your organization turns on SSO **enforcement** later, sign-in methods that were
linked before are removed at that point, and any active sessions using them end.
Your account is never left with no way in: if removing a method would orphan an
account, it is skipped and reported to your administrators instead.
:::

## Email addresses

You can keep up to **five** addresses on one account — a work address and a personal
one, say — instead of running two accounts.

Type an address into **Add an email address** and Aglyn emails a confirmation link to
it. Until you follow that link the address is listed as **Unconfirmed** and does
nothing at all: it cannot be used to sign in, it cannot receive an invitation, and it
cannot become your primary. Confirming is the only thing that makes an address count,
because following a link in an inbox is the proof that the inbox is actually yours.

Each address in the list carries a **Confirmed** or **Unconfirmed** chip, and one
carries **Primary**. The buttons beside a row change with its state:

- **Resend** — on an unconfirmed address, sends a fresh confirmation link. Links
  expire after **24 hours**; an expired one tells you to send a new one rather than
  quietly failing.
- **Make primary** — on a confirmed address that isn't already primary.
- **Remove** — on any address that isn't your primary.

### What each address does

Once confirmed, an address is two things and nothing more:

- **A way to sign in.** Type any confirmed address on the sign-in page with your usual
  password and you're in. You don't have to remember which one the account was opened
  with.
- **A place an invitation can arrive.** If a workspace administrator invites the
  address, you can accept it from the account you already have.

Your **primary** address is the one that receives receipts, password resets, and
account notices. It's also the address shown on the Account tab.

:::warning Adding an address never joins you to a workspace
This is the one thing people expect that is deliberately not true. Adding
`you@bigcompany.com` to your account does **not** put you in BigCompany's workspace,
and confirming it doesn't either.

Access to a workspace comes from an invitation somebody there sent you, or from that
organization's own single sign-on. Nothing you can do on your own settings page grants
it. If that were not so, anyone could reach a customer's workspace by typing their
domain into this form.
:::

### Removing an address

Two removals are refused, both to stop you locking yourself out:

- **Your primary.** Make a different address primary first, then remove this one.
- **Your last confirmed address.** An account with no confirmed address has nowhere to
  receive a password reset, so it can't be recovered.

Removing a confirmed address frees it — it can then be added and confirmed on a
different account. While it's confirmed on yours, nobody else can claim it: an
attempt on another account is refused with *"That address is already in use on another
account."*

### If your organization uses single sign-on

Two limits apply, and both exist so that adding an address can't route around your
identity provider.

You **cannot move your primary off a domain your organization governs**. If your
primary is `you@company.com` and Company requires single sign-on for that domain, the
switch is refused and points you at an administrator. Your primary is what your
organization's identity checks read, so demoting it would take you outside their
control while leaving your access intact — which is the thing single sign-on is bought
to prevent. This refusal applies whether or not enforcement has been switched on yet.

You also **cannot make an address primary on a governed domain you don't sign in
through**. Confirming a mailbox proves mail reaches you; it does not put you inside
that organization's identity provider, and promoting the address would leave the
account unable to sign in at all.

## Profile image

Your avatar, shown in the account menu, on the workspace team roster, and beside
your activity. Pick an image from the organization's
[media library](../content-and-data/media/overview.md) or paste an `https` image URL.

Leave it empty and Aglyn falls back to the photo your sign-in provider gave us, and
then to your initials, drawn by Aglyn. Nothing about you is sent to an outside
avatar service to work out what to show. The preview beside the field shows exactly
what everyone else sees.

## Basic info

Your first and last name. Saving also updates the display name your teammates see —
the Team page, activity entries, and comments all pick it up.

Both are prefilled from however you signed up: the name you typed on the sign-up
form, or the one your Google account or company identity provider sent us. Editing
them here wins permanently — signing in again never re-applies the provider's
version over your own. If your company signs you in through its own identity
provider and these are blank, that provider is not sending a name; type one here.

### Contact details

Phone number, organization name, and your address.

Your **phone number** is stored in international format — type it however you like,
including `(512) 555-0123`, and it is saved as `+15125550123`. Include the country
code for anywhere outside the US and Canada, since a bare national number cannot be
matched to a country without guessing.

**Country** is the two-letter code (`US`, `GB`, `DE`). Stripe Tax cannot compute
anything from a spelled-out country name, which is why the field insists.

:::note Who can see this
Your address and phone live on your personal account, visible only to you and to
Aglyn staff. They are **not** copied onto your organization's member list — that
list is readable by every member of the organization and by site collaborators,
which is appropriate for a name and not for a home address.

This is separate from the **billing address** on an invoice, which is collected at
checkout and belongs to the organization rather than to you.
:::

## Security

Change your password.

This tab appears **only if your account has a password**. A Google-only account has
no password to change — connect **Email & password** from the Account tab first, and
the Security tab appears.

## Related

- [Signing in & sessions](signing-in-and-sessions.md)
- [Teams, roles & membership](teams-and-roles/overview.md)
- [Notifications](../getting-started/console-tour.md#workspace-settings--notifications)
