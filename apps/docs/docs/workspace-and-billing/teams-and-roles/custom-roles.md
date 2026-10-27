---
sidebar_position: 3
title: Custom roles & permissions
description: Define roles with unique permission sets and fine-tune access per member.
---

# Custom roles & permissions

Control what each teammate can do with **roles** — named permission sets — plus optional
**per-member overrides**.

:::info Plan availability
**Paid**.
:::

![The organization Team page, with each member's role picker and Permissions in the roster and Custom roles in the navigation](/img/teams-and-roles/org-team-page.png)

## Create a custom role

1. On the organization **Team** page, find the **Custom roles** card and choose
   **New role**.
2. Give it a name. The permissions are grouped by area (Organization, Billing, Team,
   Sites, Data, Marketplace and plugins) and by plugin (AI, Commerce and the others
   your workspace uses), and **Search permissions** finds one by name or description.
3. Set each permission to **Allow**, **Deny** or **Inherit**. Inherit falls back to
   the member's org role default, and each one says which org roles hold it by
   default. The switch beside a group's heading sets every permission in it at once.
4. Save, then assign it to members from the roster's **Custom role** column.

The permission catalog covers organization settings, the activity log, billing (view
and manage separately), member management, site creation and deletion, organization
data, marketplace publishing, plugin installs, the two AI keys, and every permission
the workspace's plugins add, such as **Use the point of sale** (`managePos`). A
plugin's permissions are listed while the plugin is on for the workspace. Owners,
admins and editors hold the point of sale by default and viewers don't, so a custom
role can hand the register to a viewer or take it from an editor.

### Point of sale permissions {#point-of-sale-permissions}

**Use the point of sale** (`managePos`) opens the register. Six finer permissions
split what it covers: **Sell at the register**, **Refunds and returns**, **Give
discounts at the register**, **Cash drawer and shifts**, **Registers and devices**
and **Buy point of sale hardware**. Each one follows **Use the point of sale**
until a role or a member sets it, which is what its **Inherit** says, so a role
that only turns the point of sale on or off works as it always has. Denying a finer
permission narrows the register for that role; allowing one never opens the
register by itself, because each also needs **Use the point of sale**. What each
covers is in [Who can do what at the register](../../commerce-and-bookings/commerce/pos-and-reservations.md#who-can-do-what-at-the-register).

### The AI permissions {#ai-permissions}

Two keys decide who may spend the workspace's AI credits:

| Permission | What it opens | Owner / Admin | Editor | Viewer |
|---|---|---|---|---|
| **Use AI assistance** (`ai.use`) | The assistant, copy rewrites, and "generate a section" in the Besigner | Yes | Yes | No |
| **Generate with AI** (`ai.generate`) | AI generation jobs and AI edits — pages, components, emails, campaigns, products, CRM, insights, workflows | Yes | Yes | No |

Both are ordinary catalog keys: a custom role can grant or deny either, and a
per-member override wins over the role. They are enforced at the AI endpoints
themselves — a member whose role lacks a key is refused with a message naming it
and asking them to see an organization admin, whichever button they reached it
by. A viewer may not ask the assistant even on the Free plan, so an admin can
switch AI off for a read-only teammate without changing their role.

Site collaborators are not decided by these keys. Their AI access is set per site,
from the site role — see [AI access for collaborators](overview.md#collaborator-ai-access).

Permissions are enforced on the server — every one of them is checked by the API that
performs the action, not merely used to hide a button — so a role reliably limits what
a member can do, whichever route they reach it by. Members without billing or settings
permissions don't see those tabs at all either.

The console follows the same permissions as the server. Someone allowed **Manage
members** can change roles, custom roles and per-member permissions on the Team page,
whatever their org role, and someone allowed **Organization settings** gets the
Profile, Plugins, Branding and Single sign-on settings and the General settings form.
Changing the workspace URL and handing the workspace over stay with the owner, and
API keys stay with owners and admins.

There is deliberately no permission for **marketing** surfaces (announcement bars,
popups, campaigns). Those belong to a **site**, not to the organization, and access to
them follows the member's role on that site — see
[Site access](./invite-teammates.md). An organization-level toggle would suggest a
control the model does not have.

## Effective permissions

Not sure what someone can actually do? The roster's **Permissions** column says what
is set for each member alone — **Role defaults** when nothing is, or how many
permissions are allowed and denied for them — and sorts by it. Choose it to open the
member's permissions: every permission with its final verdict and where that verdict
comes from (their org role, their custom role, or set for this member). The same
list is the **Permissions** card on the member's own page under **Team**.

## Per-member overrides

Need one person to have slightly more (or less) than their role? Set a **per-member
override** on top of the role instead of creating a whole new role for one exception.

1. Open the member from the **Team** roster (or choose their **Permissions** cell).
2. In **Permissions**, find the permission (grouped like the role editor, with
   **Search permissions**) and set it to **Allow** or **Deny**. **Inherit** clears
   the override, and says what the member falls back to.
3. Choose **Save permissions**.

Overrides win over both the org role and the custom role. A few rules hold them in
check:

- Only members who can manage people (`members.manage`) change overrides.
- The owner keeps every permission, so no override applies to them.
- Nobody changes their own overrides; ask another admin.
- You can only allow a permission you hold yourself, so managing people is not a way
  into billing or the register. The owner can allow anything.

Every change is recorded in the organization's activity log, one row per permission,
naming who changed it and what it became. Members who work on named sites (not the
whole workspace) get their permissions from their site access instead; set those per
site on the site's **Users** card — see
[AI access for collaborators](overview.md#collaborator-ai-access).

## Tips

- Model roles around jobs ("Editor", "Marketer"), not individuals.
- Use overrides sparingly — too many overrides make access hard to reason about.

## Related

- [Invite teammates](invite-teammates.md)
- [Members-only areas](members-only.md)
