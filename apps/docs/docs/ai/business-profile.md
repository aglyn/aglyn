---
sidebar_position: 2.5
title: Business profile
description: Tell Aglyn AI what your business does, who it is for and how it sounds. Every AI job for the site reads it, uses your real contact details only, and remembers the edits you keep.
---

# Business profile

Every AI job for a site starts from what the site already knows about the
business: its name, what it does, its services, the area it serves, who it is
for, its tone of voice, and the contact details you entered. Aglyn AI writes
for **this** business instead of guessing, and it never makes up a way to reach
you.

![Setup → Business profile, with the source of each value under its field](/img/ai/business-profile.png)

## Where to edit it {#where-to-edit-it}

Open the site, go to **Setup → Business profile**. The page has three cards:

- **Business profile**: see [the Business profile card](#the-business-profile-card).
- **From your site settings**: the facts Aglyn AI reads from your other
  settings, each with a link to the card that edits it.
- **What Aglyn AI learned**: the preferences it took from edits you applied.

## The Business profile card {#the-business-profile-card}

The **Business profile** card holds what Aglyn AI writes for:

- **What the business does**, in a sentence or two;
- **Services**, one per line, up to 12;
- **Who it is for** and **Area served**;
- **Tone of voice**: Friendly and warm, Professional and clear, Playful and upbeat,
  Premium and refined, or Plain and direct, and **Notes on tone** for anything else.

Aglyn AI reads it on every job for the site and never replaces what you write here.

## Where the values come from {#where-the-values-come-from}

When a site is started with Aglyn AI, the profile is filled from your answers
to the guided start, and from what the plan wrote about the business. Each
field says where its value came from:

- **Your answers when the site was started**, or **Suggested by Aglyn AI**: a
  suggestion. Edit it and it becomes yours.
- An empty field that Aglyn AI still has a value for says so: the description
  in your SEO settings, or the workspace's default.

What you type is never replaced. A later job can fill an empty field, but it
never overwrites one you wrote, and a field you cleared stays clear.

### Workspace defaults {#workspace-defaults}

**Settings → Profile** has a **Business profile defaults** card. A site uses
those values wherever its own profile is empty, so a workspace that runs many
sites for one business writes them once. Only managers can change them.

## Contact details are never invented {#contact-details-are-never-invented}

The name, business type, email, phone, address, opening hours and social
profiles come only from **Setup → Basic details** and **Setup → SEO**, exactly
as entered. A detail you have not entered reads **Not entered**, and Aglyn AI
writes around it, or leaves a bracketed placeholder such as `[phone number]`
for you to fill, instead of making one up. The same goes for prices, reviews
and testimonials.

## What Aglyn AI learned {#what-aglyn-ai-learned}

When you apply an Assist edit that shows a preference, such as asking for
shorter copy, a friendlier tone, no emoji, or removing a testimonials section,
Aglyn AI keeps that as a short preference for the site. Later jobs read it.

This is Aglyn AI's memory for the site. It learns only from edits you **applied**,
never from ones you dismissed, and by fixed rules rather than another AI request. It
can learn:

- a tone: *Prefers a casual, friendly tone* or *Prefers a formal, professional tone*;
- a length: *Prefers short, concise copy* or *Prefers detailed copy*;
- *Does not want emoji in copy*;
- a kind of section you remove, such as testimonials and reviews, FAQs, pricing, stats,
  logo strips, newsletter sign-ups, team or gallery sections.

It keeps up to 12 preferences per site, and sends six of them with each job.

The **What Aglyn AI learned** card lists each preference and how many applied
edits it was seen in. Choose **Forget this** beside one to forget it, or
**Forget all** to clear the list. Later jobs stop using what you forget, and Aglyn AI
learns again from the edits you apply next. Anyone who can edit the site can see and clear
the list. A preference replaces an opposite one: asking
for detailed copy after asking for shorter copy keeps only the newer one.

## Which jobs read it {#which-jobs-read-it}

The site's plan, every build Assist plans for the site, Assist's edit turns,
and analytics insights read the profile. Insights read what the business is,
never its contact details. Free and paid workspaces get the same profile.

The profile is sent as one short block, at most about 400 tokens, that is
cached for the site, so it adds almost nothing to what a job costs.

## Related

- [How Aglyn AI builds](./how-aglyn-ai-builds.md)
- [Generate a site](./generate-a-site.md)
