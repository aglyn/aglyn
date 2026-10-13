# Aglyn AI capability map

Zach, 2026-10-10: "Aglyn AI can also use/create datasets too for whatever it
needs. Aglyn AI should basically be able to use any part of Aglyn another user
could by following the documentation." This extends AGL-3616 (the Assist chat
builds anything): the AI is a user of the product, not only a page writer.

This document measures that. For every area `apps/docs` teaches a person, it
says what Aglyn AI can do there today, through which door, behind which gate,
and what is missing. The gaps are ranked at the end. Update it in the same PR
that closes a gap or adds an AI door.

Paths are relative to `libs/plugins/ai/src/lib` unless they start with `libs/`
or `apps/`.

## How Aglyn AI acts

There are four doors. Everything the AI makes goes through one of them, and
every one writes drafts or proposals through the owning plugin's rules. The AI
never writes another plugin's documents itself.

1. **The site job** (`jobs/ai-job-site-step.ts`, `aiSiteJobUnits`) builds a
   whole site from a confirmed plan, one unit per pass, in this order: the look
   (theme), the layout, the form, the datasets (this PR), a blog's first three
   posts or a store's first three to six products (paid plans only), the pages,
   a paid store's own account, cart and policy pages (written by code, outside
   the plan's page count, `jobs/ai-job-site-store-pages.ts`), then the welcome
   email. It writes the site's search title and description at
   no cost (`aiSiteSeoOutputs`). A guided start (`inputs.autoConfirm`) then
   adds navigation and publishes (`jobs/ai-site-publish.ts`).
2. **The build job** (`jobs/ai-job-build-step.ts`) builds what one request
   asks for: creations, pages and ITEMS. An item is an operation a plugin
   registered on `libs/aglyn/src/lib/plugin-manager/plugin-ai-capabilities.ts`.
   Assist chat's `propose_build` starts one, and it shows as one plan card.
3. **Assist chat** (`server/assist-chat.ts`) answers from the docs, proposes
   opening a console page (`extractAssistAction`), proposes a canvas edit
   (`propose_canvas_edit`), or proposes a build (`propose_build`).
4. **Console entry points** (`plugin.ts`) put "describe it" and "write it"
   buttons on a page, each running a single-kind job or request.

### Build operations

An operation is offered only when all of these hold (`aiBuildOps` in
`jobs/ai-build-capabilities.ts`): the owning plugin is on for the workspace
and the site, its release flag is on (`filterEnabledPluginsByReleaseFlags`),
`checkEntitlement` passes for its `feature`, the Free plan allows it where the
workspace is on Free, and its runner is loaded. The owner's draft writer then
checks the member's role and the allowance when the item runs.

| op | owner | made by | feature | quota | Free |
| -- | -- | -- | -- | -- | -- |
| `page` (8 per plan) | ai | page runner | | `screensPerHost` | yes |
| `layout` (1) | ai | layout runner | | | yes |
| `form` (3) | ai | form runner | | `formsPerHost` | yes |
| `component` (4) | ai | component runner | | | no |
| `email` (2) | ai | email runner, email plugin writer | | | no |
| `template` (2; entry, product or author page) | ai | template runner | | | no |
| `campaign` (2) | ai | campaign runner, marketing writer | | | no |
| `workflow` (2) | ai | workflow runner, workflows writer | | | no |
| `function` (2) | ai | logic runner, logic `function` writer | | `functionsPerHost` | yes |
| `edit` (3) | ai | edit runner (a version, unpublished) | | | no |
| `navigation` (1), AGL-3728 | ai | navigation runner, no model (a layout version, unpublished) | `versioning` | | no |
| `duplicate` (3), AGL-3740 | ai | duplicate runner, no model, core's `duplicateResource` (an unpublished copy) | the kind's own, checked by the copy | the kind's create counter | yes |
| `product` (12) | commerce | `product` writer (`libs/plugins/commerce/src/lib/server/product-ai-capability.ts`) | `commerce` | `productsPerHost` | no |
| `store-shipping` (10), `store-pickup` (5), `store-delivery` (5), `store-tax` (6), AGL-3749 | commerce | `store-settings` writer, no model, live (`libs/plugins/commerce/src/lib/server/store-setup-ai-capability.ts`) | `commerce` | | no |
| `booking-service` (5) | bookings | `booking-service` writer | `bookings` | `servicesPerHost` | no |
| `variable` | logic | `variable` writer | | `variablesPerHost` | yes |
| `overlay` | marketing | overlay writer | `marketingOverlays` | | no |
| `experiment` | marketing | experiment writer | `abTesting` | | no |
| `funnel` | funnels | funnel writer | `screenAnalytics` (`FUNNEL_FEATURE`) | | no |
| `redirect` (10), AGL-3745 | redirects | `redirect` writer (`libs/plugins/redirects/src/lib/server/redirect-ai-writer.ts`); creates, updates or removes a rule, live once written | `redirects` | `redirectsPerHost` (creates only) | no |
| `dataset` (3), **new in this PR** | data | `dataset` writer (`libs/plugins/data/src/lib/server/dataset-drafts.ts`) | `dataStore` | `datasetsPerOrg` | no |
| `event` (6), AGL-3743 | events-calendar | `event` writer, no model (`libs/plugins/events-calendar/src/lib/server/event-drafts.server.ts`); a page section that uses it places `eventList` | `eventCalendar` (the add-on) | | yes |

