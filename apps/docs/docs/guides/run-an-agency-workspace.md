---
sidebar_position: 8
title: Run an agency workspace
description: Set up one Aglyn workspace to build and hand off many client sites — templates, collaborator seats, per-site access, domains, backups and billing.
---

# Run an agency workspace

If you build sites *for other people* — an agency, a freelancer with a roster, an
internal team serving several brands — Aglyn is designed to be one workspace holding
many sites, rather than one account per client. This page is the whole shape of that
setup, in the order you'd actually do it.

It's written for someone who has built one Aglyn site already. If you haven't, do
[Build your first site](/learn/build-your-first-site) first — this page assumes you
know what a screen and the besigner are.

## The mental model, first {#the-model}

Three words, and getting them straight up front saves a lot of confusion later:

| Term | What it is | For an agency |
| --- | --- | --- |
| **Organization** | The billing and identity boundary. Owns the plan, the invoice, the members, the shared library. | **You.** One organization for your agency. |
| **Site** (or *host*) | One published website with its own screens, domain, media and store. | **One per client project.** |
| **Workspace** | What the console calls your organization when you're working in it. | Same thing as organization — you'll see both words. |

The consequence that matters: **your plan's limits are per organization, and your
access controls are per site.** You buy 25 sites once; you decide separately who can
touch which one.

:::tip One organization or one per client?
Use **one organization** when the sites are yours to run: you hold the domains, you
bill the client for a service, you're the one on call. That's the normal agency shape,
and it's what the Agency plan is priced for.

Use **a separate organization per client** when the client ultimately owns the
account and you're only building it — they hold the card, the domain, and the risk.
You then join their organization as a member and can leave cleanly.

The awkward middle — building in your workspace and later moving the site to theirs —
is the one thing that isn't self-serve, so decide before you start. Ask support if
you're not sure which side a project falls on.
:::

## Step 1 — Pick the plan by site count, not by features {#step-1-plan}

