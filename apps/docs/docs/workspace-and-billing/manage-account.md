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

The page is four tabs.

## Account

Your **email** and how you sign in.

The email field is read-only, with a **Email verified** or **Email unverified** chip
beside it. Your email comes from the provider you sign in with, so it changes there,
not here.

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