Checked against the code on 2026-10-10. `FUNNEL_FEATURE` is
`'screenAnalytics'` (`libs/plugins/funnels/src/lib/model/funnels.types.ts`),
which only Pro and Business include, so a funnel is a Pro-and-up build item.

### Model tools

The tools in `tools/` that a job or a console request calls:

- theme: `propose_theme_changes`
- SEO: `propose_search_listing`, `propose_seo_fixes`, `propose_site_listing`
- products: `propose_catalog`, `propose_categories_and_discounts`, `propose_product_copy`
- CRM: `propose_record_insight`, `propose_email_draft`, `propose_column_matches`
- insights: `read_figures`, `submit_insights`
- experiments: `propose_variants`, `explain_result`
- blog: `write_blog_post`
- logic: `submit_function`, `submit_variable`
- automations: `submit_automation`, `submit_explanation`
- overlays: `write_overlay_copy`
- inventory: `look_up_site_inventory`
- datasets: `submit_dataset`, **new in this PR** (`tools/ai-dataset-tool.ts`)
- duplicate: `duplicate_resource` (`tools/ai-duplicate-resource-tool.ts`).
  No model is offered the tool itself; its input reader
  (`parseAiDuplicateResourceInput`) is what the `duplicate` build op
  (AGL-3740) reads an item with, and both make the copy through core's
  `duplicateResource`. See "Duplicating" below.

### Console entry points

Every one sits behind `featureFlag: 'aiGenerative'` and `permission:
'ai.generate'`. Most also need `release_ai_generative`, and most show the
add-on upsell when the workspace is not entitled (`showWhenNotEntitled`).
Where the entry names no release flag, its card asks the jobs route.

- Describe a page, template, layout, form, component, email, automation, org
  automation, funnel or logic; explain a funnel, an automation or a failed run;
  revise an automation; fix a logic reference.
- Besigner: generate a section, rewrite copy, save as a component.
- Theme proposal, SEO fields, SEO audit, site SEO start, site start (first
  run), site memory (business profile), agency site batch.
- Media library: **Create with AI** (`ai-media-create`, `server/ai-media-image.ts`,
  `POST /api/ai/media/images`). A direct, credit-reserved request rather than a
  job. `photo` uses Vertex image models where the deployment configures them
  (404 otherwise); `illustration` draws an SVG icon, logo, pattern or
  illustration in the theme's colors. Both store the picture in the asking
  site's media library.
- Commerce: product copy, products hub, create products, product import.
- Marketing: create an overlay, overlay copy, create a campaign, marketing
  insight, experiment variants and result.
- CRM: record insight, email draft, import column matching.
- Dashboards: ask an insight (site and org).

### Plans and flags

From `libs/aglyn/src/lib/app-utils/plan-entitlements.ts`:

- **Generative AI.** `aiGenerative` is on for Free (a 300-credit monthly
  taste) and Enterprise. Starter, Pro and Business get it from the Aglyn AI
  add-on, which also turns on `aiAssist`. Starter and up include `aiAssist`
  for docs answers without the add-on.
- **Starter and up:** workflows, `dataStore`, bookings, CRM, redirects,
  marketing overlays, commerce, reusable components, custom domain.
- **Pro and up:** versioning, actions, funnels (`screenAnalytics`), POS,
  product reviews, abandoned cart.
- **Business only:** A/B testing, webhooks, API access, multilingual, content
  gating, scheduled publishing.
