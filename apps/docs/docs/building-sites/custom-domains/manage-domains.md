---
sidebar_position: 1.6
title: Manage your domains
description: See every domain your workspace holds on its Domains page, connect any of them to any site, move a domain here from another registrar, and edit its contact and DNS records.
---

# Manage your domains

Your workspace's **Domains** page lists every domain it holds through Aglyn: the ones
connected to a site, the ones that aren't connected yet, and the ones on their way. Open
it from your workspace's menu. Workspace owners and admins can open it.

:::info Plan availability
**Starter and above** for buying, transferring in and connecting domains. On a plan
without domains, the page still lists the domains you hold, and you can still turn
auto-renew on or off, edit their contacts and DNS records, or move them to another
registrar.
:::

## The list {#the-list}

Each row shows the domain, the **site** using it (or **Not connected**), its **status**,
when it **expires or renews**, whether **auto-renew** is on, and its **price at
renewal**. Click any column heading to sort by it. Click a row to open that domain.

The two buttons in the top corner of the list are **Buy a domain**, which buys a new
domain into your workspace (see [Buy a domain](buy-a-domain.md)), and **Transfer a domain
in**.

## One domain's page {#a-domain}

A domain's page has everything you can do with it:

- **Auto-renew** and **Renew now**, as described in
  [Buy a domain](buy-a-domain.md#renewals).
- **Connect to a site**, **Move to another site** and **Disconnect**.
- **Move to another registrar**, which shows its transfer code.
- Its **registrant contact**.
- Its **DNS records**.

## Connect a domain to a site {#connect}

1. Open the domain and press **Connect to a site**.
2. Pick the site.
3. If that site already has a domain, the dialog names it and explains that the new
   domain replaces it. The old domain stops serving the site; if it is one your
   workspace holds here, it stays in your workspace, unconnected, and stays registered
   to you.
4. Press **Connect** (or **Replace …** when it replaces a domain).

The domain usually serves the site within a few minutes, with its security certificate.
**Disconnect** takes a domain off its site. The site goes back to its free address, and
the domain stays in your workspace.

## Transfer a domain in {#transfer-in}

Move a domain you own at another registrar here, so it renews with your other domains
and is managed from this page.

Before you start, at your current registrar:

- **Unlock** the domain (sometimes called "transfer lock" or "registrar lock").
- Get its **transfer code** (sometimes called an auth code or EPP code).
- If **DNSSEC** is turned on, turn it off.

Then:

1. On the **Domains** page, press **Transfer a domain in**.
2. Type the domain and press **Check price**. The price is the same as renewing it here
   for a year, because a transfer adds a year to the domain's registration.
3. Enter the **transfer code**, fill in **Who the domain is registered to**, tick the box
   to agree to the domain registration terms, and press **Transfer for $…**.

A transfer takes **up to about 5 to 7 days**. Your current registrar may email you to
approve it. The domain keeps its current DNS the whole time, so its website and email
keep working. The domain's row shows **Moving here** until it arrives, and we email you
when it does. If the transfer doesn't complete, the charge is refunded and we email you
why.

Once it arrives, its DNS is still wherever it was before. To use it for a site, open it
and press **Connect to a site**.

## The registrant contact {#contact}

The registrant contact is who the domain is registered to. Open the domain and press
**Edit contact** to change it.

The registrar accepts a contact change only when the domain renews. So a change you
save here is sent with the domain's **next renewal**, and the page shows that date. Until
then the registrar keeps the current details. If auto-renew is off, the change is sent
only when you renew the domain.

The page also shows whether the registrant email has been **confirmed with ICANN**. If it
hasn't, it shows the date it must be confirmed by.

## DNS records {#dns}

DNS records tell the internet where your domain's website, email and other services
live. You can edit them here for a domain that uses Aglyn's nameservers, which a domain
bought here does.

- Press **Add record**, pick a **Type**, and fill in its fields: **Name** (leave it empty
  for the domain itself, or enter a subdomain like `shop`), the value, and any fields
  that type needs, such as **Priority** for a mail server.
- Click a record to change or delete it.
- Records marked **Managed by Aglyn** are how visitors reach your site at this domain
  and keep its security certificate working: the address records for the domain itself
  and `www`, and any CAA records. They can't be changed here, and a new one can't be
  added over them. Disconnect the domain from its site first if you need to.

If a domain uses another provider's nameservers (common for a domain you just
transferred in), the page names them and explains that its records are edited there.
There's no editor for it here.

## Move a domain to another registrar {#transfer-out}

See [Moving a domain to another registrar](buy-a-domain.md#transfer).
