---
sidebar_position: 12
title: AI allotments, usage and model choice
description: Give a member, a site collaborator or a whole site a monthly share of the workspace's AI credits, see your own usage while you work, and choose which model answers.
---

# AI allotments, usage and model choice

A workspace's AI credits are one pool. **Allotments** decide how much of that pool one
person or one site may draw each month, so one client site, one contractor or one
teammate cannot spend what everyone else was counting on. Everyone sees their own usage
while they work, and can choose which model answers — or leave it on **Auto**.

## Allotments {#allotments}

An allotment is a number of credits a month, counted from the first of the month (UTC).
It can be set on:

- **A team member** — it counts what they draw on every site.
- **A site collaborator, on one site** — it counts what they draw on that site.
- **A whole site** — it counts what everyone draws on that site, together. An agency can
  give each client site its own share, so one site running out never touches another.

When more than one applies to a request — a collaborator's own allotment and their
site's — each one is checked, and the tightest is the one you see.

### Hard or soft {#hard-or-soft}

- **Hard** stops AI requests once the allotment is used for the month. The message says
  who can raise it.
- **Soft** keeps requests working, and notifies the person and the workspace's owners and
  admins — in the console and by email — when the month passes **80%** and again at
  **100%**, once per threshold per month.

An allotment is checked against what was drawn **before** a request, the same way the
workspace's own credits are, so a request that starts under the line can finish a little
past it. The next request is the one a hard allotment stops.

### The workspace's credits still come first {#the-pool-comes-first}

An allotment is a share of the pool, never an addition to it. The workspace's own limits
— its included credits, a stop at the included band, an overage ceiling — are checked
first. An allotment larger than the pool is allowed; the pool simply stops first.

### Limiting models {#limiting-models}

An allotment can also carry a list of models. The person or site then runs only on those
models, including when **Auto** chooses. On Agency and Enterprise, the organization can
restrict the models everyone uses the same way.

## Who can set them {#who-can-set-them}

- **Billing → Usage → AI allotments** lists team members and sites with this month's
  credits and their allotments. Select several to set one allotment for all of them, or
  use **Same for every client site** to give every site the same share at once. Seeing the
  section requires **View billing**; changing it requires **Manage billing**.
- **A member's page** under Team shows their allotment — one across every site for a team
  member, one per site for a site collaborator.
- **A site's Users card** has an **AI allotment** column for its collaborators and a
  **Site AI allotment** card for the site. A collaborator who is the site's **Admin** can
  set the other collaborators' allotments on that site. Nobody can raise their own.

Every change is recorded in the organization's activity feed.

## Your usage while you work {#usage-strip}

The assistant panel and the AI dialogs in the Besigner show a compact usage line once you
have made a request:

- **You** — your credits this month, against your allotment when one applies.
- **Workspace** — the pool's credits this month.
- **Last request** — what the request you just made cost.
- The model that answered.

From 80% of an allotment or of the pool it warns, and at a hard allotment it says who can
raise it. The line updates from the answer to each request, so it never costs a request
of its own; after a reload it shows where you stood at your last request.

## Choosing a model {#choosing-a-model}

The **Model** switch beside the assistant's message box and in each AI dialog lists:

- **Auto**, the default. The platform picks a model for each kind of request, and keeps to
  any model list your allotment or your organization set.
- The models your plan offers, each with the credits a typical request costs on it and how
  that compares with Auto. Once your workspace has made a few requests of that kind, the
  typical request is measured from them.

Your pick is remembered for you on each surface — the assistant, a rewrite, a generated
section. If your plan or an allotment no longer allows it, the request runs on Auto.
Free workspaces always run on Auto.

## Related

- [AI Assist](overview.md)
- [Billing & Plans: AI allotments](../workspace-and-billing/billing-and-plans/overview.md#ai-allotments)
- [Invite teammates: AI usage per member](../workspace-and-billing/teams-and-roles/invite-teammates.md#ai-usage)