- **Add-on only on every self-serve plan:** the events calendar
  (`eventCalendar`).

| per site or org | Free | Starter | Pro | Business |
| -- | -- | -- | -- | -- |
| datasets per org | 0 | 2 | 5 | 10 |
| records per dataset | 0 | 1,000 | 10,000 | 100,000 |
| forms per site | 1 | 5 | 25 | 100 |
| components per site | 1 | unlimited | unlimited | unlimited |
| functions per site | 1 | 10 | 50 | 250 |
| products per site | 0 | 100 | 2,500 | 10,000 |
| booking services per site | 0 | 1 | unlimited | unlimited |
| redirects per site | 0 | 25 | 100 | unlimited |
| workflows per site | 0 | 3 | 25 | 100 |

Datasets also need the `release_data_store` flag for the organization. The
console's datasets route and the new writer both refuse without it.

## The docs, area by area

What `apps/docs/docs` teaches a person, and what the AI can do there. "Yes" is
a door that makes the thing. "Partial" means it makes some of it. "No" means a
gap.

| area (docs) | a person can | Aglyn AI today |
| -- | -- | -- |
| Getting started, Assist | create a site, publish, ask Assist | yes: site job, guided start publishes, Assist answers from the docs |
| Pages, layouts, versions | pages, nested layouts, versions, scheduled publish | partial: makes pages and layouts, edits as an unpublished version; never schedules a publish |
| Besigner elements | animations, lightbox and galleries, music player, video, markdown, interactions, repeat over a dataset | partial: pages place what the layout language compiles; repeat over a dataset (this PR); no animations, interactions, lightbox or video placement op |
| Reusable components | components with properties | yes (build `component`; a site start draws repeats inline) |
| Theme builder | colors, fonts, light and dark | yes: the site look; theme proposals |
| Menus and navigation | dropdown, mega menu, drawer | yes (AGL-3728): a build's `navigation` op adds, removes, renames, relinks and reorders header and footer items and puts items under a dropdown; a guided start adds its header links at publish through the same code (AGL-3747); no mega menu panels or new drawers |
| Bindings and logic | variables, functions | yes (`variable`, `function`) |
| Templates and blog | page templates, blog collections, entries | partial: entry, product and author templates; a blog start's first 3 posts; no collection create, authors or scheduled posts outside a site start |
| Site backup and packages | export, import, merge | no, by design: a person's decision |
| Custom domains | connect and verify a domain | no, by design (out of scope) |
| Redirects | rules, loop checks, hit counts | yes (AGL-3745): a build's `redirect` op creates, updates and removes rules; no hit counts or import |
| SEO | per-page listing, sitemap, structured data, audit | yes: listings, audit fixes, the site listing |
| Site protection | password a page, error pages, maintenance mode | no |
| Multilingual | locale variants, hreflang, Weglot | no |
| Site search | search box, search page | no |
| Live chat | Tidio, LiveChat | no |
| **Datasets** | typed fields, references, records, import and export, a page per record | **yes in this PR**: creates a dataset with typed fields and seeded records, lists it on pages, drafts its record page, and each listed card links its record's page (AGL-3727); no references, import or record edits after the build |
| Forms | forms, submissions inbox, write submissions into a dataset | yes: makes forms, and binds one to a dataset where the plan says it writes to one (`writesTo`, AGL-3616) |
| Events calendar | events, publish to pages, event schema | yes (AGL-3743): a build's `event` op drafts dated events (title, start and end in the business's time zone, location, organizer, description), and a page section that uses them places the Event List; the owner publishes each event. No cover photo from a build yet |
| Media library | folders, transforms, CDN, tags | partial: Create with AI and stock photos into the library; no folders, tags or metadata |
| CRM | contacts, companies, deals and pipelines, leads, tasks, custom fields, views | partial: record insight, email draft, import matching; no records, pipelines, custom fields or views |
| Commerce | catalog, orders, shipping, tax, POS, channels | partial: products (drafts, listed at a starting price on a site start), categories and discounts proposals; shipping zones and rates, local pickup, local delivery and sales tax setup (AGL-3749); no carrier rates, tax services, payments, POS or order emails |
| Bookings | services, availability, payment, reminders | partial: a booking service draft |
| Marketing overlays | bars and popups | yes (`overlay`) |
| Email campaigns | campaigns, designed emails | yes, drafted and unsent (`campaign`, `email`) |
| Analytics, funnels, A/B tests | insights, funnels, experiments, GA4, conversions | partial: insights, `funnel`, `experiment`; no GA4 or conversions setup |
| Workflows | workflows, actions, webhooks, Zapier | partial: `workflow` (can name a `webhookPost` step); no webhook or Zapier setup |
| Teams and roles, billing | members, roles, plans, add-ons | no, by design |

