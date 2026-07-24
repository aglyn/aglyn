---
sidebar_position: 1
title: Plugins & Marketplace
description: Extend Aglyn with sandboxed plugins — install from the marketplace, configure them, and publish your own.
---

# Plugins & Marketplace

**Plugins** extend Aglyn with new components and capabilities. You install them from the
**organization marketplace** (**Marketplace** in the org navigation), configure them per
site, and they run **sandboxed** so they can't compromise your site.

The marketplace lives at the **organization** level — a single **Marketplace** destination
with **Browse**, **Installed**, and **Publish** tabs — rather than inside each site.

![The organization Marketplace in the Aglyn console — Browse, Installed and Publish tabs](/img/plugins/community-page.png)

![The Plugins & add-ons hub, where workspace admins enable plugins and manage installs](/img/plugins/org-plugins-page.png)

```mermaid
flowchart LR
  Host["Aglyn host runtime"] <-->|sandbox bridge protocol| Frame["Sandboxed PluginFrame<br/>(isolated by origin)"]
  Frame --> Comp["Plugin components<br/>in the drawer"]
  Host -->|host-mediated| Net["Network bridge"]
```

:::info Plan availability
**Free** to install community plugins; some plugins and marketplace monetization features
are paid.
:::

## Install & upgrade

- Open **Marketplace** in the organization navigation and **Browse** the listings.
- When you install a plugin, choose where it applies: **All sites** (organization-wide —
  including sites you add later) or **Selected sites** (a specific subset). Components,
  templates and layouts are site-scoped, so "All sites" installs them onto every current
  site and does **not** cover sites added later.
- Installs are **version-pinned**, and you can **upgrade** deliberately.
- Installed plugins appear as named entries in the Besigner **drawer**, alongside built-in
  components.
- Manage everything from the marketplace's **Installed** tab (and the organization's
  **Plugins & add-ons** page): first-party plugin toggles (with release state) plus every
  marketplace install with upgrade, uninstall, and share-with-organization actions.
- Installing enables the plugin for the workspace automatically; uninstalling disables
  it once no site keeps its own pin. **Uninstalling never deletes the data a plugin
  created** — reinstall and it picks up where it left off.

## How plugins run

- Each plugin loads into a **sandboxed PluginFrame** host runtime, isolated by origin.
- A **manifest + sandbox bridge protocol** defines what a plugin can do.
- A **host-mediated network bridge** lets plugins make network calls without direct access
  to your environment.

## Configure

Plugins expose a **settings** field for per-plugin configuration, so the same plugin can
behave differently on each site.

## Publish your own

The **publish + install pipeline** lets developers ship plugins to the marketplace with
version pinning. The community marketplace also supports **paid listings**, Stripe Connect
payouts, and a publisher **ledger**.

## Related

- [The Besigner](../../building-sites/besigner/overview.md)
- [Site templates & block library](../../building-sites/site-templates/overview.md)
- [Building feature plugins](building-feature-plugins.md) — the developer guide to every
  extension surface
- Repo docs: `docs/PLUGIN_LOADING.md` (loading architecture and trust tiers) and
  `docs/PLUGIN_PLATFORM_GAPS.md` (competitive analysis and the v2 roadmap)
