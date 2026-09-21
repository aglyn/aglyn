---
sidebar_position: 1
title: "Aglyn AI: the AI website builder"
description: "Aglyn AI is an AI website builder inside your console: describe a page, form, email, product listing or theme change and it builds a draft you edit and publish yourself. An add-on on every paid plan, metered in credits."
---

# Aglyn AI: the AI website builder

**Aglyn AI** builds for your site. Describe what you want — a page, a reusable
component, a layout, a page template, a form, an email, a campaign, product copy, a
theme, your search titles and descriptions — and it plans the work, builds it from
what your site already has, and hands you a draft to review.

:::caution Rolling out
Aglyn AI is a **release-flagged feature, currently being rolled out** — the doors
described here do not all appear in every workspace yet. This section says what each
one does, and grows as each reaches you.
:::

It is the same assistant as [Aglyn Assist](../getting-started/aglyn-assist.md), which
answers questions about the product from this documentation. Aglyn AI is what that
assistant does when it stops explaining and starts building.

## The one rule worth knowing first {#drafts-only}

**Every generation writes a draft. Nothing goes live until a person publishes it.**

That is not a setting and there is nothing to switch on. A build job writes a new
draft, or a new unpublished version of something that already exists. It never flips a
published version, never registers an address on your live site, never changes your
navigation and never sends anything. A generated page has no live URL until you open
its draft and publish it through the same button you always use; a generated email sits
unsent; a generated theme waits in the theme editor as unsaved changes. A drafted
automation arrives switched off.

Because of that, a job is safe to run and safe to abandon. The worst a bad answer costs
you is the credits it spent and a draft you delete.

## What it can build {#what-it-can-build}

Each capability has its own page, next to the thing it builds:

| You want | Where you start | The page |
| --- | --- | --- |
| A page from a brief | **Screens → Describe it** | [Generate a page](../building-sites/screens-and-layouts/generate-a-page.md) |
| A whole small site | **Screens**, or **Sites** for several at once | [Generate a site](generate-a-site.md) |
| Many client sites, run as an agency | **Sites** | [An AI website builder for agencies](agency-sites.md) |
| A layout — header, navigation, footer | **Layouts → Describe it** | [Generate a layout](../building-sites/screens-and-layouts/layouts.md#generate-a-layout-with-aglyn-ai) |
| A page template | **Templates → Describe it** | [Generate a page template](../building-sites/site-templates/templates-library.md#generate-a-page-template-with-aglyn-ai) |
| A reusable component | **Components → Describe it** | [Generate a component](../building-sites/components/generate-a-component-with-aglyn-ai.md) |
| A form | **Forms → Describe it** | [Generate a form](generate-a-form.md) |
| A section on the canvas | The Besigner | [Generate a section](generate-section.md) |
| Copy, rewritten or fresh | Any text in the Besigner | [Rewrite and write copy](copy-assist.md) |
| A change to your theme | **Setup → Theme** | [Change your theme with AI](theme-assist.md) |
| Search titles and descriptions | **SEO** | [SEO by AI](../building-sites/seo/seo-by-ai.md) |
| Product copy, catalog and discount ideas | **Commerce** | [Products with AI](products-with-ai.md) |
| Help working the CRM | A record, the composer, an import | [CRM by AI](crm-by-ai.md) |
| A designed email | **Email → Describe it** | [Generate an email](../marketing-and-automation/email-campaigns/generate-with-ai.md) |
| A campaign | **Campaigns** | [Generate an email](../marketing-and-automation/email-campaigns/generate-with-ai.md) |
| Variants for an A/B test, and its result in words | **Marketing → Experiments** | [A/B tests by AI](ab-tests-with-ai.md) |
| What your analytics mean | **Analytics → Insights** | [Insights](../marketing-and-automation/analytics/insights.md) |
| A change to the page you have open | The Assist panel, in the Besigner | [Edits in the Besigner](../getting-started/aglyn-assist.md#edits-in-the-besigner) |

Everything in that table follows the same building rules — reuse before creating, your
theme's colors and spacing, one reusable component for a repeat, images from your media
library with alt text, and a measured size. They are written out on
[How Aglyn AI builds](how-aglyn-ai-builds.md), and every plan and every generated
document is checked against them before you see it.

### Not available yet {#not-yet}

- **Drafting an automation from a description.** The door exists on
  **Automation → Actions**, and what it is meant to do is on
  [Explain automations with AI](automations-with-ai.md) — but a draft is
  currently cut short at its size ceiling and can arrive with one step where the
  description asked for several, so it is not open. **Explain an automation** and
  **Why did this fail?** on the same pages are unaffected.

## The Aglyn AI add-on {#the-add-on}

Aglyn AI is an **add-on**, bought once for the workspace on any paid plan, not per seat
and not per site. With it on, every member who has the permission to generate can use
every door above, on every site in the workspace.

- It adds a band of **AI credits** to the band your plan already includes.
- Every paid plan already includes some credits, Starter included, so the add-on widens
  a band you have rather than opening your first one. On Starter it also opens the
  guided assist that Pro and up already include.
- Enterprise workspaces carry generative building in their agreement rather than buying
  the add-on.
- **Free workspaces** do not buy it. A Free workspace gets a small monthly allowance of
  credits instead, enough to try generating, and it stops at that allowance rather than
  billing you.

What the add-on costs, and the size of the band it adds, are on
[aglyn.com/pricing](https://aglyn.com/pricing) and in **Billing** before you confirm —
see [Add-ons](../workspace-and-billing/billing-and-plans/add-ons.md#aglyn-ai).

## Credits and caps {#credits-and-caps}

Everything AI does — an answer from the assistant, a rewrite, a generated section, a
whole site — is metered in **AI credits** from one workspace pool. There is no second
meter per feature.

What a request costs is not fixed: a rewrite of one headline is small, a site scaffold
is large, and a job tells you its estimate before you confirm it. The shape of the
limits is the part worth knowing:

- **An included band each month**, from your plan plus the add-on, reset monthly.
- **Past the band**, a paid workspace keeps working and the extra credits bill on the
  monthly invoice at your plan's rate. A switch under **Billing → Usage** stops AI at
  the included band instead; it is off unless you choose it.
- **A ceiling you set**, so overage can never pass a figure you are comfortable with.
- **Alerts on the way there**, to the workspace's owners and admins.
- **Allotments**, which give one member, one site collaborator or one whole site its
  own monthly share of the pool, hard or soft — see
  [AI allotments, usage and model choice](ai-allotments.md). An agency can give each
  client site its own share so one site running out never touches another.
- **A short-term rate limit per person**, which smooths bursts rather than capping your
  month. If you see "Too many AI requests", wait a moment and try again.

A request that fails before the model answers does not spend credits. An answer that
was generated and then refused for breaking a building rule does — the rules page says
which, and why.

The figures behind all of that are on
[Billing & Plans](../workspace-and-billing/billing-and-plans/overview.md#assist-overage),
and your own usage is on **Billing → Usage**.

## Who can use it {#who-can-use-it}

Aglyn AI is a **permission** as well as a plan feature. Organization members hold it
through the **Use AI assistance** and **Generate with AI** keys on their role (owners,
admins and editors by default; viewers not), and site collaborators through the
**Assist** and **Generate** boxes on the site's Users card. A member whose role lacks
the key is refused with a message naming it — see
[Custom roles & permissions](../workspace-and-billing/teams-and-roles/custom-roles.md#ai-permissions).

Nobody can raise their own allotment.

## Switch AI off for one site {#switch-ai-off-for-one-site}

AI is **on for every site** in a workspace. A site admin can switch it off for one site
on that site's **Admin → Plugins → AI** page, and the page says, beside the switch, what
switching it off stops and what it leaves running.

With AI off for a site:

- the assistant, **Describe it** on the Screens, Templates, Layouts, Forms and
  Components pages, the SEO and theme cards, the editor's **Rewrite with AI**,
  **Generate a section with AI** and **Make a reusable component with AI** controls, and
  the AI columns on the site's collaborators card are gone from that site;
- every AI request made for the site is refused with **AI is switched off for this
  site.**, including one sent from a tab that was open before the switch;
- an AI job already queued for the site stops with the same sentence, and spends no
  credits. A job that stopped does not restart when AI is switched back on.

Switching AI off for a site does **not** stop the workspace's AI add-on, credits,
allotments or overage billing. AI keeps working on the workspace's other sites and on
workspace pages such as **Billing**, and an agency batch still builds the sites in it
that have AI on.

## What happens to what you send {#what-is-sent}

A build job is sent your brief and what it needs to build against it — the names of the
components, layouts, forms and datasets your site already has, your theme's values, and
the copy of anything it is starting from. Each capability's page says exactly what its
own job is sent, and the CRM and automation pages say what is removed first.

Your brief is customer text and is kept with the job for 180 days, then deleted. No
contact, lead, deal, form submission or list member is read to build a page.

## Related

- [How Aglyn AI builds](how-aglyn-ai-builds.md)
- [Aglyn Assist](../getting-started/aglyn-assist.md)
- [AI allotments, usage and model choice](ai-allotments.md)
- [Add-ons](../workspace-and-billing/billing-and-plans/add-ons.md#aglyn-ai)
- [The Besigner](../building-sites/besigner/overview.md)
