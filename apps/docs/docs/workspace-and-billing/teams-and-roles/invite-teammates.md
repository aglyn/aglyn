---
sidebar_position: 2
title: Invite teammates
description: Add people to your site and understand how team members act within your organization.
---

# Invite teammates

Bring collaborators into a site so they can build and manage alongside you.

:::info Plan availability
**Paid**. Team seats are metered per tier; buy seat add-ons to grow. See
[Billing & plans](../billing-and-plans/overview.md).
:::

![Inviting a teammate from the team page](/img/teams-and-roles/org-team-page.png)

## Invite someone

1. Open the organization's **Team** page and choose **Add or invite**.
2. Enter their email and assign a [role](custom-roles.md).
3. What happens next depends on whether they already have an Aglyn account:
   **already on Aglyn** — they join right away and see the workspace on their next
   visit; **new to Aglyn** — we email them an invite to accept.

### Pending invites

Invites that haven't been accepted are listed with **Resend** (send the email again,
for the address that lost it in a spam folder) and **Revoke**. A revoked invite's link
stops working immediately.

## Accepting an invite

If you're the one being invited, sign up or sign in with **the address the invite was
sent to** — usually via Google, if that's the address. You land on the **Workspaces**
page, which leads with **"You've been invited"** and an accept banner. Accept there and
the workspace opens.

If that invite is your only workspace, the page also offers **Create my own site
instead** — accepting isn't your only option. If you already belong to other
workspaces, the invite banner appears above your usual workspace picker.

## How team members act

Team members act **in the owner's organization**, not their own — so their changes apply to your
site, and permissions are enforced across the console's APIs and surfaces. Seat limits are
enforced per tier; if you're at your limit, add a **seat add-on** before inviting more.

## Help a teammate who is locked out

Open the member from the **Team** page and use the **Password** card. It has two
options, and the first is almost always the right one.

**Send password reset email** emails the member a link to choose their own password.
Their current password keeps working until they use the link, and nobody else ever sees
the new one. This works for every member. A few sends per hour to the same person is the
cap — it's their inbox, and a reset link is good for an hour anyway.

**Set a password directly** replaces the member's password with one you choose. Use it
only when the member cannot receive email at all — you then have to pass the new password
to them over a channel you trust. When you do:

- they are signed out on every device, and
- they are emailed to say an administrator changed their password.

### Why you can't always set a password

An Aglyn login is **personal, not per-organization**. One person has one account no matter
how many organizations they work with, so setting someone's password can hand you the keys
to workspaces that have nothing to do with yours.

The **Set a password directly** option is therefore unavailable — with the reason shown in
its place — when the member:

- also belongs to another organization,
- is the organization owner (use **Settings → Transfer ownership** instead),
- is an Aglyn staff account, or
- is you (change your own password in your account settings).

In every one of those cases, **Send password reset email** still works. The link goes to
the member's own inbox, so it is safe regardless of what else their account can reach.

Both actions are recorded in the organization's activity log, along with who performed
them. The password itself is never written to the log.

## Activity log

The organization's **Team** page shows a **Recent Activity** feed — renames, workspace URL
changes, ownership transfers, members added/removed or re-roled, and invites sent, revoked,
or accepted — each with who did it and when. Visible to any member of the organization.

Entries name the thing that changed and link straight to it, so "Saved the screen — Home"
takes you to that screen. Entries recorded before this shipped show a plain description
instead of a link.

## Tips

- Start people on a least-privilege [role](custom-roles.md) and widen it with per-member
  overrides only where needed.
- Removing a member frees their seat.

## Related

- [Custom roles](custom-roles.md)
- [Members-only areas](members-only.md)
- [Billing & plans](../billing-and-plans/overview.md)