## Gaps, ranked

Ranked by how often a brief needs it and how much of the docs it unlocks.

1. **Datasets. CLOSED BY THIS PR.** A `dataset` unit in the site job and a
   `dataset` build operation, both written by the data plugin's `dataset`
   draft writer: typed fields, records seeded from the brief, a list section
   that repeats over the dataset, a drafted record page (Starter and up), and
   static copy where datasets are not allowed. See below. Its listed cards
   link their record pages (AGL-3727).
2. **Navigation and menus.** Navigation is written only at publish, as flat
   header links. **CLOSED (AGL-3728):** a build's `navigation` op changes the
   header and footer menus, dropdowns included. See "Navigation and menus"
   below.
3. **Blog collections and posts.** Collections can't be created outside a
   site start, and there are no authors or scheduled posts.
4. **Forms that write to a dataset. CLOSED (Zach, 2026-10-10).** A form's
   creation says the dataset it writes to (`writesTo`); see "Forms that write
   to a dataset" below.
5. **Events calendar.** **CLOSED (AGL-3743):** a build's `event` op drafts
   dated events through the events-calendar plugin's own writer, and the page
   section that lists them places the Event List block. See "Events calendar"
   below.
6. **Redirects.** No capability. Starter includes 25. **CLOSED (AGL-3745):** a
   build's `redirect` op creates, updates and removes a site's redirect rules.
   See "Redirects" below.
7. **CRM records.** No pipelines, deals, custom fields or saved views.
8. **Store setup.** No shipping, tax, pickup and delivery, payments, POS or
   order emails. **CLOSED for shipping, pickup, delivery and tax
   (AGL-3749):** four build ops set what the console's Shipping, Local
   delivery, Taxes and Inventory locations cards set. Payments, POS, carrier
   rates, tax services and order emails stay open. See "Store setup" below.
9. **Site settings.** No maintenance mode, password or error pages, site
   search or multilingual.
10. **Integrations.** No webhooks, Zapier or GA4/conversions setup.
11. **Media library.** No tags, folders or metadata, and no video, music or
    lightbox placement ops.
12. **Duplicating.** `duplicate_resource` exists and nothing calls it.
    **CLOSED (AGL-3740):** a build's `duplicate` op copies a page, component,
    layout, template, form, email design or workflow the site has, so "make
    another page like Services" copies instead of regenerating. See
    "Duplicating" below.

### Out of scope by design

Sequences (internal and self-host only, never sold: Zach, 2026-09-29),
members and roles, billing and plans, custom domains, and site packages. Each
is a decision about the account, not something to build.

## Datasets (this PR)

- **The data plugin owns it.** `libs/plugins/data/src/lib/server/dataset-drafts.ts`
  registers the `dataset` draft writer on the resource-drafts seam, and
  `dataset-ai-capability.ts` registers the `dataset` build operation. The
  writer checks everything the console's datasets route checks: the member's
  role and `data.manage`, `release_data_store`, `dataStore`, the
  `datasetsPerOrg` count (inside the creating transaction),
  `recordsPerDataset`, and dataset storage. It writes a model with typed
  fields, the seeded records, and a page address field where a record page
  needs one. It applies the org's Default sharing for the site.
- **The site job.** On a workspace that may create datasets (paid,
  `dataStore`, data plugin on and released, writer registered), the plan is
  told to create one for structured content (menus, team, services, portfolio
  pieces, events, FAQs) and to name it in the section that lists it. Each
  dataset is a unit after the form: the `submit_dataset` generation
  (`runtime/ai-dataset-generation.ts`, routed on the `job.products` row until
  a live eval records a row of its own) designs its typed fields and seeds 3
  to 12 records from the brief.
  It never writes reviews, testimonials, ratings, quotes or people's names the
  brief does not give, or a price it does not state. The section that names
  the dataset lists its records through a repeat over the dataset, which the
  layout compiler draws. A page planned as its record template is drafted
  with `{{item.<field>}}` and stays a draft, for the member to save the
  binding in Page Properties → Record pages (a binding is a route, rule 13).
