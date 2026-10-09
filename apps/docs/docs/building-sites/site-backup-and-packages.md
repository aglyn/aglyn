---
sidebar_position: 12
title: Site backup and packages
description: Download a site or the items you pick as one package, import one into any of your sites, compare each item with the site's copy and choose how to handle it before anything is written, and undo an import.
---

# Site backup and packages

Download everything designable on a site as one file, a **site package**, or
only the items you pick, and import it into the same site or another of your
sites. An import compares each item in the file with what the site already
holds, shows you what changes and asks how to handle each item before it
writes anything, and you can undo it afterwards.

:::info Plan availability
**Pro** and above. Site admins only.
:::

Open **Admin → Backup & template** on the site.

## The Backup & restore card {#backup-and-restore-card}

The **Backup & restore** card is where you take a copy of a site and bring one back:
**Download backup** saves the whole site as one package, **Export items** saves only the
items you pick, **Import package** loads a package into this site, and **Undo import**
reverses the last import. Download a backup before any large change.

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

## Export items

Select **Export items** to choose what the file carries.

1. Tick the items you want. Each kind (pages, layouts, forms and so on) has
   its own list, and ticking a kind's name selects all of it. Search narrows
   the lists.
2. Leave **Include what they need** on to add every item your selection
   depends on: a page's layout, the components it places, the forms it shows.
   Those items are marked **needed by your selection**, and the dialog counts
   how many the file will hold before anything downloads.
3. Select **Export**. **Export everything** gives the whole-site backup
   instead.

## Import a package

Select **Import package**. The import wizard walks the file through six steps,
and nothing is written until the last one.

### 1. Upload

Choose a package, or a backup you downloaded before packages existed. Both
import.

### 2. Items

Every item in the file, grouped by kind, with its status:

- **New.** The site does not hold the item.
- **Differs.** The site holds the item and it has changed since the file was
  made.
- **Already on this site.** The site holds the same item, unchanged.
- **Needs something.** The item points at something neither the file nor the
  site holds, such as a layout you deleted. The row names what it needs.

An item is matched to the site's copy by its ID, then by its address, then by
its name. The **On this site** column shows which item it matched and how.

Choose what happens to each item. Set a **default** for new items, changed
items and items already on the site, then change any single item in its row;
an item's own choice always wins over the default. You cannot go on until
every changed item has a choice. Filter the list by status or kind, or search
it by name, address or ID.

| Choice | What it does |
| -- | -- |
| Add | Adds a new item |
| Replace | Writes the file's copy over the site's. A page, layout or site email gets the file's design as a **new version**, so the version it had stays in its history |
| Keep both | Adds the file's copy beside the site's, under a new ID and a new address (`about` becomes `about-copy`). Every item in the file that pointed at it now points at the copy |
| Skip | Leaves the site's item as it is. Items in the file that pointed at it point at the site's copy |
| Merge | For site settings and the theme: keeps the site's values and fills in what it has not set. You can choose key by key on the Changes step |

### 3. Missing items

When an item you are importing points at something the site will not hold,
the wizard asks what to do about each one:

- **Import it from the file.** Offered when the file carries the item but you
  set it to skip. This is the default for those items.
- **Use an item this site has.** Pick the site's item, such as another layout,
  and every reference points at it.
- **Remove the reference.** The items that named it no longer do. The review
  warns you about each one.
- **Leave it pointing at nothing.** It stays as it is until an item with that
  ID exists on the site.

### 4. Changes

Each item the site already holds that the import changes, or that differs, is
listed. Select one to compare it with the site's copy:

- Pages, email designs, layouts and components are **rendered side by
  side**: the site's copy on the left and the file's on the right. Both are
  drawn without the layout around a page, so what differs is the item itself.
- **Forms** are rendered side by side the way the form's own page previews
  them: each field a submission arrives under, which ones are required, and
  which one is the marketing opt-in. A renamed or removed field is the
  difference between the two.
- **Site emails** are rendered side by side the way an inbox receives them,
  each under its subject line, with your site's shared blocks drawn in. Merge
  tags such as `{{contact.firstName}}` are left as they are. A copy with no
  design of its own says the site sends its built-in email.
- **Datasets** and **collections** list their records as a table: each record
  the file adds (**New**), each one the site holds that the file does not
  (**Not in the file**), and each one that differs (**Changed**), one column
  per field. In a changed record, each value that differs is highlighted, with
  the site's value struck through beneath it. Records that match are counted
  above the table, not listed, and a long list is split into pages.
- Below either, every other value that differs is listed with **On this
  site** and **In the file** beside each other.
- For a **merged** item, each key that differs is listed with both values.
  Choose whether it keeps **this site's** value or takes **the file's**. A key
  the site has not set takes the file's value unless you say otherwise.

You can change the item's choice here too.

### 5. Review

The wizard plans the import again with every choice you made and lists what it
will do. If the import would put the site over a plan limit, it says so and
you cannot import. Only what the import **adds** counts toward a limit, so
replacing items is never refused for being at a limit.

Each kind of warning needs its own **I understand** before **Import** is
available:

- Items that will be written over. What they held is kept so the import can
  be undone.
- References removed, pointed at one of the site's items, or left pointing at
  nothing.

The review also lists items the site cannot read, because the plugin that
keeps them is off, and site emails the platform does not send. Those are left
out.

### 6. Import

Select **Import**. The last step shows how many items each choice touched and
how many documents were written.

## Undo an import

Select **Undo this import** on the wizard's last step, or **Undo import** on
the card after you close the wizard. The wizard first says what undo will do:
how many items it puts back and how many it removes.

An item edited since the import is listed on its own. Each one is left as you
edited it unless you choose **Undo it too**. Then select **Undo import**.
Items the import replaced are put back, and items it added are removed, along
with everything it wrote for them.

An import can be undone for **seven days**.

## Moving a site to another of your sites

A package is portable. Import it into another site of the same workspace or a
different workspace you administer. Media and datasets come back shared with
the site you import into, never with the whole workspace.

Some details only make sense on the site they came from:

- An experiment's variants are versions of its page, and a package carries a
  page's published version only. On another site, choose the variants again.
- A redirect to another website is approved by you as you import it.
