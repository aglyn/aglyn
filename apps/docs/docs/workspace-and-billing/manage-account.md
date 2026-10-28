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

## The tabs {#account-tabs}

Manage Account has a tab for each part of your account — **Account**, **Email
addresses**, **Profile image**, **Basic info**, **Security** and
[**Close account**](#close-account) — and each one saves on its own. **Security** is left out for an account that signs in only
through a company identity provider, which owns that account's credentials.

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

### Product updates {#product-updates}

The **Product updates** card under the addresses is the switch for whether we may email
you about product updates; turn it on or off at any time, and receipts, invites and
security alerts keep arriving either way. Your answer is stored with the date and the
wording you agreed to, and if you unsubscribed from an email the card says so. See
[Product updates](signing-in-and-sessions.md#product-updates) for the other places the
same choice can be made, and what turning it back on needs.

## Profile image

Your avatar, shown in the account menu, on the workspace team roster, and beside
your activity. Pick an image from the organization's
[media library](../content-and-data/media/overview.md) or paste an `https` image URL.

Never set one and Aglyn falls back to the photo your sign-in provider gave us, and
then to your initials, drawn by Aglyn. Nothing about you is sent to an outside
avatar service to work out what to show. The preview beside the field shows exactly
what everyone else sees.

**Clearing the field is different from never having set one.** Emptying it and
saving removes your picture and keeps it removed — signing in again does not put
your provider's photo back. Save an image here again whenever you want that
prefill returned.

If your company signs you in through its own identity provider and this is blank,
that provider is most likely not sending a picture — many cannot, including Google
Workspace SAML, which has no photo attribute to map. Set one here: the media
library accepts an upload, or paste an `https` link.

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

If your company signs you in through its own identity provider, your address is
prefilled from that directory only when the directory sends a **street line**. A
provider that releases a city, region or postcode on its own leaves these fields
empty for you to fill in: those parts are not an address anyone could post to, and
Aglyn does not keep personal details it has no use for. As with your name, anything
you type here wins permanently — signing in again never re-applies the provider's
version, and clearing the address tells us to stop prefilling it altogether.

:::note Who can see this
Your address and phone live on your personal account, visible only to you and to
Aglyn staff. They are **not** copied onto your organization's member list — that
list is readable by every member of the organization and by site collaborators,
which is appropriate for a name and not for a home address.

This is separate from the **billing address** on an invoice, which is collected at
checkout and belongs to the organization rather than to you.
:::

## Security

The **Security** tab is where you change your password, manage your
[passkeys](signing-in-and-sessions.md#passkeys) and check
[recent sign-ins](signing-in-and-sessions.md#recent-sign-ins). To change your password,
type your current one, then the new one twice, and save.

The password card appears **only if your account has a password**. A Google-only account
has no password to change — connect **Email & password** from the Account tab first, and
the card appears.

## Close account {#close-account}

This is how you delete your Aglyn account. Closing it **permanently deletes your
personal account** — your profile, your sign-in and your place in every workspace — and
it takes effect the moment you confirm. There is no waiting period, it cannot be undone,
and Aglyn support cannot restore it. Closing your account never deletes a workspace; see
[What is kept](#close-account-kept) for the rest.

### How to close your account {#close-account-steps}

1. **Optionally, download your data first.** Open the account menu, choose **Manage
   Account**, then the **Close account** tab. The **Download my data** card sits right
   above the close card and gives you a machine-readable JSON copy of what Aglyn holds
   about you: your profile and contact details, your workspace memberships, your
   passkeys, your public handle and the support messages you wrote. It leaves out your
   colleagues' data, and a secret such as an API key is listed as existing, never
   reproduced. If your last sign-in was more than an hour ago it asks you to sign in
   again first.
2. **Hand over any workspace you own.** If you own a workspace, closing your account is
   refused until someone else owns it, because otherwise it would be left with nobody who
   can administer it. Choose **Close account** and the dialog lists every workspace that
   still needs an owner, with whether it has an active subscription and how many other
   members it has. Transfer ownership from **Team → Permissions**, or
   [delete the workspace](billing-and-plans/downgrading-and-canceling.md#deleting-your-organization)
   if you don't need it — a workspace in its deletion hold still counts as yours until
   the hold ends and it is erased. Being a member, editor, admin or site collaborator
   never blocks you.
3. **Confirm it's you.** In the **Close your account?** dialog, type your password. If
   you sign in with Google or your company's identity provider instead, there is no
   password box; you are asked to sign in again through that provider. Your email
   address must be verified, and the sign-in has to be recent: a confirmation more than
   five minutes old is refused and you are asked again.
4. **Type `DELETE`** in the **Type DELETE to confirm** box.
5. **Choose Close account permanently.** The button stays disabled until the password
   (when one is needed) and `DELETE` are both filled in. When it finishes you are signed
   out, and the account no longer exists.

Because deletion is immediate, there is nothing to cancel afterward.

### In the Aglyn apps {#close-account-in-the-apps}

The Aglyn apps for iPhone, iPad, Android and Mac have the same action. Open your account
and choose **Close account**, then **Close my account**, and type `DELETE` to confirm.
It is the same deletion, and the same rule about workspaces you own applies. The
**Download my data** card is on the web, in Manage Account.

### What is deleted {#close-account-deleted}

When you close your account, Aglyn permanently deletes:

- **Your profile** — your name, phone number, organization name, postal address and
  every other detail on your Manage Account page — together with your notifications,
  your passkeys, your record of which legal terms you accepted, your Free plan AI usage
  count, and your workspace and site memberships.
- **Your avatar**, the uploaded copy of your profile picture.
- **Your public profile** — the handle and display name other people can see, and the
  payout account identifier attached to it.
- **Your sign-in** — the account itself, with every email address and sign-in method on
  it. The addresses are released, so they can be used on another account.
- **Your place on every workspace**: you are removed from each member list and lose
  access to every site you could reach through it.
- **The email delivery log** — the record of the emails Aglyn sent to each address on
  your account, with the times they were opened or clicked.
- **Your AI usage records** — your monthly AI usage in each workspace, and any AI
  allotment a workspace set for you.
- **Your name and email on your support messages.** See below for what remains.
- **Your details on POS hardware orders you placed** — your name, email, phone,
  the street address and the tracking. The workspace keeps the order and its amounts.
  An order you placed that has not shipped yet is
  [canceled and refunded in full](../commerce-and-bookings/commerce/pos-hardware.md#hardware-orders-at-closure)
  first, and you get an email saying so. The **Close your account?** dialog lists
  any such order before you confirm.

### What is kept, and for how long {#close-account-kept}

| Kept | What it is | For how long |
| --- | --- | --- |
| **Workspaces you belonged to** | Their sites, content, data and billing belong to the workspace, not to you. Closing your account removes you from them and deletes none of it. | As long as the workspace exists. When a workspace is deleted, it is permanently erased after a 7-day hold, and Aglyn keeps no copy of it. |
| **Your support messages** | The text of messages you wrote in a workspace's support threads stays with the thread, because the thread is the workspace's record. Your name and email are removed from each message. | As long as the workspace keeps its support history. |
| **Aglyn Assist and AI generation records** | The questions you asked Aglyn Assist and the answers, and the briefs of AI generation jobs, kept with the workspace they were made in. | Deleted automatically after 180 days. |
| **A record that the closure happened** | Your account's ID, the email address on it, what was removed, and when. | About 15 months: 90 days in the active log, then 365 days in an archive. |
| **Backup copies** | Aglyn's backups can still hold the account until they age out. If a backup is ever restored, the closure is applied again. | Up to 14 weeks (98 days). |
| **Product analytics** | Usage analytics collected by Google Analytics. They are not tied to your account. | 14 months. |
| **Do-not-contact entry** | Only if you asked Aglyn to stop contacting you: a one-way hashed entry on an internal do-not-contact list, used for nothing else, so Aglyn keeps honoring your request. | Kept so the request keeps being honored. |
| **Payment records** | Stripe keeps its own payment records on its own schedule. Sales-tax records for a workspace's storefront transactions, and Aglyn's records of [card readers a workspace bought from Aglyn](../commerce-and-bookings/commerce/pos-hardware.md#hardware-purchase-records) (the items, amounts, tax, and the state, ZIP code and country they shipped to, with no name or street address), are kept after a workspace is deleted because tax law requires it. | Set by Stripe and by tax law; Texas requires four years for sales-tax filing records. Aglyn keeps its card reader sale records seven years from the sale, then deletes them. |

### If you can't sign in, or closing is refused {#close-account-help}

If you can no longer sign in, or the account can't be closed from the page, email
**privacy@aglyn.com** from the address on the account and ask for it to be deleted.
Aglyn may confirm it's you by sending a link to the address on the account. The same
rules apply, including handing over any workspace you own first, and the deletion is
immediate once it runs.

If a second account holds one of your email addresses, closing is paused rather
than risk erasing that other account's mail history. The page tells you so and asks you
to email the same address.

### Delete some of your data without closing your account {#delete-your-data}

You don't have to close your account to remove data. These are the controls Aglyn
offers, each from its own page:

- **Email addresses.** [Remove](#removing-an-address) any address that isn't your
  primary. Your primary and your last confirmed address can't be removed.
- **Profile image.** [Clear the field](#profile-image) and save. Your picture is removed
  and stays removed.
- **Phone number and address.** [Clear them](#contact-details) on the Basic info tab and
  save; clearing the address also stops sign-in from refilling it.
- **Passkeys and sign-in methods.** Remove a [passkey](signing-in-and-sessions.md#passkeys)
  on the Security tab, or disconnect Google on the [Account](#sign-in-methods) tab.
- **A copy of your data.** **Manage Account → Close account → Download my data** gives
  you everything described above without deleting anything.
- **Contacts and leads in your workspace.** [Delete a contact](../content-and-data/crm/contact-record.md#deleting-and-erasing)
  from its record, or use **Settings → Privacy** to
  [erase a person](signing-in-and-sessions.md#privacy-requests) by email address, which
  works on every plan.
- **Form submissions.** Open the [Inbox](../content-and-data/forms/overview.md#the-inbox)
  and choose **Delete**; it asks first and the submission is removed permanently.
- **Media.** Choose **Delete** on a file in the
  [Media library](../content-and-data/media/overview.md#organize). The message that
  confirms it carries an **Undo** button.
- **A site.** A site admin can use
  [**Delete site**](billing-and-plans/downgrading-and-canceling.md#deleting-a-single-site)
  in its Admin → Danger zone. It takes effect immediately.
- **A whole workspace.** An owner can
  [delete the organization](billing-and-plans/downgrading-and-canceling.md#deleting-your-organization)
  from its settings, with a 7-day hold you can cancel, and can
  [download the workspace's data](signing-in-and-sessions.md#downloading-a-whole-workspace)
  first.

For anything these pages don't cover, email **privacy@aglyn.com** and say what you'd like
removed. If your data was collected by a site built with Aglyn, such as a form
submission or an order, the site's owner decides what happens to it: ask them, and they
can erase you from **Settings → Privacy**.

## Related

- [Signing in & sessions](signing-in-and-sessions.md)
- [Teams, roles & membership](teams-and-roles/overview.md)
- [Notifications](../getting-started/console-tour.md#workspace-settings--notifications)
