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

The permission catalog covers organization settings, the activity log, API keys,
privacy requests, holds and reviews, billing (view and manage separately), member
management, site creation and deletion, the [site permissions](#site-permissions),
organization data, marketplace publishing,
plugin installs, the two AI keys, and every permission the workspace's plugins add,
such as **Use the point of sale** (`managePos`) and the
[reservation permissions](#reservation-permissions). A plugin's permissions are listed
while the plugin is on for the workspace. Owners, admins and editors hold the point
of sale by default and viewers don't, so a custom role can hand the register to a
viewer or take it from an editor. The permission decides on its own: a member's
role on the site no longer has to be admin or editor too, so a site viewer you
grant the register can work it.

### Point of sale permissions {#point-of-sale-permissions}

**Use the point of sale** (`managePos`) opens the register. Five finer permissions
split what it covers: **Sell at the register**, **Refunds and returns**, **Give
discounts at the register**, **Cash drawer and shifts** and **Registers and
devices**. Each one follows **Use the point of sale** until a role or a member sets
it, which is what its **Inherit** says, so a role that only turns the point of sale
on or off works as it always has. Denying a finer permission narrows the register
for that role; allowing one never opens the register by itself, because each also
needs **Use the point of sale**. What each covers is in [Who can do what at the register](../../commerce-and-bookings/commerce/pos-and-reservations.md#who-can-do-what-at-the-register).

**Buy point of sale hardware** (`posBuyHardware`) follows **Use the point of sale**
the same way until a role or a member sets it, but it stands on its own: allowing it
lets a member order card readers from the hardware shop without the register. That
suits a bookkeeper who orders the store's readers and never rings a sale. Denying it
keeps a cashier at the register and out of the shop. See
[Who can buy hardware](../../commerce-and-bookings/commerce/pos-hardware.md#who-can-buy-hardware).

### A site's access narrows its register and waivers {#site-access-narrows}

The register and waivers belong to a site. When an editor who works across the
whole workspace is given **Viewer** or **Author** access to one site, that site also
takes **Use the point of sale**, its five finer permissions, **Manage waivers** and
**Collect waivers** from them there. On every other site they keep what their role,
custom role and overrides give them, and members whose access matches their
workspace role everywhere (owners and admins always do) see no change.

Whether a permission follows the narrower site role is a setting of its own. Each
permission a site can narrow (the point of sale ones, the waivers ones and the two AI
ones) has a second choice under it, **On sites where their role is narrower**:

- **Follow the site role**: on that site the member holds what their Viewer or Author
  access holds, which for the register and waivers is nothing.
- **Keep this permission**: on that site they keep what their role, custom role and
  overrides give them everywhere else.
- **Inherit**: the layer below decides.

Set it on a custom role for everyone on that role, or on one member in their
**Permissions** card, where it wins over their custom role. Left on **Inherit**, the
built-in default applies: the point of sale and waivers permissions follow the site
role, and the AI permissions are kept, so nothing changes until you choose otherwise.
Keeping **Sell at the register** also keeps the register open for selling, and only
for selling. The choice changes something only for editors: owners and admins are
admins of every site, and a viewer has no narrower access to be given. Keeping a
permission for a member counts as granting it, so you can only keep one you hold
yourself.

To give a permission that follows the site role back on one site only, open the
site's **Users** card and choose **Permissions** beside them. The dialog lists just
the permissions that follow the site role for them, each **Allow**, **Deny** or
**Inherit** (what their narrower access leaves). Allowing **Sell at the register**
opens the register to sell and nothing else; allowing **Use the point of sale** gives
back the whole register, as far as their workspace role and custom role allow it.
Everything else about them is still set on their Team page.

### Site permissions {#site-permissions}

Four permissions decide what someone may do on a site:

| Permission | What it opens | Admin | Editor | Author | Viewer |
|---|---|---|---|---|---|
| **Edit site content** (`site.edit`) | Create and change pages, layouts, components, entries, media and the rest of a site's content, without making it live | Yes | Yes | Yes | No |
| **Publish site content** (`site.publish`) | Publish, unpublish and schedule pages and entries, delete pages and content, change redirects, choose a theme from the library, publish forms and members-only posts, and test an automation's actions | Yes | Yes | No | No |
| **See orders and webhooks** (`site.sensitive`) | Read the site's orders and returns, and set up its webhooks | Yes | Yes | No | No |
| **Manage site settings** (`site.manage`) | Manage the site's people, custom domain, address and plugins, change its plugin settings and security allow-lists, import and export it, and delete it or a collection (deleting the site also needs **Delete sites**) | Yes | No | No | No |

Each starts from the member's role on the site, the columns above, so nobody's access
changed when they became permissions. Owners and admins are admins of every site, and
someone whose access to one site differs from their workspace role starts from their
access there. A custom role or a per-member override can then grant or deny any of
them, and it applies on every site the member can reach. For someone added to one site
only, set them for that site in its **Users** card: choose **Permissions** beside them.

### Reservation permissions {#reservation-permissions}

Two permissions decide who may work a site's stays:

| Permission | What it opens |
|---|---|
| **Manage reservations** (`commerce.reservations`) | Check stays in and out, mark no-shows, cancel stays, and add, change and remove what can be booked, on the **Reservations** card and in the apps |
| **Book walk-ins and change guests** (`commerce.walkIns`) | Book a walk-in stay and change how many guests a stay is for |

Both start from the member's role on the site, so nobody's access changed when they
became permissions: a site's admins, editors and authors hold them, and viewers
don't. That includes someone whose access to one site is different from their
workspace role, such as an editor given **Viewer** access there, or a viewer given
**Editor** access there. A custom role or a per-member override can then grant or
deny either one, and it applies on every site the member can reach. **Book walk-ins
and change guests** follows **Manage reservations** until a role or a member sets it,
and it can be allowed on its own: the staff at your check-in window can book walk-ins
without changing anyone's booking. For someone added to one site only, set either one
for that site in its **Users** card: choose **Permissions** beside them.

### API keys, privacy requests, and holds {#api-keys-privacy-and-holds}

Three settings sections have a permission each. Owners and admins hold all three by
default, as they always could, and a custom role or a per-member override can hand
one to another member of the whole workspace, or take it from an admin:

| Permission | What it opens |
|---|---|
| **Manage API keys** (`org.apiKeys`) | **Settings → API keys**: create and revoke the workspace's REST API keys |
| **Privacy requests** (`org.privacy`) | **Settings → Privacy**, and **Erase this person** on a contact or lead: file a privacy erasure |
| **Holds and reviews** (`org.holds`) | **Settings → Holds & reviews**, and **Request a review** on a held page |

A site collaborator never holds them: each acts on the whole workspace. Notices about
holds are still emailed to the owners and admins.

### The AI permissions {#ai-permissions}

Two keys decide who may spend the workspace's AI credits:

| Permission | What it opens | Owner / Admin | Editor | Viewer |
|---|---|---|---|---|
| **Use AI assistance** (`ai.use`) | The assistant, copy rewrites, and "generate a section" in the Besigner | Yes | Yes | No |
| **Generate with AI** (`ai.generate`) | AI generation jobs and AI edits — pages, components, emails, campaigns, products, CRM, insights, workflows | Yes | Yes | No |

Both are ordinary catalog keys: a custom role can grant or deny either, and a
per-member override wins over the role. An editor given **Viewer** or **Author**
access to one site keeps both there unless a custom role or their own permissions
set them to **Follow the site role** — see
[A site's access narrows its register and waivers](#site-access-narrows). They are enforced at the AI endpoints
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
The API keys, Privacy and Holds & reviews sections follow their own permissions in
the same way. Changing the workspace URL and handing the workspace over stay with
the owner.

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
   the override, and says what the member falls back to. For an editor, a
   permission a site can narrow also offers **Follow the site role** or **Keep this
   permission** for sites where their access is narrower — see
   [A site's access narrows its register and waivers](#site-access-narrows).
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
[AI access for collaborators](overview.md#collaborator-ai-access). A site that gives a
workspace editor narrower access sets their register and waivers there, on the same
card — see [A site's access narrows its register and waivers](#site-access-narrows).

## Tips

- Model roles around jobs ("Editor", "Marketer"), not individuals.
- Use overrides sparingly — too many overrides make access hard to reason about.

## Related

- [Invite teammates](invite-teammates.md)
- [Members-only areas](members-only.md)
