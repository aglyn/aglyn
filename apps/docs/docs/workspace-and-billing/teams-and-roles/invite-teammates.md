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

![The Team page's invite row, with the Email field, the Role picker and All sites, above the members roster](/img/teams-and-roles/org-team-page.png)

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

### Who gets told

- The person you invited gets the **invite email**. The confirmation you see says
  whether one actually went out — "email sent" versus "they'll see it when they sign
  in" — so a workspace with email delivery unavailable never leaves you assuming a
  message was delivered.
- Your workspace's **owner and admins** get an in-app notification when an invite is
  created and again when it is **accepted**, so whoever sent it finds out it was taken
  up without re-checking the Team page. Both appear under **Team & access** in the
  notification bell, and can be muted there like any other category.

## Accepting an invite

If you're the one being invited, sign up or sign in with **the address the invite was
sent to** — usually via Google, if that's the address. You land on the **Workspaces**
page, which leads with **"You've been invited"** and an accept banner. Accept there and
the workspace opens.

If that invite is your only workspace, the page also offers **Create my own site
instead** — accepting isn't your only option. If you already belong to other
workspaces, the invite banner appears above your usual workspace picker.

### An invitation never changes who owns the workspace

Accepting an invite normally sets your role to whatever the invite offered. The one
role it cannot touch is the **owner's**. If an invitation is sent to the address that
owns the workspace, accepting it is refused rather than applied — otherwise the owner
would be quietly stepped down to a viewer or an admin, and only the owner can transfer
ownership back, so nobody left in the workspace could undo it.

Ownership moves one way only: **Settings → Transfer ownership**, by the current owner,
to somebody already on the team. The previous owner becomes an admin. Nothing else in
the product creates or moves an owner — an invitation cannot grant the role either.

## How team members act

Team members act **in the owner's organization**, not their own — so their changes apply to your
site, and permissions are enforced across the console's APIs and surfaces. Seat limits are
enforced per tier; if you're at your limit, add a **seat add-on** before inviting more.

## You are a site collaborator's support channel

Someone you invite to a **single site** gets a console scoped to that site, which
leaves out the organization pages — including **Support**. That is deliberate: a
support ticket is a conversation between the whole organization and Aglyn, readable by
your team, not a per-site channel.

The practical consequence is that a site collaborator who hits a problem comes to
**you**. Open a ticket on their behalf if it needs Aglyn — include the site and the
exact error, as [Support & community](../support-and-community.md#what-to-include)
describes, since you will be relaying rather than reproducing. Someone invited to the
whole organization keeps Support unchanged.

## Help a teammate who is locked out

Open the member from the **Team** page and use the **Password** card. It has two
options, and the first is almost always the right one.

![The Password card on a team member's page, with the reset-email button above a
divider reading "Or set a password directly" and a new-password field with a Generate
button](/img/teams-and-roles/team-member-password.png)

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
or accepted — each with who did it and when.

Visible to members whose role carries the **Activity & audit log** permission.
Owners and admins have it by default; **viewers do not**, and neither does a
custom role until you grant it. Revoking it does not merely hide the card — the
feed is served by an API that checks the permission, so a member without it
cannot read the log by any route.

Entries name the thing that changed and link straight to it, so "Saved the screen — Home"
takes you to that screen. Entries recorded before this shipped show a plain description
instead of a link.

A site's own activity log, on its **Setup** page, filters through its table's toolbar:
**Filters** narrows it to one **Action** (or several, with **is any of**) — typed as
the action is recorded, since the panel offers no list of them — or to entries before or
after a date, and the two add up, across the whole log rather than the page on screen.
It has no search box, because nothing can search the whole log by word. See
[Filter and search a list](../../getting-started/console-tour.md#filter-and-search).

### AI actions in the log {#ai-actions}

Everything the AI does in your workspace is recorded in the same feed, attributed to the
member who asked for it — or to nobody, when nothing a person did caused it (a generation
that paused because the included band ran out, or the add-on leaving at the end of a billing
period). The feed shows an **AI** chip whenever the page holds one of these rows; press it to
see only them.

| Entry | What it records |
| --- | --- |
| **Started an AI generation** | A generation was briefed: what it builds, how long the brief was, and the site. |
| **AI generated** | One thing a generation produced — a screen, a layout, a component — linked like any other change. A site's own activity carries a copy. |
| **Canceled an AI generation** | A generation was stopped before it finished. |
| **AI generation paused for input** | A generation stopped and asked for a person, and why: the included band, the overage ceiling, the monthly message cap, or the job's own budget. |
| **Applied AI edits** | Edits from a proposal landed on a screen version, with a count of what changed. |
| **AI generated a section** | The assistant returned a section for a page. Single-element rewrites are not logged one by one; their count is in the AI usage rollup. |
| **AI stop-at-band switch** / **AI overage ceiling** | Someone changed the workspace's AI overage controls on the Billing page. |
| **AI permission changed** | An AI permission moved on a role, a member, or a site collaborator. |
| **Added the AI add-on** / **Removed the AI add-on** | The AI add-on joined or left the subscription. |

The feed records the act and its size, never the brief you wrote or the copy the AI
produced — that is your site's content and stays in the site.

## AI usage per member {#ai-usage}

Each member's page carries an **AI usage** card: their AI credits **this month and
last**, their share of the workspace's pool, their requests, the kinds of request they
mostly made, and the split **by site**. The **Team** roster shows the same month's
credits as a column you can sort on, and every member for the month is on
[Billing → Usage](../billing-and-plans/overview.md#who-is-generating-what).

The card is visible to the member themselves and to members whose role carries **View
billing** or **Activity & audit log**; a manager without either sees the page without
the card. It describes who drew what, on which site — nothing more.

### AI allotment {#ai-allotment}

The same page carries an **AI allotment** card: the share of the workspace's AI credits
the member may draw each month — across every site for a team member, one per site for a
site collaborator — hard or soft, with any list of models. Members with **Manage
billing** set it there or on
[Billing → Usage](../billing-and-plans/overview.md#ai-allotments); a site's admin can set
a collaborator's on that site. The member sees their own allotment, and the assistant
shows it beside their usage as they work — see
[AI allotments, usage and model choice](../../ai/ai-allotments.md).

## Tips

- Start people on a least-privilege [role](custom-roles.md) and widen it with per-member
  overrides only where needed.
- Removing a member frees their seat.

## Related

- [Custom roles](custom-roles.md)
- [Members-only areas](members-only.md)
- [Billing & plans](../billing-and-plans/overview.md)
