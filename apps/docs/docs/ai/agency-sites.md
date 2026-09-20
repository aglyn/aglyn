---
sidebar_position: 13
title: An AI website builder for agencies
description: "Run one brief across many client sites: each is its own build job with its own plan and drafts, per-site allotments keep spend separate, and nothing reaches a client's live site until your team publishes it."
---

# An AI website builder for agencies

An agency's problem with a website builder is rarely the first site. It is the
twentieth: twenty logins, twenty billing relationships, twenty slightly different
stacks, and a first draft that costs the same on the twentieth site as it did on the
first.

Aglyn AI runs from the console your team already signs in to, against the sites your
organization already owns. One brief can start a build on many client sites at once —
and each one stays a separate job you review.

:::caution Rolling out
Aglyn AI is a **release-flagged feature, currently being rolled out** — it is not
available in every workspace yet. This page says how a batch behaves, and grows with
the feature.
:::

## One brief, many client sites {#one-brief}

A batch takes the brief once and starts a [site build job](./generate-a-site.md) per
site you picked. It is not one job writing twenty sites: each site gets its own plan,
its own confirmation and its own drafts, so a plan you dislike on one client costs you
that client's credits and nothing else.

The batch also asks once where form submissions should go, and binds that answer to
every job it starts — the Inbox, or the Inbox and a CRM lead for each message that
carries an email address. You can change it on any individual form afterwards.

## What is shared, and what is not {#shared-and-not}

The brief is shared. Nothing else is.

Each job reads the site it is building for — that site's theme, its layout, its
components and its forms — and builds from those, following
[the building rules](./how-aglyn-ai-builds.md). Two clients with the same brief and
different themes get drafts that look like their own sites, because the generator has
each site's own material to build from rather than a prompt and a blank page.

## The organization model it assumes {#organization-model}

A batch operates on the sites inside one organization. If your agency runs every
client as a site in a single workspace, a batch can reach all of them; if each client
has its own separate organization, a batch reaches one client at a time.

Which of those to run is a decision that predates AI and outlives it —
[running an agency workspace](../guides/run-an-agency-workspace.md) covers the
trade-offs, and AI does not change them.

## Keeping spend separate per client {#per-client-spend}

Credits are a workspace pool, so without a limit one busy client can draw down what
another's work needs. An **allotment** is how you divide it: a monthly number of
credits for a whole site, a member, or a site collaborator, counted from the first of
the month.

A **hard** allotment stops AI requests for that site once it is used; a **soft** one
records the same number and lets work continue. Either way an allotment is a share of
the pool and never an addition to it — the workspace's own limits still apply first.
[AI allotments, usage and model choice](./ai-allotments.md) has the full behavior,
including limiting which models a client's site may use.

## Turning AI off for one client {#off-for-one-site}

A client who does not want generative work on their site can be opted out without
affecting anyone else. Switching AI off for a site hides the assistant, **Describe
it**, the AI cards and the editor's AI controls on that site, refuses every AI request
made for it, and stops its queued jobs without spending credits.

It does not stop the workspace's AI add-on, its credits, its allotments or its
billing, and AI keeps working on the workspace's other sites.

## White-label is a separate setting {#white-label}

Generating a client's site and removing Aglyn's name from it are two different
features. [White-label](../workspace-and-billing/white-label.md) replaces the Aglyn
brand across the console, your published sites and transactional email; it is its own
setting with its own entitlement, and having the AI add-on does not include it.

## Who publishes {#who-publishes}

Nobody's client site goes live because a job finished. Every generation writes an
unpublished draft, or a new unpublished version of something that already exists — it
never flips a published version, registers an address on a live site, changes
navigation or sends anything.

An account manager opens each draft in the editor, changes what they want, and
publishes it. On twenty sites that is twenty deliberate acts by a person, which is the
point: the batch removes the typing, not the review.

## Related {#related}

- [Generate a website from a prompt](./generate-a-site.md) — what a single site job plans and builds
- [How Aglyn AI builds](./how-aglyn-ai-builds.md) — the rules every job is held to
- [AI allotments, usage and model choice](./ai-allotments.md) — dividing the pool per site or member
- [Running an agency workspace](../guides/run-an-agency-workspace.md) — one workspace or many
- [White-label](../workspace-and-billing/white-label.md) — replacing the Aglyn brand
