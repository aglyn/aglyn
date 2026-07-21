---
sidebar_position: 1
slug: /
title: Welcome to Aglyn
description: What Aglyn is, the core concepts, and how to find your way around the docs.
---

# Aglyn Documentation

<div className="home-hero">
  <p className="home-hero__lead">
    Aglyn is a no-code platform for building and running websites. Design pages
    visually in the Besigner, bind them to your own data, and publish to a fast,
    SEO-ready site — all without writing code. These docs teach you how to use
    Aglyn feature by feature.
  </p>
</div>

![A site's dashboard in the Aglyn console](/img/getting-started/console-dashboard.png)

## Start here

<div className="home-grid home-grid--start">
  <a className="home-card" href="/getting-started/create-a-site">
    <div className="home-card__title">Create a site</div>
    <p className="home-card__desc">Sign in, spin up your first site, and understand what a site contains.</p>
  </a>
  <a className="home-card" href="/building-sites/besigner/overview">
    <div className="home-card__title">The Besigner</div>
    <p className="home-card__desc">Aglyn's visual editor — canvas, hierarchy, inline text, and styling.</p>
  </a>
  <a className="home-card" href="/whats-new">
    <div className="home-card__title">What's New</div>
    <p className="home-card__desc">The features Aglyn shipped most recently, grouped by area.</p>
  </a>
</div>

## Explore the docs

<div className="home-grid">
  <a className="home-card" href="/building-sites">
    <div className="home-card__title">Building sites</div>
    <p className="home-card__desc">The Besigner, screens and layouts, theming, bindings, SEO, protection, redirects, and domains.</p>
  </a>
  <a className="home-card" href="/content-and-data">
    <div className="home-card__title">Content &amp; data</div>
    <p className="home-card__desc">Datasets and dynamic content, the media library, forms, and the contacts CRM.</p>
  </a>
  <a className="home-card" href="/marketing-and-automation">
    <div className="home-card__title">Marketing &amp; automation</div>
    <p className="home-card__desc">Workflows and actions, email campaigns, overlays and experiments, AI assist, and analytics.</p>
  </a>
  <a className="home-card" href="/commerce-and-bookings">
    <div className="home-card__title">Commerce &amp; bookings</div>
    <p className="home-card__desc">Product catalog, storefront, orders, POS and reservations, and scheduling.</p>
  </a>
  <a className="home-card" href="/workspace-and-billing">
    <div className="home-card__title">Workspace &amp; billing</div>
    <p className="home-card__desc">Teams and roles, members-only areas, plans and entitlements, and billing.</p>
  </a>
  <a className="home-card" href="/developers/plugins/overview">
    <div className="home-card__title">Developers</div>
    <p className="home-card__desc">Build and publish plugins that extend the platform, and the plugin APIs.</p>
  </a>
</div>

## The mental model

A few concepts show up everywhere in Aglyn. Learn these first and the rest of the
product clicks into place.

```mermaid
flowchart TD
  H[Site — your website] --> S[Screens]
  H --> L[Layouts]
  H --> D[Data: datasets, variables, functions]
  H --> M[Media]
  L -. wraps .-> S
  D -. binds into .-> S
  M -. used by .-> S
  S --> P[Published site]
```

| Concept | What it is |
| --- | --- |
| **Site** | Your website — its screens, theme, data, domain, and settings. You can own more than one. |
| **Screen** | A page. Screens have a URL slug, live in a hierarchy, and are edited in the Besigner. |
| **Layout** | A shared frame (header/footer/nav) that many screens render inside via a layout **slot**. |
| **Besigner** | The visual editor. Drag components onto a canvas, arrange a hierarchy, and edit text inline. |
| **Component** | A building block on the canvas (Button, Image, Video, Form, and more). Can be made **reusable**. |
| **Binding** | A live reference in a text prop — `{'{{variable}}'}`, `{'{{fn:name(args)}}'}`, or a dataset field — resolved at render time. |
| **Dataset** | Structured content (a typed model with records) that screens read from and forms write to. |
| **Plan & entitlements** | Your subscription tier gates features and quotas (Free, Pro, Business). |

:::info Plan availability
**Free** for core building. **Pro** and **Business** unlock advanced features — each page
notes what it needs.
:::

Ready? Head to **[Create your first site](getting-started/create-a-site.md)**.