- **Fallback.** Where datasets are not allowed (Free; Starter's two used up;
  the flag off), the plan creates none and the sections write the items out.
  Where a dataset unit fails or is refused, the pages that listed it are built
  without it and say so, and its record page is skipped.
- **Estimates.** A dataset is one pass, counted in the plan's estimate and
  range like a form. A build's `dataset` item is planner-filled and costs 0.
- **Photos.** A list a visitor looks at before reading keeps its records'
  photos (2026-10-10: beta.239's ceramics portfolio listed "Selected work"
  as text-only cards). Read off the plan (`aiSiteDatasetPicturesOf`): pieces,
  work, menus, classes, events, rooms always; a team as people; services or
  offerings only where a section that lists them says pictures (a gallery,
  photos, tiles) or names one of those; questions, testimonials, roles and
  form datasets never. Such a dataset gets the data plugin's Image field
  (`image`, text storage, a photo address only), and each record a stock
  photo of its own name in the site's craft, through the page pictures'
  search and ranking, copied into the site's library as its CDN path, inside
  20 seconds, never one the job already placed, else a starter. No model call,
  so no credits; estimates unchanged. The listing's card leads with
  `{{item.<image>}}` (a lightbox on a portfolio or photography site), the
  pages after it never place those photos again (`stockPhotoAvoid`), and a
  record template's first Image shows the record's photo.
- **Cards link their record's page (AGL-3727).** Where the plan makes a page
  the record template of a dataset that a section lists, the listing carries
  the template's base (`recordBase`, read off the plan by
  `aiLayoutRecordBaseOf`) and the dataset's page-address field
  (`addressField`: the writer's, on a site start; the inventory's
  `pageAddress` field, on a build). The layout compiler then puts a
  "View details" link on every card, and links the card's photo where it does
  not open in a lightbox, to `/{base}/{{item.<address>}}`
  (`aiLayoutRecordHref`), which the page fills per record as it repeats the
  card. It is code, never the model's: the page's prompt is unchanged, and
  the link token is admitted only on a page that lists the dataset. The link
  answers once the member saves the binding (rule 13), as the record page's
  row says.
- **Record pages saved earlier (AGL-3747).** The data plugin's `dataset`
  index, narrowed to a site, says where the site already serves a dataset's
  records pages of their own (`facts.recordPage`: the saved binding's base
  and address field). The inventory carries them as the dataset's
  `recordBase` and `addressField` (never in the prompt's line), and a
  listing whose plan makes no record template takes them, so its cards link
  the pages the site already has. A build lists the site's own datasets its
  plan reuses where a section places them, as it lists the ones it made: the
  page's section line then says the platform lists the records.

## Navigation and menus (AGL-3728)

- **The menus are the Besigner's own elements.** There is no separate menu
  document: a site's header menu is the Page Links (`muiScreenLink`) in its
  layout's App Bar, once in the bar's row and again in the phone menu's
  Drawer, with Dropdown Menus (`muiNavMenu`, `muiMegaMenu`) holding more; its
  footer menu is the longest list of Page Links in the element that renders
  `footer`. `model/ai-layout-menus.ts` reads them the way a store's links
  are added (`aiLayoutWithStoreLinks`): lists that render `nav` where there
  are any, so the brand and an account link beside it are never items.
- **The op.** `navigation` (`jobs/ai-build-capabilities.ts`, at most one a
  plan) takes `menu` (header, footer or both), an optional `layout`, and
  lists of words: `add` and `relink` as `Label => destination` (or
  `Parent > Label => destination` for a dropdown), `remove`, `rename` as
  `Old => New`, and `order`. A destination is an inventory page id, a page
  the plan makes (`new:<title>`), a path on the site or an https address;
  anything else is left out with a sentence. The planner sees these
  arguments in the op catalog, so the plan prompt changed with it.
- **Applied by code** (`jobs/ai-job-navigation-step.ts`), never by a model:
  every list of the menu takes the same change, so the bar and the phone
  menu agree. A new link copies its neighbours' look (in the phone menu, the
  interaction that closes it). A link under a parent goes into that Dropdown
  Menu in the bar, made where there is none, and flat after its parent in the
  phone menu and the footer.
- **Where it lands.** A new version beside the layout's live one, named by
  the job's id, as the `edit` op's change to a layout does: visitors see
  nothing until a person publishes it. Without version history there is
  nowhere to land: the op is offered only where the plan includes `versioning`
  (Pro and up), and the door refuses it as a plan limit otherwise.
