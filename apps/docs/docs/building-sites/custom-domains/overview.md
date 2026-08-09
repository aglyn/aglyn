---
sidebar_position: 1
title: Custom Domains
description: Connect your own domain — subdomain or bare apex — with one-click DNS verification.
---

# Custom Domains

Every site starts on an Aglyn subdomain. When you're ready, connect your **own domain** —
a subdomain like `www.example.com` or the bare apex `example.com` — self-serve, from the
site's Setup page.

:::info Plan availability
**Starter and above.**
:::

![The custom domain card in site setup](/img/custom-domains/setup-domains.png)

## Connect a domain

1. In **Setup**, open the **Custom Domain** tab.
2. Add **one DNS record** at your registrar — a **CNAME** to `sites.aglyn.app` for a
   subdomain, or an **ALIAS/ANAME** to the same hostname for a bare apex (an **A record**
   where your registrar offers no ALIAS).
3. Type the domain into the **Domain** field and press **Verify & connect**. Aglyn
   checks DNS and connects the domain in the same click; SSL provisions automatically.

Each site carries **one** custom domain, shown as a chip on the card with **Re-attach**
and **Disconnect** actions beside it. Once it serves, your `*.aglyn.app` subdomain
redirects to it, path preserved, so old links keep working.

:::tip How-tos
- [Connect a domain](connect-a-domain.md) — steps, apex records (ALIAS first, A as the
  fallback), and what happens after
- [Troubleshoot verification](troubleshooting.md)
:::

## Related

- [Getting started: create a site](../../getting-started/create-a-site.md)
- [SEO toolkit](../seo/overview.md)
