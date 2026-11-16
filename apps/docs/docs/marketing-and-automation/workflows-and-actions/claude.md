---
sidebar_position: 6
title: Claude
description: Connect Claude to your Aglyn workspace so it can look things up and make changes for you - contacts, orders, form submissions, site content and more - after you sign in and choose what it may do. Rolling out.
unlisted: true
---

# Claude

:::caution Rolling out
Signing in to Aglyn from Claude is **not yet available**. Until it is, Claude
will not be able to finish connecting.
:::

Connect [Claude](https://claude.ai) to your workspace and ask it for things in
plain words: *"Who filled in the contact form this week?"*, *"Add these five
services to my site"*, *"Mark order 1042 shipped with this tracking number"*,
*"Log my call with Dana and remind me on Friday."*

You sign in to Aglyn and choose what Claude may do. There is nothing to copy
or paste, and you can disconnect it at any time.

## Connect Claude

1. In Claude, open **Settings → Connectors** and choose **Add custom
   connector**.
2. Name it *Aglyn* and enter this address:
   `https://app.aglyn.com/api/mcp`
3. Choose **Connect**. Aglyn opens and asks you to sign in if you are not
   already.
4. Pick the **workspace** Claude should work in.
5. Choose what it may do:
   - **View only** lets Claude look things up and nothing else.
   - **View and make changes** also lets it add and update things for you.
6. Choose **Allow**. You are returned to Claude, and Aglyn appears in its list
   of connectors.

Connecting takes the **Manage API keys** permission in the workspace, which
owners and admins have. It is part of plans that include API access.

On a Team or Enterprise plan for Claude, an owner of your Claude organization
adds the connector once, and each person then connects with their own Aglyn
sign-in.

## What Claude can do

| Area | Claude can |
| --- | --- |
| **Sites** | List your sites, create a site, and publish a site. |
| **Site content** | Read and edit datasets and their records - the content behind listings, service pages, menus and directories. |
| **Contacts and CRM** | Find, add, update and merge contacts. Work with companies, deals, tasks, activities, leads and email templates. |
| **Form submissions** | Read submissions, mark them read, and delete them. |
| **Orders and products** | Read orders and products, and mark an order shipped or delivered with its tracking number. |
| **Bookings** | Read bookings. |
| **Media** | List your media and upload new files. |

Each area follows your plan, the same way it does in the console: the CRM
needs a plan with the CRM, orders need commerce, and so on.

### What it cannot do

Claude cannot cancel or refund an order, move or cancel a booking, rename or
delete a site, replace or delete media, or change your team, plan or billing.
Do those in the console.

Designing a page is also done in the console, in the editor. If you use
Claude's browser extension, Claude can work in the console alongside you
there, in your own signed-in window.

## Good habits

- **Start with View only** if you mainly want answers. You can connect again
  with more access later.
- **Ask Claude to tell you before it changes anything.** In Claude's connector
  settings you can also choose which actions need your approval each time.
- **Check before you publish.** Publishing a site makes its changes live for
  visitors.
- What Claude reads from your workspace is handled by Claude under your
  agreement with Anthropic. Connect only a Claude account you trust with your
  customers' details.

## Disconnect Claude

1. In Aglyn, open your workspace's **Settings → API keys**.
2. Under **Connected apps**, find *Claude* and choose **Disconnect**.

Claude loses access right away. You can also remove the connector in Claude's
own settings.

Everything Claude does counts toward your plan's API requests, the same as any
other connected app. See [usage](/api/usage).

## Claude Code

If you use Claude Code, install the Aglyn plugin. It adds the same connection
plus guidance that teaches Claude how to work in Aglyn.

```bash
claude plugin marketplace add aglyn/aglyn
```

```bash
claude plugin install aglyn@aglyn
```

Then run `/mcp`, choose **aglyn**, and sign in.

## For developers

Scripts and servers with nobody to sign in can use an
[API key](/api/authentication) with the same address. The tools Claude sees
are the operations in the [REST API](/api).
