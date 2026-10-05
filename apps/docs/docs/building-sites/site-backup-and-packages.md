---
sidebar_position: 12
title: Site backup and packages
description: Download a site as one package, import one into any of your sites, see what is new and what has changed before anything is written, and undo an import.
---

# Site backup and packages

Download everything designable on a site as one file, a **site package**,
and import it into the same site or another of your sites. An import compares
each item in the file with what the site already holds before it writes
anything, and you can undo it afterwards.

:::info Plan availability
**Pro** and above. Site admins only.
:::

Open **Admin → Backup & template** on the site.

## What a package carries

| Item | What travels |
| -- | -- |
| Site settings | Name, SEO defaults, analytics, the not-found and error pages |
| Theme | The theme, your overrides, which theme is picked, and your saved themes |
| Pages and email designs | Each page with its published version and its address |
| Site emails | The emails your site sends its customers, with their published design and subject |
| Layouts and components | With their published design |
| Forms | The form and its design. Never its submissions |
| Collections and authors | Each collection with its entries, and the authors they credit |
| Media | The file details and addresses for both your workspace's and the site's own library. The files themselves stay where they are |
| Datasets | Each dataset the site uses, with its records |
| Redirects, events, bars and popups, experiments | As you set them up |
| Variables, functions, workflows, interactions, booking services | As you set them up |

A package never carries site members, domains, the site's address, inbox
messages, form submissions, bookings, leads, or any secret such as a webhook
signing key.

Each item in the file lists the other items it **depends on**: a page on its
layout, the components it places, the forms it shows, the datasets it repeats,
the variables its text uses and the pages it links to.

## Download a backup

Select **Download backup**. The file holds every item on the site. This is the
whole-site preset of a package.

## Import a package

1. Select **Import from file** and choose a package, or a backup you downloaded
   before packages existed. Both import.
2. The card shows what the import would do, before anything is written:
   - **New.** The site does not hold the item.
   - **Already on this site.** The site holds the same item, unchanged. It is
     left as it is.
   - **Differs.** The site holds the item and it has changed since the file
     was made.
   - **Needs something.** The item points at something neither the file nor
     the site holds, such as a layout you deleted.

   An item is matched to the site's copy by its ID, then by its address, then
   by its name.
3. Choose how to import:
   - **Import new items** adds what the site lacks and leaves every changed
     item as it is.
   - **Replace changed too** also replaces each changed item with the file's
     copy.

If the import would put the site over a plan limit, the card says so and
nothing is written. Only what the import **adds** counts toward a limit, so
replacing items is never refused for being at a limit.

### What happens to each item

| Choice | What it does |
| -- | -- |
| Create | Adds a new item |
| Replace | Writes the file's copy over the site's. A page, layout or site email gets the file's design as a **new version**, so the version it had stays in its history |
| Keep both | Adds the file's copy beside the site's, under a new ID and a new address (`about` becomes `about-copy`). Every item in the file that pointed at it now points at the copy |
| Skip | Leaves the site's item as it is. Items in the file that pointed at it point at the site's copy |
| Merge | For site settings and the theme: fills in what the site has not set, and keeps every value it has |

When an item needs something neither side holds, you can import it from the
file if the file carries it, point the reference at an item the site already
holds, remove the reference, or leave it pointing at nothing until that item
exists.

## Undo an import

Select **Undo import** on the card after an import. Items the import replaced
are put back, and items it added are removed, along with everything it wrote
for them. An item edited since the import is left as it is unless you choose
to revert it too.

An import can be undone for **seven days**.

## Moving a site to another of your sites

A package is portable. Import it into another site of the same workspace or a
different workspace you administer. Media and datasets come back shared with
the site you import into, never with the whole workspace.

Some details only make sense on the site they came from:

- An experiment's variants are versions of its page, and a package carries a
  page's published version only. On another site, choose the variants again.
- A redirect to another website is approved by you as you import it.
