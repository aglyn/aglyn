---
sidebar_position: 1
title: Teams, Roles & Membership
description: Invite teammates with custom roles, and offer members-only areas to your site's visitors.
---

# Teams, Roles & Membership

Aglyn has two kinds of people: your **team** (who build and manage the site) and site
**members** (visitors who sign up to your site). Both are permission-aware.

:::info Plan availability
**Paid**. Seats are metered per tier; see [Billing & plans](../billing-and-plans/overview.md).
:::

![The organization team page: roster, roles, and invites](/img/teams-and-roles/org-team-page.png)

## Team roles

- Invite teammates to a site and assign **roles**.
- Create **custom roles** with unique permission sets.
- Apply **per-member overrides** on top of a role.
- Permissions are enforced across the console's APIs and surfaces, and team members act in
  the **owner's** organization, not their own.

## Organizations

Aglyn is built around **organization workspaces**: an organization subscribes once, owns
multiple websites, and shares media, plugins, dynamic data and billing across them. You
can belong to several organizations with a different role in each (owner, admin, editor,
viewer), and editors/viewers can be limited to specific sites. Each organization gets a
Slack-style workspace address (`your-org.aglyn.com`).

Every account operates inside an organization — solo accounts simply get a personal
workspace automatically. The team features above keep working unchanged.

### Three kinds of user

The Team table labels every row with its **type**, because the type — not the role —
decides which seat it uses. The same `editor` role is one or the other depending on
whether their reach is the whole organization or a list of sites:

| Type | Reach | Seat |
|---|---|---|
| **Team manager** | The whole organization | One of your **team seats** (`managersPerOrg`) |
| **Site collaborator** | Only the site(s) they're granted | A **collaborator seat** on each site they can reach — never a team seat |
| **Site member** | A published site, as a visitor with an account | **None.** Free and unlimited on every plan |

Pending invites carry the same label, so you can tell a pending manager from a pending
collaborator before it's accepted.

### Site roles

Every person with access to a site holds one of four **site roles**. Managers get
`admin` on every site in the organization; collaborators are given a role per site.

| Site role | Can edit content | Can publish | Notes |
|---|---|---|---|
| **Viewer** | No | No | Read-only |
| **Author** | Yes | **No** | Drafts and edits everything; nothing they do goes live |
| **Editor** | Yes | Yes | The usual working role |
| **Admin** | Yes | Yes | Also manages the site's people, domain and plugins |

**Author** is the role to give a client who should work on their own content without
being able to put it in front of visitors. Concretely, an Author *cannot*:

- publish or unpublish a page, or change its address
- change which saved version a page, layout or component serves
- schedule any of the above for later
- publish, unpublish or schedule a collection entry
- delete a page, layout or component
- read the site's orders or its webhook signing secrets
- ring a sale at the register, or build a draft order
- issue or void a gift card
- publish a members-only post, or email it to subscribers
- create, change or delete a **redirect** — a redirect decides what every
  address on the live site serves, with no publish step in front of it

Everything else is open to them: writing and designing pages, editing layouts and
components, uploading media, drafting and editing entries, and saving as many versions
as they like. Someone with a publishing role reviews the draft and publishes it.

This is enforced in the database itself, not just hidden in the console — an Author
cannot publish through any route into Aglyn.

### What a site collaborator sees

Someone invited to a **specific site** rather than the whole organization gets a console
scoped to that site: they land on it when they sign in, and the organization pages —
Team, Media, Data, Plugins, Marketplace, Billing, Settings — aren't part of their
console at all. With access to more than one site, they get the sites list to choose
from. Organization-wide members see everything as before.

**Support** is one of those organization pages, so a site collaborator raises problems
with **whoever invited them** rather than with Aglyn directly — see
[Support & community](../support-and-community.md). Quota warnings still reach them on
their own site's pages, since a full site is a limit they will run into; the warning
names the workspace admin to ask instead of offering an upgrade they cannot buy.

## Site membership

- Visitors can **sign in / sign up** to your site.
- **Member accounts are unlimited on every plan** — including Free. Signups are never
  metered, capped, or charged per account.
- Gate screens as **members-only** so only signed-in members can view them.
- New members flow into your [CRM](../../content-and-data/contacts/overview.md).

### The platform safety limit {#visitor-record-ceiling}

There is one ceiling behind all of that, and it is an abuse control rather than a
plan dimension — the same number on every plan, free through enterprise, with
nothing to buy:

| Records on one site | Ceiling |
| --- | --- |
| Member accounts | 50,000 |
| Leads | 200,000 |

Past the ceiling, new sign-ups (or lead captures) are refused. The visitor sees
a plain "not accepting new accounts right now" message that does not name a
limit, and your console shows a **New member sign-ups are paused** notice with
the count of refusals this month.

**It does not clear on its own.** Unlike the form and bandwidth ceilings, this
one counts records you currently hold rather than a month's activity, so nothing
lifts it at the month boundary — the notice deliberately never names a date.
Deleting records below the limit starts acceptance again immediately, and if the
traffic is real, support will raise it.

## Seats

Seats cover your **team only**: organization seats (workspace-wide) and per-site
**collaborator seats** (teammates limited to one site). Both are metered and enforced;
buy seat add-ons to grow. Site **member accounts** — visitors who sign up to your
published site — are not seats and are never capped. See
[Billing & plans](../billing-and-plans/overview.md).

:::tip How-tos
- [Invite teammates](invite-teammates.md)
- [Custom roles & permissions](custom-roles.md)
- [Members-only areas](members-only.md)
:::

## Related

- [Billing & plans](../billing-and-plans/overview.md)
- [Staff console](../../staff-console/overview.md) (Aglyn staff only)
