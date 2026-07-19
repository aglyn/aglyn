---
sidebar_position: 4
title: Member accounts
description: Let visitors sign up on your site, design an account page with the Customer account block, gate screens to members, and manage members from the console Users page.
---

# Member accounts

Visitors can become **members** of your published site — sign up, sign in,
see their orders, and unlock members-only screens. This walkthrough covers the
visitor side (built-in auth pages and the account block) and the console side
(the Users page and the member drawer).

<!-- regenerate: node tools/e2e/capture-docs-shots.mjs -->

:::info Plan availability
Member signups and the account block work wherever commerce does; gating
screens to members needs the content-gating feature (**Business** and above) —
see [Members-only areas](../workspace-and-billing/teams-and-roles/members-only.md).
:::

:::note Members are not console users
Site members are your site's **audience**, separate from the console teammates
you [invite to collaborate](../workspace-and-billing/teams-and-roles/invite-teammates.md).
Members sign in on your published site only, with a per-site session — they
never see the console.
:::

## 1. The built-in sign-in and sign-up pages

Every published site serves two ready-made routes — no design work needed:

- **`/signup`** — "Create your account": name, email, and password (8
  characters minimum). Submitting creates the member, signs them straight in,
  and returns them to your home page.
- **`/signin`** — "Welcome back": email and password. The two pages
  cross-link ("New here? Create an account" / "Already a member? Sign in").

![The built-in sign-up page on a published site with name, email, and password fields](/img/guides/members-signup.png)

![The built-in sign-in page on a published site with email and password fields](/img/guides/members-signin.png)

New members automatically flow into your
[Contacts CRM](../content-and-data/contacts/overview.md) and appear as leads;
`memberSignUp` and `memberSignIn`
[automation events](../marketing-and-automation/workflows-and-actions/overview.md)
fire so you can trigger welcome actions.

:::note Passwords
Member sessions are per-site, cookie-based, and last 30 days. There is
currently no self-service password reset for members — if a member is locked
out, they can sign up support via your site's contact channels.
:::

## 2. Design an account page

For a richer home for members, add the **Customer account** block (found in
the **Commerce** group of the element picker) to a screen — conventionally at
the slug `account`, which is where commerce gates point anonymous visitors:

- **Signed out**, the block shows sign-in / create-account tabs in place, with
  your configurable **Signed-out heading** above.
- **Signed in**, it renders the member's profile with **Sign out**, plus
  sections for **Orders** (with status chips and tracking), **Subscriptions**
  (each with a **Manage** button that opens the Stripe Billing Portal),
  **Downloads** (digital purchases and license keys), and **Addresses**.

![The account page on the live site: the Customer account block's signed-out state with sign-in and create-account tabs](/img/guides/members-account-screen.png)

Give the account page the same chrome as the rest of your site by binding a
**shared layout**: in the screen's Properties, pick one under **Shared
layout** — the appbar/footer are then maintained once for every bound screen
(see [screens & layouts](../building-sites/screens-and-layouts/overview.md)).

## 3. Gate screens to members

To restrict a screen: open its version view, and in the **Page Access** card
set **Visibility** to **Members only**, then publish. Anonymous visitors get a
"This page is for members" prompt with sign-in / create-account links instead
of the content (or your designed 401
[error screen](../building-sites/site-protection/error-screens.md) if you've
assigned one). The screen's content is never in the anonymous page source —
members fetch it with their session after sign-in.

For one-off protection without accounts, use a
[per-screen password](../building-sites/site-protection/password-a-screen.md)
instead.

## 4. Manage members from the console

The site's **Users** page has two cards: **Site users** (your members — this
guide) and **Users** (console collaborators). The Site users card is
searchable and paged, newest first, with **Email**, **Name**, **Joined**, and
**Status** columns.

![The console Users page with the Site users card listing members and their Active status chips](/img/guides/members-users-tab.png)

Click a member to open the **member drawer**:

- **Profile** — email, display name, and join date, with a **Suspended** chip
  when applicable.
- **Lifetime purchases** — charged order totals minus refunds (pending and
  cancelled orders excluded).
- **Orders** — the member's payment history, newest first: order number,
  status, total, date, any refunded amount, and the Stripe payment reference.
  Needs the editor or admin role on the site.
- **Subscriptions** — each with its renewal date and status chip.
- **Addresses** — the member's saved addresses.

![The member drawer open over the Users page showing lifetime purchases, orders with payment references, and the Suspend member action](/img/guides/members-member-drawer.png)

### Suspend & reactivate

The drawer's action button flips between **Suspend member** and **Reactivate
member**, each behind a confirmation:

- **Suspend** — the member can no longer sign in on the published site (they
  see an "account suspended" message), and their account page signs out on its
  next load. Orders, subscriptions, and history are all kept.
- **Reactivate** — restores access with the member's existing password.

Both actions are recorded in the site's activity log.

## Related

- [Members-only areas](../workspace-and-billing/teams-and-roles/members-only.md)
- [Commerce end to end](commerce-end-to-end.md)
- [Contacts CRM](../content-and-data/contacts/overview.md)
- [Site protection & error screens](../building-sites/site-protection/overview.md)
