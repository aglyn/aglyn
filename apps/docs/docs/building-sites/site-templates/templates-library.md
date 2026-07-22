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
  no address to pick.

If a template defines placeholders, you'll be asked to fill them in first — the values
are substituted into the content as it's created. A template might use `{{who}}` in its
copy and ask you for "Who".

Nothing you create is linked back to the template afterwards. Editing a page will never
change the template, and updating a template will never change pages you already made.

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

Your Templates list groups them the same way: one row per starter, labelled with its page
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

## Deleting

Deleting a template removes it from your library. Anything you already created from
it is unaffected — a page made from a template is a normal page, with no ongoing link
back to it.

## Related

- [Save & share a template](./save-a-template.md) — publishing a whole site as a
  template for other organizations to install
