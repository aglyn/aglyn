---
sidebar_position: 3
title: Design custom error screens
description: Replace generic 404/401/403/503 pages with branded screens you design.
---

# Design custom error screens

When something goes wrong, visitors should still see *your* site. Design custom **error
screens** for each status.

## The error screens

| Status | When it shows |
| --- | --- |
| **404** | The URL doesn't match any screen. |
| **401** | The visitor isn't authenticated for a protected screen. |
| **403** | The visitor is authenticated but not allowed. |
| **503** | The site is in [maintenance mode](maintenance-mode.md) or temporarily unavailable. |

## Design one

1. Open the error screen you want to customize (e.g. **404**).
2. Design it in the [Besigner](../besigner/overview.md) like any other screen — add your
   header/layout, a helpful message, and a link home.
3. Publish. Aglyn serves your designed screen for that status.

You can also set a dedicated **not-found** screen for missing pages.

## Tips

- Put a search box or navigation on your 404 so visitors can recover.
- Keep the 503 lightweight — it shows when the site is under maintenance.

## Related

- [Maintenance mode](maintenance-mode.md)
- [Password-protect a screen](password-a-screen.md)
