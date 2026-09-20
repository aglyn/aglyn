---
sidebar_position: 5
title: Generate a page from a prompt
description: "An AI landing page generator built into the canvas: describe a page and Aglyn AI plans it, then builds it section by section as an unpublished draft from your own theme, layout, components and forms."
---

# Generate a page from a prompt

Describe the page you want, and an AI build job builds it for the site you have open: a new
screen in your layout, made from your theme and the components and forms your site already
has. It arrives as an unpublished draft, and nothing on your live site changes until you
publish it.

:::info Availability
Aglyn AI build jobs are released gradually. This page describes page jobs as they reach your
workspace.
:::

## Describe the page

Open **Screens** for the site and choose **Describe it**, beside **Templates** and **Create
New Screen**. You can also start one from **AI jobs** in the Assist panel, with **Describe a
page**.

Write what the page is for in one box: who it is for, what it should say and what visitors
should do next. You can also pick a page type (**Landing**, **About**, **Pricing**,
**Contact**, **Blog index**, **Product**, **Service** or **Event**) to tell the job what kind
of page it is. Then choose **Plan the page**.

## Review the plan

The job proposes a [plan](../../ai/how-aglyn-ai-builds.md#the-plan-comes-first) before it
builds anything: the layout the page renders in, the components and forms it places, anything
it needs to create first, the page's address and search title, and its sections from top to
bottom. Open **AI jobs** in the Assist panel to read it, with what the whole job is estimated to
use, then choose **Confirm plan** to build it, or cancel.

When the page needs something your site does not have yet, such as a layout, a reusable
component for cards that repeat, or a form, the plan lists it, and confirming builds it first,
in the same job, before the page that uses it. A plan only proposes what your workspace can
create: what your plan includes and what your site has room for. Something a page job does not
build, such as a page template or a dataset, is not offered for confirmation: the job stops
before you confirm anything and tells you what to create first and where.

On a plan without reusable components or saved forms, such as Free, the page is built from
what that plan can make: a block that repeats, such as a row of service cards, is built into
the page each time, in one section, and a form is part of the page, with its fields,
collecting submissions into your inbox like any form.

## How the page is built

The job first builds anything the plan creates, one at a time: a layout, a form or a reusable
component, each as a draft, the same way a layout, form or component job builds one. Then it
builds the page one section at a time, top to bottom, in the background, so you can leave the
Screens page while it works. Each section is checked against
[the building rules](../../ai/how-aglyn-ai-builds.md) as part of the whole page: one top-level
heading and headings in order, your theme's colors, spacing and type, and your components
placed as instances instead of copied.

- **Pictures** are image slots with a description of what belongs there, for you to fill from
  the media library.
- **Facts the brief does not give**, such as a price, a phone number or an address, appear in
  square brackets for you to fill in, instead of being invented. **AI jobs** lists them beside
  the draft, including the ones a component on the page shows until you set your own, named
  once for that component however often the page places it.

## The draft

When the job is done, the page is a new screen in **Screens**, and **Open draft** on the job
opens it in the Besigner.

- **It is not live.** The screen has no address on your site until you publish it, so it is
  not in your navigation, sitemap or site search, and visitors cannot reach it. Publish it
  from the Besigner like any other screen; see
  [versions and publishing](versions-and-publishing.md).
- **It is ready to publish.** It renders in the layout the plan chose, and it has an address,
  a search title and a search description written from the page's own text.
- **Navigation is yours to add.** When the brief calls for a navigation entry, the job
  suggests its label and address. Add it to your menu once the page is live.
- **What it created is a draft too.** A layout, form or component the job built first is in
  **Layouts**, **Forms** or **Components**, and **AI jobs** links to each. The page renders in
  the new layout and places the new component and form; nothing else on your site uses them
  until you do.
- **It counts like a screen you create.** The draft counts against your plan's screen
  allowance. When the site has no screen to spare, the job says so before it spends anything.

## What a page job uses

Each step of a page job counts toward your AI usage, including a section the job had to ask
for again. **AI jobs** shows what each job used. A page with more sections uses more.

On Free, a page's plan asks for no more sections than your monthly AI credits can always
build, even when every step uses the most it can: nine sections, or six when the job also
builds your site's layout.

## Who can use it

Page jobs need the **Generate with AI** permission. See
[who can use AI assist](../../ai/overview.md#who-can-use-it).

## Related

- [How Aglyn AI builds](../../ai/how-aglyn-ai-builds.md)
- [Screens](screens.md)
- [Layouts](layouts.md#generate-a-layout-with-aglyn-ai)
- [Versions and publishing](versions-and-publishing.md)