- **Gates.** The editor's own rule for a layout's versions: a member with the
  admin, editor or author role on the site, while no lockdown freezes the
  site, its org or the platform. Asked at the door, again before the write,
  and the role again inside the write's transaction. The job's `ai.generate`
  gate and the AI plugin's site switch apply as to every job.
- **Order.** A build builds it after the pages its arguments link
  (`aiBuildItemArgRefs`), whatever the plan's `dependsOn` says, and hands it
  the pages it made (`buildMade`). A page that failed is not linked.
- **Cost and audit.** No model, so 0 credits in the estimate and none spent.
  The layout version is the job's output, recorded as an `ai.job.output`
  activity row like every other op's.
- **The site start shares it (AGL-3747).** A guided start still adds its
  pages' header entries when it publishes (`aiLayoutWithNavigation`), since
  only then does it know which pages went live, but it adds them through this
  op's `aiLayoutWithMenuChanges`: into the bar's menu and the phone menu,
  after their items (after the brand in a starter's Toolbar), like their
  neighbours, and never a second item of a name already there. Its link
  repair is unchanged: links to a retired starter home move to the new home,
  and links to pages it did not write come out. A blog whose posts part
  failed is published with its links out; once Try again puts its posts live
  (AGL-3739), the same code puts its header entry back, after the home
  page's item (`aiRestoreGuidedBlogEntry`), as a new live layout version.
- **Not yet.** Mega menu panels' columns and new drawers are not made, and a
  menu change never publishes on its own, even in a build that publishes its
  pages.

## Duplicating (AGL-3740)

- **What can be copied** is exactly what the console's Duplicate… copies on a
  site: `DUPLICABLE_HOST_RESOURCE_KINDS` in
  `libs/aglyn/src/lib/app-utils/duplicate-resource.ts` — a page (`screen`), a
  component, a layout, a template, a form, an email design and a workflow
  (the workflow's recipe is the workflows plugin's declaration). Nothing else:
  a product's Duplicate is a client-side create in the commerce card with no
  server function to reuse, and datasets, email templates and campaigns have
  no site-level copy door, so the op does not offer them.
- **The op.** `duplicate` (`jobs/ai-build-capabilities.ts`, at most three a
  plan) takes `kind`, `source` (an inventory id, or the exact name where the
  inventory lists none — email designs and workflows) and an optional
  `name`. A source this build is making (`new:`) is refused: only what the
  site already has is copied. The planner sees the op and its arguments in
  the op catalog and Assist's build intents, so the plan prompt changed with
  it.
- **Made by core** (`jobs/ai-job-duplicate-step.ts`): the same
  `duplicateResource` the row menus and `/api/hosts/resources` (`action:
  'duplicate'`) call — the same fields, unique name and slug, the kind's plan
  counter and feature met inside the copy's transaction, and the
  `*.duplicated` activity row. The job's id is the attempt key, so a pass
  asked again makes no second copy. A source named by name must be the one
  live row of that name, among rows of that kind (pages and email designs
  share `screens`).
- **Gates.** The console door's: a member with the admin, editor or author
  role on the site, while no lockdown freezes it, at the door and again
  before the copy; the job's `ai.generate` gate as for every job. A plan
  counter or a missing feature comes back as a plan limit.
- **Cost.** No model, so 0 credits. Free may ask for one: the copy meets the
  plan's own counters exactly as the console's Duplicate does.
- **Draft only.** A page copy has no address, a workflow copy no trigger, and
  nothing places a component, layout or form copy until a person does.
- **Not yet.** A later item or page in the same plan cannot cite the copy as
  `new:<name>`; a page that should start from another is still the page
  runner's `duplicateOf`.

## Events calendar (AGL-3743)

- **The events-calendar plugin owns it**, as bookings owns `booking-service`.
  `server/event-drafts.server.ts` is the `event` writer on the resource-drafts
  seam and `server/event-ai-capability.ts` the `event` build operation, both
  registered from the plugin's console-server declarations (the console runs
  AI jobs). The writer is loaded lazily; its check is pure
  (`model/event-draft-content.ts`). Nothing in the AI plugin names it.
- **What an event is.** Exactly what the Events page edits, stored through
  `eventWrite` (`model/event-write.ts`), the rule the editor and the import
  already share: title, start, end (default one hour), location, organizer,
  description, and a cover image with its description. The plugin has no
  recurrence, tickets, RSVP, online link or time zone field, so the op offers
  none. A start and end are a wall time `YYYY-MM-DDTHH:MM` in an IANA zone,
  read into the instant the event stores; "Online" is a location.