For agencies the binding limit is almost always **how many sites you can publish**,
not which features you get. Check the site allowance on the
[plan table](/workspace-and-billing/billing-and-plans/overview#tiers--entitlements)
and pick from there.

Two things that change the arithmetic:

- **Extra sites are an [add-on](/workspace-and-billing/billing-and-plans/add-ons)**, so
  you don't have to jump a whole tier for one more client. They're cheaper per site on
  higher plans.
- **The platform fee on client storefront sales falls to 0% on higher plans.** If your
  clients sell, that fee can dominate the subscription price — do that sum before
  choosing.

:::warning Upgrades are instant, downgrades are not
An upgrade applies immediately and prorates. A **downgrade waits until the end of the
period you already paid for**, and $0 is due on the day you choose it. Plan seasonal
capacity accordingly: dropping a tier in January doesn't reduce a January invoice.
[When each change takes effect](/workspace-and-billing/billing-and-plans/downgrading-and-canceling#when-changes-take-effect).
:::

## Step 2 — Build your house style once {#step-2-templates}

The single biggest saving in agency work is not rebuilding the same footer.

1. Build one site properly — nav, footer, contact page, legal pages, theme.
2. **Save it as a template** from the site's settings. See
   [Save a template](/building-sites/site-templates/save-a-template).
3. Start every new client from that template instead of from blank.

Two more things worth doing once:

- **[Reusable components](/building-sites/besigner/reusable-components)** for the
  pieces you'll place on many screens within a site. Edit the component, every
  instance updates.
- **The [organization media library](/content-and-data/media/overview)** for assets
  shared across clients — your own logo, stock photography you've licensed, icon sets.
  Files there are available to every site in the workspace, so you upload once.

:::tip Keep client assets in the client's site library
The organization library is shared across every site. Client logos and photography
belong in **that site's** library, not the shared one — otherwise the next project's
media picker is full of the last client's brand.
:::

## Step 3 — Decide who can touch what {#step-3-access}

Aglyn has two shapes of teammate, and the distinction is the one agency-specific thing
worth learning properly:

| | **Workspace manager** | **Site collaborator** |
| --- | --- | --- |
| Sees | Every site in the organization | Only the sites you grant |
| Costs | A **manager seat** | A **collaborator seat** on each site they can reach |
| Use for | Your own staff | Contractors, and **the client** |

**Give clients collaborator access, not manager access.** A manager can see every
other client's site, their content and their form submissions. That is usually a
contractual problem, and it's not undone by anyone being careful.

Steps:

1. **Organization → Team** to add your own staff as managers.
2. On each **site**, use its members card to invite that project's collaborators.
3. Use [custom roles](/workspace-and-billing/teams-and-roles/custom-roles) if you want
   something narrower than the built-ins — a client who may edit content but not
   publish, for example.

Seats are metered and enforced per plan, and both kinds are available as
[add-ons](/workspace-and-billing/billing-and-plans/add-ons) if you outgrow the
included count. A **pending invite holds a seat** — the count is checked when
you send it and again when it is accepted — so plan headcount against invites
sent, not invites accepted, or you will hit a refusal mid-onboarding.

Full detail: [Teams, roles & membership](/workspace-and-billing/teams-and-roles/overview).

## Step 4 — Domains and handover {#step-4-domains}

Each site gets a free `*.aglyn.app` subdomain immediately, which is what you build and
demo on. Connect the real domain at launch.

The handover question is **who owns the DNS**, and it's worth settling in writing at
the start of a project rather than at 5pm on launch day:

- **You hold the registrar** — fastest to launch, and you can fix things. It also
  means you're the one a client has to ask to leave, which some clients dislike and
  some contracts forbid.
- **The client holds the registrar** — slower (you'll be sending them records to
  paste), cleaner to hand over, and the honest default for most work.

Either way the records are the same, and the site's setup page shows them. See
[Connect a domain](/building-sites/custom-domains/connect-a-domain).

## Step 5 — Back up before you hand over {#step-5-backups}

Every site exports a full backup from its own settings. Take one:

- **before any large redesign**, so "put it back how it was" is a real option;
- **at handover**, and give the client a copy — it is theirs, and having it makes the
  relationship easier to end well;
- **before deleting anything.** Deleting a *site* is immediate and permanent, with no
  hold period — unlike deleting an organization, which has one. There is no undo and
  we keep no copy.

Take one from the site's **Setup → Backup & restore**. Datasets export separately to
CSV from **Content → Data**, so a full handover is usually both.

## Step 6 — Billing, and what to tell clients {#step-6-billing}

The invoice is **yours**, at the organization level. Aglyn doesn't bill your clients
and doesn't split an invoice per site. However you charge them — retainer, per site,
marked-up hosting — is between you and them.

Two things that are per site, and are the ones clients ask about:

- **Storefront platform fees** come out of that site's own sales.
- **Usage meters** (page views, storage, form submissions, emails) roll up to your
  organization total. A single client having a very good month can move *your*
  invoice, so watch the usage figures on the billing page rather than being surprised.

Sales tax is added on top of your plan price where applicable, calculated from your
**workspace's** billing address — see
[Sales tax](/workspace-and-billing/billing-and-plans/overview#sales-tax).

## Step 7 — Automate the repetitive part {#step-7-automate}

Once you're running several sites, the console stops being the fastest way to do
routine things. The [REST API](/api/) reads across your organization with one key:

- **[Sites](/api/resources/sites)** — enumerate every site and its domain, which is
  the basis of any status dashboard you build.
- **[Form submissions](/api/resources/form-submissions)** — pull every client's leads
  into one place, or into their CRM, and **mark each one read** as you go so the next
  run doesn't send it twice.
- **[Orders](/api/resources/orders)** and
  [Products](/api/resources/products) — for clients who sell.
- **[Media](/api/resources/media)** — audit alt text across every site, or find what's
  filling your storage quota.

Start with [Your first API call](./your-first-api-call.md), which walks through
creating a key and making a request from scratch.

:::tip One key per purpose
Create a separate key for each integration, scoped to the least it needs. A key that
only reads form submissions can't be turned into a data breach across every client's
store, and revoking one doesn't take the others down.
:::

## A checklist you can reuse per project {#checklist}

- [ ] Site created from your house template
- [ ] Client added as a **site collaborator**, not a manager
- [ ] Theme, logo, favicon set from the client's brand
- [ ] Legal pages present (privacy, terms, cookie banner if needed)
- [ ] Custom domain connected and verified
- [ ] SEO basics: titles, descriptions, social image, sitemap reachable
- [ ] Analytics visible to the client
- [ ] Backup taken and a copy given to the client
- [ ] Who holds the registrar, written down somewhere you'll find it

## Related

- [Teams, roles & membership](../workspace-and-billing/teams-and-roles/overview.md)
- [Site templates](../building-sites/site-templates/overview.md)
- [Add-ons](../workspace-and-billing/billing-and-plans/add-ons.md)
- [Your first API call](./your-first-api-call.md)
