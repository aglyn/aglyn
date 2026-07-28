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
- New members flow into your [contacts CRM](../../content-and-data/contacts/overview.md).

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