- **The op.** `event` (at most six a plan) takes `title`, `startsAt`,
  `endsAt` (optional), `timezone`, `location`, `organizer` and `description`.
  One item is one event. A page section that uses one or more of them places
  the `eventList` block once, naming every event built; if one event fails
  and another in the section was built, the block stays and only that event
  is missing. The planner fills the arguments: no model pass, 0 credits.
- **Business-specific, in the future.** The argument descriptions ask for a
  title specific to the business (never "Event 1"), a description in its
  voice with no price, ticket, sign-up or link the request does not state,
  and no person's name it does not give. A build's plan is told today's date
  (`aiPlanTodaySentence`), and the writer refuses a start that is not after
  the write, so a past event fails its item rather than being stored.
- **Gates.** The `eventCalendar` add-on (on no plan by itself; Free with the
  add-on may use it, since an event costs no credits), the plugin on for the
  site and past its release flag, and a member with a write role on the site.
- **Draft only.** Every event is born `status: 'draft'`. The public listing
  shows only published events, so the Event List the build placed is empty
  until the owner publishes the events on the Events page, where the job's
  link (`event` record route) opens.
- **Not yet.** No cover photo: the capability seam has no way for a plugin's
  writer to ask the AI plugin for a stock photo, and a planner-written image
  address would be invented. Events are not part of a guided site start, which
  still lists events as a dataset or as written-out copy.

## Forms that write to a dataset

Zach, 2026-10-10: Aglyn AI's forms can write to datasets — a volunteer
sign-up into a Volunteers dataset, an RSVP into an event's attendees, a
catering inquiry into Inquiries.

