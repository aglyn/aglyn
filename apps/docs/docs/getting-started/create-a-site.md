---
sidebar_position: 1
title: Create a site
description: Sign in, create your first site, and understand what a site contains.
---

# Create a site

A **site** is one website you own in Aglyn — its pages, theme, data, domain, and
settings. Everything you build lives under a site, and you can own several.

![The All Sites page: the site allowance beside Create site, the Tasks due and CRM at a glance cards, and the search box and Filters button above the site cards, each with its status pill, Aglyn domain, custom domain, and Visit and Manage actions](/img/getting-started/sites-page.png)

## Create your first site

1. Sign in to the console.
2. Open the **site switcher** in the app bar (top-left) and choose **Create site**.
3. Give it a name. Aglyn generates a working subdomain immediately, so the site has a
   real address from the first moment — you can attach a
   [custom domain](../building-sites/custom-domains/overview.md) later.

   When you can use Aglyn AI, the new site opens on **Start your site**, which
   asks how you want to start: **Start from the starter site**, or **Start with
   AI**, which plans your pages from a few questions — see
   [Generate a website from a prompt](../ai/generate-a-site.md). Choosing the
   starter site, skipping or closing the window all give the site the starter
   described below. Choosing **Start from the starter site** publishes it at once,
   and the console says so: **Your site is live**, with the site's address,
   **View your site** and **Edit your pages**. Until you choose, the site's address shows a short *coming
   soon* page with its name, kept out of search results.

   Every other new site starts with the starter straight away. The starter is a
   complete website, published and open to search engines from the first visit:

   - a **Home** page at the site root with the sections an ordinary business site
     has — a hero with your site's name, what you offer, an about section, a photo
     gallery, testimonials, frequently asked questions, a call to action and a
     working contact form. Each section says how to make it yours, and the photos
     are placeholders to swap for your own under **Media**;
   - a shared **header and footer** layout every page you add renders inside, with
     your site's name, search, a light/dark switch and a Contact button. It is the
     site's one shared layout on the Free plan;
   - a **theme** (colors and fonts) under **Setup → Theme**, and a title,
     description and sharing image under **Setup → SEO**.

   Open the Home page from **Pages** to make it your own: once you publish your
   changes it is your home page like any other, and a starter applied later adds
   its pages beside it instead of replacing it. Or replace it: the first page you
   publish at the site root — one you build, one the AI drafts for you, or a
   [starter template](../building-sites/site-templates/overview.md)'s home page —
   takes over `/`, and the starting Home page is kept as an unpublished draft.
4. You land on the new site's **Setup** page (titled *Host Setup*), with tabs for
   Basic details, SEO, Tracking, Theme, and Emails; the custom domain and the
   activity log are under **Admin**. To start building
   rather than configuring, use the **Pages** tab in the site navigation — see
   [Publish your first page](publish-your-first-screen.md).

:::tip Name collisions
Site names must be unique enough to generate a valid subdomain. If a name is taken,
the console suggests an available variation.
:::

## What a site contains

- **Pages & layouts** — the pages and the shared frames they render in.
- **Data** — the datasets this site can see. Variables and functions are under
  **Logic**, and workflows and actions under **Automation**.
- **Media** — images, video, and files, organized in folders.
- **Setup** — theme, SEO, tracking, and emails under tabbed settings.
  The **Site logo** card (Details tab) sets your brand mark: it's shown on the
  live site's page-navigation loading overlay — a themed, blurred scrim with a
  progress bar. Without a logo, the loader shows your site name instead. Add a
  **Dark mode** logo too if yours is hard to see on a dark background: visitors
  browsing in dark mode see it on the loader and error pages, and without one
  they see the light mode logo.
- **Billing** — the plan and usage meters that gate features and quotas.

## Your site's details {#site-details}

A site's **Setup** page opens on its details: what the site is called, where it is
served from, and how it presents itself. The cards below are the ones to fill in first.

### Basic details {#basic-details}

The **Basic details** card names your site, sets its Aglyn address and picks the time
zone its dates are read in — fill in a display name and a subdomain, then press
**Update**.

- **Display name** — what the site is called in the console. See [below](#display-name).
- **Subdomain** — the site's address on Aglyn. See [below](#subdomain).
- **Time zone** — the day a published post is dated on this site. Leave it unset and the
  site follows your workspace's time zone; clear it with the **✕** to go back to that.

### Display name {#display-name}

The **Display name** is what the site is called inside the console — the site switcher,
breadcrumbs, the Sites list and notifications — up to 30 characters. Visitors never see
it: the title in their browser tab is your site's SEO **Title**, set under
**Setup → SEO**.

### Subdomain {#subdomain}

The **Subdomain** is your site's free address, up to 15 characters, and it works from
the moment the site exists. On aglyn.com it is the `name` in `name.aglyn.app`. It keeps
working after you [connect your own domain](../building-sites/custom-domains/connect-a-domain.md).
Changing it changes that address, so links to the old one stop working.

### Site logo {#site-logo}

The **Site logo** card sets your brand mark: pick a **Light mode** logo from your media
library — an SVG, or a PNG at least 400px wide — and add a **Dark mode** one if yours is
hard to see on a dark background. Your live site shows it on the loading overlay between
pages, and on error pages; without a logo it shows the site name instead, and dark-mode
visitors see the light logo when no dark one is set.

### Emails this site sends {#site-emails}

**Setup → Emails** lists the emails your site sends its own customers, grouped by the
feature that sends them. Press **Design** to make one your own in the Besigner, **Edit** to change one you
have customized, and **Reset to default** to go back to the built-in design. A group
marked *Not enabled on this site* sends nothing until that feature is switched on.

## Site Admin {#site-admin}

**Site Admin** holds the controls only a site's owners and admins should touch, kept
apart from Setup so a collaborator never trips over them. Open it from the site
navigation; its sections are:

- **General** — the site's basic details.
- **Plugins** — which of the workspace's plugins run on this site. See
  [Plugins on one site](../guides/install-your-first-plugin.md#site-plugins).
- **Custom Domain** — [connect your own domain](../building-sites/custom-domains/connect-a-domain.md).
- **Security** — who can reach the site.
- **Error pages** — the [pages shown when something goes wrong](../building-sites/site-protection/error-screens.md).
- **Activity** — the full log of changes made to the site.
- **Backup & template** — [download a backup or import a package](../building-sites/site-backup-and-packages.md).
- **Danger zone** — deleting the site.

### Who can open Site Admin {#who-can-open-site-admin}

Only a site's **admins** can open Site Admin; anyone else who follows a link to it is
told so instead of seeing the sections. To get in, ask a site admin or a workspace owner
to raise your role on this site — see
[Teams & roles](../workspace-and-billing/teams-and-roles/overview.md).

## Switching between sites

Use the site switcher in the app bar at any time. It lists your most recently used sites
first; with more than a handful, type in the **Find site…** box to search every site you
belong to by name, or choose **View all sites**. Your current site's display name appears
in the breadcrumbs so you always know which site you're editing.

## Next

- [Take the console tour](console-tour.md)
- [Publish your first page](publish-your-first-screen.md)
