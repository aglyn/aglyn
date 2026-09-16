---
sidebar_position: 1
title: AI Assist
description: Generate and rewrite copy, and build whole sections, with AI inside the Besigner.
---

# AI Assist

Aglyn's **AI assist** helps you write and build faster, right inside the editor.

:::info Plan availability
**Paid / env-gated**. AI features run through a managed Claude route.
:::

## Copy assist

Generate or rewrite text for **any canvas text prop** — headlines, body copy, button
labels — without leaving the Besigner. Blog entries can be drafted with AI too.

## AI Generate Section

**AI Generate Section** creates a constrained subtree of components directly on the canvas
from a prompt, giving you a real starting layout you can then refine.

:::note More detailed how-tos coming
Prompting tips and examples are on the way.
:::

## Who can use it

AI assist is a **permission** as well as a plan feature. Organization members hold
it through the **Use AI assistance** and **Generate with AI** keys on their role
(owners, admins and editors by default; viewers not), and site collaborators
through the **Assist** and **Generate** boxes on the site's Users card. A member
whose role lacks the key is refused with a message naming it — see
[Custom roles & permissions](../../workspace-and-billing/teams-and-roles/custom-roles.md#ai-permissions).

## Limits

AI assist draws on the same monthly allowance as Aglyn Assist, so a workspace
has one AI budget rather than a separate one per feature. Two limits apply:

- **A monthly message allowance per workspace.** Every rewrite, blog draft and
  generated section counts as one message. The allowance is generous enough
  that ordinary editing never reaches it — it exists so a scripted client
  cannot turn one subscription into unbounded usage. When a workspace reaches
  it, the editor says so; contact support if you genuinely need a higher cap.
- **A short-term rate limit per person**, which smooths bursts. If you see
  "Too many AI requests", wait a moment and try again.

A request that fails before the model answers — an outage upstream — does not
count against the allowance.

Inside the workspace's credits, an organization can give a member, a site collaborator
or a whole site its own monthly share, and anyone can see their usage and choose a model
while they work — see [AI allotments, usage and model choice](ai-allotments.md).

## Switch AI off for one site {#switch-ai-off-for-one-site}

AI is **on for every site** in a workspace. A site admin can switch it off for one site on
that site's **Admin → Plugins → AI** page, and the page says, beside the switch, what
switching it off stops and what it leaves running.

With AI off for a site:

- the assistant, **Describe it**, the SEO and theme cards, the editor's **Rewrite with AI**,
  **Generate a section with AI** and **Make a reusable component with AI** controls, and
  the AI columns on the site's collaborators card are gone from that site;
- every AI request made for the site is refused with **AI is switched off for this site.**,
  including one sent from a tab that was open before the switch;
- an AI job already queued for the site stops with the same sentence, and spends no
  credits. A job that stopped does not restart when AI is switched back on.

Switching AI off for a site does **not** stop the workspace's AI add-on, credits,
allotments or overage billing. AI keeps working on the workspace's other sites and on
workspace pages such as **Billing**, and an agency batch still builds the sites in it
that have AI on.

## Related

- [The Besigner](../../building-sites/besigner/overview.md)
- [Templates, blocks & content](../../building-sites/site-templates/overview.md)