- **The plan says so.** The plan tool that carries record templates (offered
  only where the job may bind a dataset) gives each creation a `writesTo`:
  on a form, `new:<name>` of a dataset the plan makes (a site start's dataset
  creation or a build's `dataset` item) or a dataset id from the inventory;
  null otherwise. It is never inferred from a section's `uses`. A paid site
  plan's turn says when to use it (`AI_SITE_FORM_DATASET_SENTENCE`); the Free
  plan's tool and turn are unchanged.
- **Settled in code** (`aiSettlePlanFormDatasets`, before the dataset cap):
  a `writesTo` naming nothing the form can write to comes off; one naming an
  inventory dataset by name gets its id; a dataset made for a form is listed
  on no page and is no record template, because its records are the people
  who sent it. The dataset cap counts a form's dataset like a record
  template, and lets go of the form's `writesTo` if it lets go of its dataset.
- **Built first.** A site start builds its datasets after the layout and
  before the form (`aiSiteJobUnits`); the form unit depends on its dataset.
  A build orders the form after its dataset item. A form's dataset is
  designed with no model and no records (`aiSiteFormDatasetContent`): its
  planned fields (or the form's), in a person's words, text unless typed
  `Name:type`, none required. It is not a pass of the estimate.
- **Bound by the form step** (`jobs/ai-job-form-dataset.ts`): the form node's
  `datasetId` and each field's `datasetFieldId`, matched by `fieldName` then
  label against the dataset's fields, where the type can hold the answer
  (any answer in text, a rating in a number). A field the dataset lacks is
  left unbound — the Form element's mapping does the same — and the row's
  note says that answer stays in the Inbox. The generation is told the
  dataset's fields so it draws them.
- **Gates.** Bound only where the plan includes `dataStore`, the data
  plugin's writer is loaded and reads the dataset, and the dataset is one
  this job made or one the site's inventory shows. Records, `recordsPerDataset`
  and storage are held at each submission by the data plugin's record target.
  A dataset that could not be made leaves the form built as it always was,
  its row noting that submissions arrive in the Inbox only.
- **Not yet.** A copied form (`duplicateOf`) keeps the copy's own binding,
  and no form adds a field to a dataset it writes to.

## Redirects (AGL-3745)

- **The redirects plugin owns it.** `libs/plugins/redirects/src/lib/server/redirect-ai-writer.ts`
  is the `redirect` writer on the resource-drafts seam and
  `redirect-ai-capability.ts` the `redirect` build operation, both registered
  from the plugin's console-server declarations. The AI plugin's build step
  runs the item like any other plugin's draft item; there is no new job kind.
- **One change per item.** `action` is `create`, `update` or `remove`; the rule
  is named by its from-path (`source`) and, when two modes share it, its
  `kind`. The arguments are the rule's own fields (`destination`, `newSource`,
  `kind`, `statusCode`, `priority`, `enabled`) plus `replacesLivePage`. The
  planner fills them, so an item costs 0 credits.
- **The page's checks, through its own functions.** The writer reuses the
  importer's `withDefaults`, `ruleProblem` and `storedFields` and the model's
  `findDuplicateRedirect`, `walkRedirectChain` and `redirectSourceIsLivePage`:
  the publishing role, the `redirects` feature, lockdown (a write verdict),
  lookalike destinations, self-redirects, duplicates, and loops. A create is
  counted and written in one transaction against `redirectsPerHost`; an update
  or a remove takes no slot. An off-site destination carries the member's uid
  (`externalDestinationApprovedBy`), and every touched path is announced to the
  site cache.
- **Stricter than the page in two places.** A from-path the site publishes a
  page at is refused unless the item sets `replacesLivePage` (the page only
  warns), and a destination that leads into a loop other rules make is refused
  (the page only warns, the importer reports it).
- **Live once written.** A redirect has no draft state, so the capability sets
  the contract's new `live` flag and the job's output reads "Live now, in
  Redirects." rather than "A draft". The plan card is the person's agreement.
- **Remove is the page's Delete:** `deletedAt` and `enabled: false`.
- **Not done:** hit counts, import and export, and a destination that is a page
  the same build creates (an unpublished page has no live path).

## Store setup (AGL-3749)

- **Commerce owns it.** `libs/plugins/commerce/src/lib/server/store-setup-ai-writer.ts`
  is the `store-settings` writer on the resource-drafts seam;
  `store-setup-ai-capability.ts` registers four build ops it executes, from
  `registerCommerceConsoleApi`. The change is read and applied by the pure
  `model/store-setup-content.ts`, through the cards' own normalizers and
  checks. `store-settings` is the record route the job drawer links to.
- **`store-shipping`**: one zone (by name, or by the same countries) and one
  rate in it: `flat`, `free_over`, `price_tiers` or `weight_tiers`, the
  Shipping card's kinds. Set adds or replaces a rate by name, keeping its
  id. Remove takes a rate, or a zone and its rates as the card's ✕ does. A
  layout that turns buyers away comes back as a warning
  (`summarizeShippingCoverage`). Carrier rates are refused: they need a
  carrier account.
- **`store-pickup`**: the store-wide "Offer free local pickup" switch, or
  pickup at an inventory location the request names (by name, city or
  street) with its hours, instructions and preparation time. A location is
  found, never created: "pickup in Austin" with no Austin location is
  refused with where to add one.
- **`store-delivery`**: the Local delivery card's settings with postal-code
  zones (fee, minimum, free-over), windows, lead time, days ahead and
  instructions. Distance zones need the store placed on a map and stay the
  card's. Switching delivery on is refused while `localDeliveryProblems`
  says checkout would not offer it.
- **`store-tax`**: the mode (manual rates, automatic, or not collecting),
  whether prices include tax, the store origin, and a manual rate by
  country and state. Lodging and service rates are kept. Manual mode with
  no origin is refused (it refuses every sale, AGL-2145). A rate on a store
  that calculates automatically is refused unless the change switches it to
  manual. Tax services (Avalara, TaxJar) need credentials and are not
  offered.
- **No number the person did not give.** Every amount, fee and percentage is
  described to the planner as "only when the request states it", and the
  writer refuses a flat or free-over rate without its amount, a new delivery
  zone without its fee and a tax rate without its percentage. "Set up tax"
  alone is meant to be a question back, not an item.
- **Gates.** An admin or editor on the site (`hostRoleCanPublish`), checked
  at the build's admission and again in the write; the plan's `commerce`
  feature; and no lockdown refusing a write. This is stricter than the cards,
  which an author may also save: an AI change of what checkout charges is
  live at once (Zach, 2026-10-12). Free has no commerce.
- **Live, not a draft.** Store settings have no draft state, and the cards
  save them live; the plan card's Confirm is the agreement. The capabilities
  carry the contract's `live` flag (AGL-3745), so the job's output reads
  "Live now, in Products → Settings." rather than "A draft".
- **Idempotent.** Each change is applied inside a transaction to the
  settings the site has; a new zone or rate takes an id derived from the
  item, and a change the settings already hold writes nothing (`replayed`).
- **Cost.** No model, so 0 credits.
