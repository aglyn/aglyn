---
name: aglyn
description: Work in the user's Aglyn workspace with the Aglyn connector's tools. Use whenever the user asks about or wants to change their Aglyn sites, their pages list, search listings (SEO titles and descriptions) or business details, pages' content data, datasets and records, contacts, companies, deals, tasks, leads, form submissions, orders, products, prices and stock, bookings or media, or mentions Aglyn by name.
---

# Working in an Aglyn workspace

Aglyn is a website and business platform: sites, content, a CRM, commerce,
bookings and forms in one workspace. The `aglyn` connector gives you that
workspace as tools. The person approved a workspace and an access level
("View only" or "View and make changes") when they connected, so a refused
write usually means they chose View only.

## Pick the right way in

| The job | Use |
| --- | --- |
| Read or change workspace data: sites, pages list, search listings, business details, datasets, contacts, CRM, products, orders, form submissions, media | The connector's tools (this skill) |
| Design or edit a page's content, change a site's look, or change a setting no tool covers | The console in a browser (`aglyn-console` skill) |
| Read what a published Aglyn site says, including one the user does not own | The public site itself (`aglyn-read-site` skill) |

If no tool covers what was asked, say so and offer the console route. Never
describe a tool or a field that is not in the tool list.

## Start every task the same way

1. Call `getKeyIdentity` once. It tells you which workspace you are in and
   what you are allowed to do.
2. Call `listSites` when the task is about a site. Most writes name the site
   they belong to, and people refer to sites by name or domain, not by id.
3. Read before you write. Fetch the record you are about to change and tell
   the person what will change.

## What the tools cover

- **Sites:** list, read, create, publish. Publishing makes changes live for
  visitors, so confirm first. There is no tool to rename or delete a site.
- **Pages:** `listPages` and `getPage` give each page's name, public address,
  whether it is published, and its search listing. Never the page's content;
  no tool edits what is on a page.
- **Search listing:** `getSiteSeo` and `updateSiteSeo` for the site's search
  title, description, title separator and title pattern; `updatePageSeo` for
  one page's search title, description and breadcrumb label. The site's title,
  description and separator cannot be emptied. The search-indexing switch,
  verification codes and the social image are console settings.
- **Business details:** `getBusinessDetails` and `updateBusinessDetails` for the
  business name, slogan, phone, email, address and social links. Social links
  are replaced as a whole list, so send every link to keep.
- **Datasets and records:** the structured content behind listings, service
  pages, menus, directories. Full create, read, update, delete. A page that
  shows a dataset picks up record changes after the site is published.
- **Contacts and the CRM:** contacts, companies, pipelines (read), deals,
  tasks, activities, leads (including converting a lead), email templates.
  An email address is a contact's identity: look it up with `listContacts`
  and its `email` filter before creating, and use `mergeContact` for
  duplicates.
- **Form submissions:** list, read, mark read, delete.
- **Products:** list, read, `createProduct`, `updateProduct`,
  `deleteProduct`, and `updateProductVariant` for one variant's price,
  compare-at price, SKU, barcode, weight and stock. A new product is a draft,
  not in the store, unless `status` is `active`. Price and stock live on
  variants, and variants are always every combination of the product's
  options: change `options` to add or remove variants; a single variant cannot
  be added or removed on its own. Stock `null` means not tracked, `0` means sold
  out. Digital products, gift cards and subscription terms are made in the
  console.
- **Orders:** read; `updateOrder` records fulfilment (shipped or delivered,
  with carrier and tracking). It never cancels or refunds. Send the person to
  the console for those.
- **Bookings:** read only.
- **Media:** list and upload. No replace or delete.
- **Usage:** `getUsage` shows how much of the plan's allowance is used.

## Rules that keep you out of trouble

- **Lists page on a cursor.** Keep calling with the previous `next_cursor`
  until `has_more` is false. A short or empty page is not the end.
- **Only one filter narrows a list.** Extra filters are applied after the
  read, so pages can come back short. Unknown filters are ignored, so check
  the tool's parameters instead of guessing a filter name.
- **Request bodies go under `body`.** Path and query values sit beside it.
- **A refusal is information.** The error names its cause: `insufficient_scope`
  (connected as View only), `plan_required` with a reason (the plan does not
  include that part of Aglyn), a quota that is full, or `rate_limited` with a
  time to wait. Tell the person plainly what it means and what they can do.
  Do not retry a refusal in a loop.
- **Product, search listing and business details changes are live when
  saved.** There is no draft and no publish step: the store, search results
  and the site's pages change at once. Show the person the change and get
  their yes before you make it.
- **On a site, you can do only what the person can.** `site_permission_required`
  means they lack permission to edit that site's content; `No such site` can
  mean they are not a member of it; a `423` means the site is locked.
- **Deletes are permanent.** Confirm each one, naming the record.
- **Bulk work:** say how many records you are about to touch before you
  start, and stop to check in if results are not what you expected.
- **Money, cancellations and refunds are the person's to do** in the console.
- Records hold customers' personal details. Share only what the task needs.

## Typical jobs

- *"Add these services to my site"*: `listSites` → `listDatasets` → read the
  dataset's fields → `createDatasetRecord` for each → ask before
  `publishSite`.
- *"Who filled in the contact form this week?"*: `listFormSubmissions`,
  summarize, offer to mark them read or add them as contacts.
- *"Log my call with Dana and remind me Friday"*: find the contact →
  `createActivity` → `createTask` with the due date.
- *"Mark order 1042 shipped"*: `getOrder` → confirm carrier and tracking →
  `updateOrder`.
- *"Put the large sourdough at $12 and set stock to 20"*: `listProducts` →
  `getProduct` → find the variant → confirm the change →
  `updateProductVariant`.
- *"Fix the homepage's Google title"*: `listPages` → `getPage` → propose the
  new title (60 characters or fewer) → confirm → `updatePageSeo`.
