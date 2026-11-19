---
sidebar_position: 6
title: Claude and other AI assistants
description: Connect Claude or another AI assistant to your Aglyn workspace. Sign in, choose what it may do, and ask it to look things up or make changes for you.
---

# Claude and other AI assistants

Connect [Claude](https://claude.ai) to your workspace and ask it for things in
plain words: *"Who filled in the contact form this week?"*, *"Add these five
services to my site"*, *"Change the headline on my About page"*, *"Mark order
1042 shipped with this tracking number"*, *"Log my call with Dana and remind me
on Friday."*

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
| **Pages** | See a site's pages and folders: their names, their addresses, and whether each one is published. Add a page, blank or from a template. Rename a page, change its address, move it to another place in your pages, or delete it. Publish pages you choose. |
| **What is on a page** | Read what is on a page. Change its text, pictures and links, change spacing, alignment and other styles, and add, move or remove parts of it. These changes are saved as a draft, which you review in the editor before you publish. |
| **Templates** | See the page templates a new page can start from. |
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
needs a plan with the CRM, orders and products need commerce, a new page counts
toward your plan's pages, and so on.

On a site, Claude can do only what you can do there yourself. To add a page,
change what is on a page, or change a site's products, search results,
business details or media, you need permission to edit that site's content. To
publish pages, delete a page, or change a page's address or where it sits, you
need permission to publish that site's content.

### Page changes wait for you; other changes are live at once {#changes-show-on-your-live-site}

**Changes to what is on a page wait as a draft.** When Claude changes the text,
pictures or layout of a page, your visitors see nothing new. Claude gives you a
link that opens the draft in the editor, so you can look it over and adjust
it. The changes go live only when the page is published, by you in
the editor or by Claude when you ask it to.

**A new page is not live either.** It has no address on your site until it is
published, so nobody can visit it yet.

**Some changes are live as soon as they are saved**, with no draft to check
first and no publish step:

- products and their prices and stock
- how your site and pages appear in search results
- your business details
- changes to a page that is already published: its name, its description, its
  address or where it sits, and deleting it

Before you approve one of these, read what Claude proposes to do.

### What it cannot do

Claude cannot change your site's theme, its layouts, your reusable components
or your templates themselves, and it cannot redesign a whole site. It cannot
cancel or refund an order, move or cancel a booking, rename or delete a site,
replace or delete media, or change your team, plan or billing. Do those in the
console.

Now and then a page has to be published from the editor instead. This can
happen on a page whose layout has style changes of its own, when its draft does
not include them: because someone removed them in the editor, or because Claude
made the draft before Claude's drafts kept them. Claude cannot tell whether you
want those style changes kept, so it tells you, and you open the page in the
editor, check it and publish it there.

On a page, Claude cannot set rich text with mixed formatting, or pick an icon:
it replaces rich text with plain text, and icons are picked in the editor.
Pictures come from your media library or a web address.

For products, Claude cannot add or remove a single variant on its own:
variants follow the product's options, such as sizes and colors, so it changes
the options instead. It cannot make digital products, gift cards or
subscriptions.

If you use Claude's browser extension, Claude can also work in the console
alongside you, in your own signed-in window, for anything above that it cannot
do on its own.

## Good habits

- **Start with View only** if you mainly want answers. You can connect again
  with more access later.
- **Ask Claude to tell you before it changes anything.** In Claude's connector
  settings you can also choose which actions need your approval each time.
- **Look at a page's draft before you publish it.** Open the link Claude gives
  you, check the page on phone and desktop in the editor, and only then ask
  Claude to publish it, or publish it yourself.
- **Check before you publish.** Publishing makes changes live for visitors.
  Product, search result and business detail changes, and changes to a
  published page's name, address or place, are live as soon as they are saved,
  so check those before you approve them too.
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
