---
sidebar_position: 6
title: Claude and other AI assistants
description: Connect Claude or another AI assistant to your Aglyn workspace. Sign in, choose what it may do, and ask it to look things up or make changes for you.
---

# Claude and other AI assistants

Connect [Claude](https://claude.ai) to your workspace and ask it for things in
plain words: *"Who filled in the contact form this week?"*, *"Add these five
services to my site"*, *"Mark order 1042 shipped with this tracking number"*,
*"Log my call with Dana and remind me on Friday."*

You sign in to Aglyn and choose what the assistant may do. There is nothing to
copy or paste, and you can disconnect it at any time.

The steps below use Claude. [Other assistants](#other-assistants) connect the
same way.

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
owners and admins have. It is included from the Starter plan.

On a Team or Enterprise plan for Claude, an owner of your Claude organization
adds the connector once, and each person then connects with their own Aglyn
sign-in.

## Other assistants {#other-assistants}

Aglyn works with any assistant or tool that supports the Model Context
Protocol (MCP) with sign-in, not only Claude.

1. In the assistant, find where it adds a connector, app or MCP server.
2. Enter the address `https://app.aglyn.com/api/mcp`.
3. Sign in to Aglyn when it asks, pick the workspace and what the assistant may
   do, and choose **Allow**.

Before you choose Allow, Aglyn shows the name the app gives itself and **where
it returns to**. Check that this is the assistant you started from. Only
continue if you started connecting it yourself.

Everything on this page applies to any connected assistant: what it can and
cannot do, your plan, and how to disconnect it.

## What Claude can do

| Area | Claude can |
| --- | --- |
| **Sites** | List your sites, create a site, and publish a site. |
| **Pages** | See the list of a site's pages: their names, their addresses, and whether each one is published. |
| **Search results** | See and change how your site and each of its pages appear in search results: the title and the short description. |
| **Business details** | See and change your business name, slogan, phone number, email, address and social links. |
| **Site content** | Read and edit datasets and their records - the content behind listings, service pages, menus and directories. |
| **Contacts and CRM** | Find, add, update and merge contacts. Work with companies, deals, tasks, activities, leads and email templates. |
| **Form submissions** | Read submissions, mark them read, and delete them. |
| **Products** | Add, edit and delete products, with their prices and stock. A new product starts hidden from your store until you choose to put it on sale. |
| **Orders** | Read orders, and mark an order shipped or delivered with its tracking number. |
| **Bookings** | Read bookings. |
| **Media** | List your media and upload new files. |

Each area follows your plan, the same way it does in the console: the CRM
needs a plan with the CRM, orders and products need commerce, and so on.

On a site, Claude can do only what you can do there yourself. To change a
site's products, search results, business details or media, or to publish it,
you need permission to edit that site's content.

### Changes show on your live site

Changes to products, to how your site appears in search results, and to your
business details show on your live site as soon as they are saved. There is no
draft to check first. Before you approve a change, read what Claude proposes
to do.

If many of these changes are made to one site in a short time, the later ones
can take a few minutes to show.

### What it cannot do

Claude cannot change what is on a page or how it looks, cancel or refund an
order, move or cancel a booking, rename or delete a site, replace or delete
media, or change your team, plan or billing. Do those in the console.

For products, Claude cannot add or remove a single variant on its own:
variants follow the product's options, such as sizes and colors, so it changes
the options instead. It cannot make digital products, gift cards or
subscriptions.

Designing a page is done in the console, in the editor. If you use
Claude's browser extension, Claude can work in the console alongside you
there, in your own signed-in window.

## Good habits

- **Start with View only** if you mainly want answers. You can connect again
  with more access later.
- **Ask Claude to tell you before it changes anything.** In Claude's connector
  settings you can also choose which actions need your approval each time.
- **Check before you publish.** Publishing a site makes its changes live for
  visitors. Product, search result and business detail changes are live as
  soon as they are saved, so check those before you approve them too.
- What Claude reads from your workspace is handled by Claude under your
  agreement with Anthropic. Connect only a Claude account you trust with your
  customers' details.

## Disconnect Claude

1. In Aglyn, open your workspace's **Settings → API keys**.
2. Under **Connected apps**, find the assistant and choose **Disconnect**.

It loses access right away. You can also remove the connector in Claude's
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
