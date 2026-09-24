---
sidebar_position: 4
title: Your templates library
description: Save pages, components and layouts as reusable templates — and the safe landing place for anything you install from the marketplace.
---

# Your templates library

**Templates** are saved starting points. A template is inert: nothing in your library
is on your live site until you deliberately use it. That is the whole point of the
library — it means installing something from the marketplace can never publish pages
to a site you are running.

Find it at **Templates** in a site's navigation, alongside Screens, Layouts and
Components — the three things a template can produce.

A template is a **copy**, not a live link: once you use one, the result is yours outright
and editing the template never changes what you already made. If you want one edit to
update every place a thing appears, you want a
[reusable component](../besigner/reusable-components.md). If you want one frame around
many pages, you want a [layout](../screens-and-layouts/layouts.md).

**Filters** in the library's toolbar narrows it by **Kind** (page, component, or
layout), **Source** (marketplace, starter, or saved here), name, description, or date,
and **Search** matches any word of the name or description. Filters look at every
template the library read, and each one in force shows as a chip above the table.

## The three kinds

| Kind | What it holds | What you get from it |
| --- | --- | --- |
| **Page** | A screen's content | A new screen, unpublished |
| **Component** | An element tree | A reusable component, or a drop onto a screen |
| **Layout** | Page chrome — header, footer, navigation | A new shared layout |

## Installing from the marketplace

Installing a marketplace template **adds it to your library and publishes nothing**.
A site template arrives as one page template per page it contains, so you choose which
of them you actually want, and when.

This is deliberate: browsing and installing should never be able to change a site that
real people are looking at. If the template was designed around a particular theme, that
theme travels with it rather than being applied to your site.

A marketplace **component** or **layout** brings the properties it declares — each one's
kind, label, help text, answers, settings and condition — so its `{{prop.*}}` tokens still
have properties to fill them, and updating to a newer version takes the publisher's new
properties with it. A property's default is checked before it reaches your site the same
way the published design is: a link, an image address, or formatted text that could run
script is removed, and the property arrives with no default instead. The property itself
always comes through, so its field still shows wherever you use the component or layout.
A link or image the design takes from a **Link** or **Image** property arrives still bound
to it, so each page that places the component sets its own address. A condition rule whose
pattern could not be matched on your pages is removed on the way in, and the rest of the
condition comes through.

## Saving something as a template

Look for **Save as template**:

- **Screens** list — saves the page's published content
- **Layouts** list — saves the layout, including its content slot
- **Components** list — saves the component definition

A page template captures the **published** version of a screen. If a screen has never
been published there is nothing to capture, and Aglyn will tell you to publish it
first rather than saving an empty template that fails later.

The original is never touched. Saving a template copies it.

## Using a template

**Use** creates something new from the template — the template itself stays in your
library, so you can use it as many times as you like.

- A **page** template asks for a name and an address, then creates the page and
  publishes it. If the address is already taken, Aglyn adds a number rather than
  overwriting the page that's there.
- **Component** and **layout** templates just create the component or layout; there is
  no address to pick. The properties the component or layout declared come with it, so
  every `{{prop.*}}` token in it still has a property to fill it.

If a template defines placeholders, you'll be asked to fill them in first — the values
are substituted into the content as it's created. A template might use `{{who}}` in its
copy and ask you for "Who". A component or layout property's `{{prop.*}}` token is never a
placeholder: it stays in the content, bound to its property.

Nothing you create is linked back to the template afterwards. Editing a page will never
change the template, and updating a template will never change pages you already made.

## Generate a page template with Aglyn AI

An AI build job can make a page template for the pages your site builds from records it
already keeps: each entry of a content collection (a blog post, an event, a case study), each
product, or each author. Everything that changes from one record to the next is bound with the
tokens the Besigner's insert picker offers for that page, such as `{{entry.title}}` in the
heading and `{{entry.coverImage}}` in the cover image, and the blocks that fill themselves on
that page, such as **Entry Meta** and **Entry Body**, are placed where they belong. The job
proposes a plan first and builds once you confirm it, following
[the building rules](../../ai/how-aglyn-ai-builds.md).

Open **Templates** for the site and choose **Describe it**, beside **Create Template**. Write
what each page should show, and under **One page for each** pick what the site draws a page for:
**Collection entry**, then the collection whose entries it shows, **Product** or **Author**. Then
choose **Plan the template**, and open **AI jobs** in the Assist panel to read the plan and
confirm it.

The template lands in your library as **Saved here**, like one you saved yourself. It is bound
to no collection, changes nothing on your site, and counts against your template allowance.
To put it to work, **Use** it to create the page, then pick that page right away as the
collection's **Entry template screen** in Content, the product page template in Store settings,
or the author page screen on the Authors tab. Until you pick it, the new page shows its tokens
at its own address; once picked, it stops serving there and renders each record instead.

## Where a template came from

Every template shows a badge:

- **Saved here** — you created it on this site
- **Marketplace** — installed from a marketplace listing, with its version
- **Starter** — one of Aglyn's first-party starter templates

That badge is set by Aglyn, not by whoever made the template, so a listing cannot
claim to be something it is not.

## First-party starters

Aglyn's starter sites (Landing Page, Business, Portfolio, the two Shop starters) are
ordinary templates in your library — not a separate, locked-down kind. Every site gets
its own copy, so you can open a starter in the besigner, edit it, keep versions of it,
and use it to create pages exactly like a template you saved yourself. They carry the
**Starter** badge, and they don't count against your plan's template allowance.

A multi-page starter arrives as one template per page (the Shop starters are five), and
**Start from a template** still shows them grouped as one card that creates all of the
pages at once.

Your Templates list groups them the same way: one row per starter, labeled with its page
count, and its actions act on **all** of those pages — **Use** creates every page, and
**Delete** removes every page. Open the row to see the pages individually; each one is an
ordinary template you can edit, use or delete on its own from there.

Because your copy is yours, editing a starter is safe: Aglyn will not overwrite it
later. Delete one you don't want and it stays deleted.

## Templates are per-site

A template lives on the site you saved it to. That keeps a template next to the
screens, layouts and components it was built from.

Marketplace **plugins and add-ons** work differently: those install once for the
whole organization and apply to every site, and a site can override the
organization's choice for itself.

## Duplicating

**Duplicate…** in a template's row menu makes a second template with the same
element tree, placeholders, properties and SEO fields, named `Copy of
<template>` unless you type another name. A copy of a marketplace or starter
template is your own — it is listed as *Saved here* and counts against your
template allowance like one you saved yourself. Starter bundles are used, not
duplicated: use the bundle to get its pages.

## Deleting

Deleting a template removes it from your library. Anything you already created from
it is unaffected — a page made from a template is a normal page, with no ongoing link
back to it.

## Related

- [Save & share a template](./save-a-template.md) — publishing a whole site as a
  template for other organizations to install
