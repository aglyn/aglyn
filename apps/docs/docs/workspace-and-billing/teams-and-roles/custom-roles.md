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

![Roles on the organization team page](/img/teams-and-roles/org-team-page.png)

## Create a custom role

1. On the organization **Team** page, find the **Custom roles** card and choose
   **New role**.
2. Give it a name and set each **permission** to granted, denied, or inherit (inherit
   falls back to the member's org role default).
3. Save, then assign it to members from the roster's **Custom role** column.

The permission catalog covers organization settings, the activity log, billing (view
and manage separately), member management, site creation and deletion, data,
marketing, marketplace publishing, and plugin installs.

Permissions are enforced everywhere — across the console's APIs and every surface — so a
role reliably limits what a member can see and do. Members without billing or settings
permissions don't see those tabs at all.

## Effective permissions

Not sure what someone can actually do? Every member row has a **Permissions** viewer
that resolves their org role defaults, custom role, and per-member overrides into the
final yes/no grant list.

## Per-member overrides

Need one person to have slightly more (or less) than their role? Apply a **per-member
override** on top of the role instead of creating a whole new role for one exception.

## Tips

- Model roles around jobs ("Editor", "Marketer"), not individuals.
- Use overrides sparingly — too many overrides make access hard to reason about.

## Related

- [Invite teammates](invite-teammates.md)
- [Members-only areas](members-only.md)
