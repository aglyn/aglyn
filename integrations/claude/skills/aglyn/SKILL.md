---
name: aglyn
description: Work in the user's Aglyn workspace with the Aglyn connector's tools. Use whenever the user asks about or wants to change their Aglyn sites, their pages (adding, renaming, moving, deleting or publishing them, and reading or editing what is on a page as a draft), page templates, search listings (SEO titles and descriptions) or business details, datasets and records, contacts, companies, deals, tasks, leads, form submissions, orders, products, prices and stock, bookings or media, or mentions Aglyn by name.
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
| Read or change workspace data: sites, pages and what is on them, page templates, search listings, business details, datasets, contacts, CRM, products, orders, form submissions, media | The connector's tools (this skill) |
| Change a site's theme, layouts, reusable components or templates, redesign a site, edit what the page tools refuse, or change a setting no tool covers | The console in a browser (`aglyn-console` skill) |
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
  `publishSite` with `pages` (1 to 25 page ids) also makes those pages' drafts
  live, and publishes a page that has no address yet at its own address. Every
  page is checked first; if one is refused, nothing is published and the
  error says why. `publish_from_editor` means the saved page has layout style
  overrides that its draft lacks (someone cleared them in the editor, or the
  draft was saved by the tools before they kept them; a draft from
  `editPageContent` now carries them): send the person to the editor to
  publish that page. Layouts, components,
  email designs and templates are never published by it.
- **Pages:** `listPages` and `getPage` give each page's and folder's name,
  public address, whether it is published, and its search listing.
  `createPage` adds a page, blank or from a template (`templateId` and its
  `placeholders`), unpublished: it has no address until it is published.
  `updatePage` renames a page, changes its description or address (`slug`), or
  moves or reorders it (`parentId`, `index`). `deletePage` deletes a page, not
  a folder.
- **What is on a page:** `getPageContent` returns every element with its id,
  kind, parent and children, the `props` and `style` an edit can set, a
  `readOnly` part it cannot, and `kinds`, which says for each kind which
  setting holds its text (`role: text`), picture (`media`), link (`url`) or
  link to another page (`screen`), with allowed `values` and `maxLength`.
  `editPageContent` sends 1 to 20 edits, all or none: `updateProps`,
  `updateStyle`, `rename`, `insert` (up to 40 elements), `move`, `remove`.
  Nothing is shortened or converted for you: a value that does not fit is
  refused with `fields` naming the edit and member, so fix it and send again.
  Pictures are `media:{siteId}/{mediaId}` (the site's media),
  `media:org:{orgId}/{mediaId}` (the workspace's library), or `https://`
  addresses; a page link names a page of the site by its id. Pass the read's
  `revision` as `ifRevision` so edits are refused if the page changed since.
  Rich text, class names and icons cannot be set.
- **Templates:** `listTemplates` lists the page templates a new page can
  start from, with the placeholders each asks for. Templates themselves are
  not edited by any tool.
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
- **Page content edits are drafts; some other changes are live at once.**
  `editPageContent` saves to the page's draft, and a new page has no address,
  so visitors see neither until the page is published. Give the person the
  `editorUrl` from the edit so they can review the draft, and publish only
  when they say so. Product, search listing and business details changes,
  and `updatePage` or `deletePage` on a page that is already published, are
  live when saved: there is no draft and no publish step. Show the person the
  change and get their yes before you make it.
- **On a site, you can do only what the person can.** `site_permission_required`
  means they lack the permission the change needs on that site (editing its
  content, or publishing it, which changing a page's address or place,
  deleting a page and publishing pages need); the message names it. `No such
  site` can mean they are not a member of it; a `423` means the site is
  locked. An `insufficient_scope` naming `sites:publish` on a page change means
  the page is published and the connection may not change what visitors see.
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
- *"Change the headline on my About page"*: `listPages` → `getPageContent` →
  find the element whose kind's `text` setting holds the headline → propose
  the new words → `editPageContent` with `updateProps` and `ifRevision` →
  share the `editorUrl` → ask before `publishSite` with that page in `pages`.
- *"Add a Catering page from the services template"*: `listTemplates` → ask
  for the placeholders' text → `createPage` → edit it if asked → share the
  draft → ask before `publishSite` with the new page in `pages`.
