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
| `product` (12) | commerce | `product` writer (`libs/plugins/commerce/src/lib/server/product-ai-capability.ts`) | `commerce` | `productsPerHost` | no |
| `booking-service` (5) | bookings | `booking-service` writer | `bookings` | `servicesPerHost` | no |
| `variable` | logic | `variable` writer | | `variablesPerHost` | yes |
| `overlay` | marketing | overlay writer | `marketingOverlays` | | no |
| `experiment` | marketing | experiment writer | `abTesting` | | no |
| `funnel` | funnels | funnel writer | `screenAnalytics` (`FUNNEL_FEATURE`) | | no |
| `dataset` (3), **new in this PR** | data | `dataset` writer (`libs/plugins/data/src/lib/server/dataset-drafts.ts`) | `dataStore` | `datasetsPerOrg` | no |

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
  **Nothing calls it.** It is defined and specced, and
  `libs/aglyn/src/lib/app-utils/duplicate-resource.ts` calls it "the AI runtime
  tool that opens this door for the planner", but neither Assist nor any job
  offers it. Plans copy a page through `duplicateOf` instead.

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
| Menus and navigation | dropdown, mega menu, drawer | partial: a guided start writes header links at publish; no dropdown, mega or drawer menus |
| Bindings and logic | variables, functions | yes (`variable`, `function`) |
| Templates and blog | page templates, blog collections, entries | partial: entry, product and author templates; a blog start's first 3 posts; no collection create, authors or scheduled posts outside a site start |
| Site backup and packages | export, import, merge | no, by design: a person's decision |
| Custom domains | connect and verify a domain | no, by design (out of scope) |
| Redirects | rules, loop checks, hit counts | no |
| SEO | per-page listing, sitemap, structured data, audit | yes: listings, audit fixes, the site listing |
| Site protection | password a page, error pages, maintenance mode | no |
| Multilingual | locale variants, hreflang, Weglot | no |
| Site search | search box, search page | no |
| Live chat | Tidio, LiveChat | no |
| **Datasets** | typed fields, references, records, import and export, a page per record | **yes in this PR**: creates a dataset with typed fields and seeded records, lists it on pages, drafts its record page; no references, import or record edits after the build |
| Forms | forms, submissions inbox, write submissions into a dataset | yes: makes forms, and binds one to a dataset where the plan says it writes to one (`writesTo`, AGL-3616) |
| Events calendar | events, publish to pages, event schema | no |
| Media library | folders, transforms, CDN, tags | partial: Create with AI and stock photos into the library; no folders, tags or metadata |
| CRM | contacts, companies, deals and pipelines, leads, tasks, custom fields, views | partial: record insight, email draft, import matching; no records, pipelines, custom fields or views |
| Commerce | catalog, orders, shipping, tax, POS, channels | partial: products (drafts, listed at a starting price on a site start), categories and discounts proposals; no shipping, tax, pickup, payments, POS or order emails |
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
   static copy where datasets are not allowed. See below.
2. **Navigation and menus.** Navigation is written only at publish, as flat
   header links. There is no op for dropdown, mega or drawer menus.
3. **Blog collections and posts.** Collections can't be created outside a
   site start, and there are no authors or scheduled posts.
4. **Forms that write to a dataset. CLOSED (Zach, 2026-10-10).** A form's
   creation says the dataset it writes to (`writesTo`); see "Forms that write
   to a dataset" below.
5. **Events calendar.** No `event` capability. It is an add-on on every plan.
6. **Redirects.** No capability. Starter includes 25.
7. **CRM records.** No pipelines, deals, custom fields or saved views.
8. **Store setup.** No shipping, tax, pickup and delivery, payments, POS or
   order emails.
9. **Site settings.** No maintenance mode, password or error pages, site
   search or multilingual.
10. **Integrations.** No webhooks, Zapier or GA4/conversions setup.
11. **Media library.** No tags, folders or metadata, and no video, music or
    lightbox placement ops.
12. **Duplicating.** `duplicate_resource` exists and nothing calls it. Wiring
    it into Assist would let "make another page like Services" copy instead
    of regenerate.

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
- **Not yet.** Records carry no photos (a portfolio's pieces are words only),
  and listing cards do not link record pages until the member saves the
  binding.

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
