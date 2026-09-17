/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RELEASE_FLAGS } from '@aglyn/aglyn'

/**
 * AGL-1909: Anthropic must be a published subprocessor BEFORE it processes
 * customer content — and the dependency has to be structural, because as
 * filed it lived in prose on a checklist line already ticked Done.
 *
 * Three claims, each able to go red on its own:
 *
 *  1. `release_assist` still ships OFF, and its description still names both
 *     published preconditions. The description is the only place the
 *     precondition travels with the thing it gates — it is what a staff user
 *     reads in the flags admin at the moment they are deciding to flip it.
 *  2. The set of files that read `ANTHROPIC_API_KEY` is exactly the known
 *     list. This is the load-bearing one.
 *  3. Every Assist record is written UNDER the org document, which is what
 *     makes the retention promise in the privacy disclosure true. That claim
 *     drives the AI plugin's meter, so it is pinned beside the meter, in
 *     `libs/plugins/ai/src/lib/usage/assist-records-reachable-by-erase-org.spec.ts`:
 *     an app reaches a plugin only through its generated manifests.
 *
 * ## Why the key, and not the flag
 *
 * AGL-1909 was filed on the premise that flipping `release_assist` is what
 * turns Anthropic into a production subprocessor. It is not, and the
 * difference matters for the ordering the issue exists to protect:
 * `/api/ai/assist` — the besigner copy assistant, AGL-89/130/169, registered
 * unconditionally in `libs/plugins/ai/src/lib/server.ts` — carries no
 * release flag at all. It sends customer site copy, blog bodies and section
 * briefs to Anthropic on `ANTHROPIC_API_KEY` plus a Pro entitlement, and
 * nothing else. So setting that key in production makes Anthropic a
 * subprocessor whether or not the Assist flag is ever flipped, and a guard
 * that watched only the flag would pass while the page was already wrong.
 *
 * Test (2) therefore watches the key. A new reader is a new Anthropic data
 * flow, and it fails here until someone has looked at whether the published
 * subprocessor page and privacy disclosure still describe reality.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..')

/**
 * Every tracked source file that reads `ANTHROPIC_API_KEY`, and what data it
 * sends to Anthropic when the key is set. Documentation is excluded below —
 * this is about code paths that can move customer content.
 *
 * Adding an entry is the point at which someone must ask whether
 * `/legal/subprocessors` and the privacy disclosure still describe what the
 * platform does. Do not add one to make this suite pass.
 */
const KEY_READERS = new Map<string, string>([
  [
    'libs/plugins/ai/src/lib/providers/anthropic.ts',
    'The Anthropic adapter behind the Aglyn AI provider contract (AGL-2939): it declares the key as its `apiKeyEnv` and puts it on a Messages API request to the host it names. It opens no door of its own and sends whatever request the AI runtime hands it, so what reaches Anthropic is still decided by the doors, the same content to the same subprocessor, and `AI_DOORS` below pins them one by one. The runtime calls it in place of the shared runtime that read the key in `libs/tenant/data/admin` (AGL-2903), which is why that entry left this list and this one stayed.',
  ],
])

/**
 * Every tracked source file that calls the AI runtime, and what customer
 * content it sends to the active provider. The adapter above is the only
 * key reader, so a new door no longer adds a reader — it adds a caller, and
 * this is the list that goes red for it.
 */
const AI_DOORS = new Map<string, string>([
  [
    'libs/plugins/ai/src/lib/server/assist-chat.ts',
    'Aglyn Assist (AGL-1860) at /api/assist/chat: the customer question, a trailing window of the thread, and — on Pro+ — the current route, host and org name. Gated by `release_assist` AND a ready provider. The same URL, content and gates it had as the console route before it moved into the AI plugin (AGL-2939): a move, not a new flow, so /legal/subprocessors still describes it. Its edit rung (AGL-2906) sends one more kind of content, and only behind `release_ai_generative`, the `aiGenerative` entitlement, the caller’s `ai.generate` and the `ai-generate` lockdown key, on a versioned besigner route: an outline of the canvas the member has open — element ids, component ids, layer names, primitive setting values cut to 80 characters (400 for the selected element) and the selected element’s styles. That is site content of the document being edited, the kind the besigner copy assistant already sends; the flag’s own description says turning it on sends site content to Anthropic under the Assist disclosure, and /legal/subprocessors has named that outline in the Anthropic row since its September 15, 2026 change-log entry (AGL-2902).',
  ],
  [
    'libs/plugins/ai/src/lib/server/ai-assist.ts',
    'Besigner copy assistant (AGL-89/130/169) at /api/ai/assist: element copy, blog bodies with title/excerpt, and section briefs. NO release flag — a ready provider plus a Pro entitlement is the whole gate. The same URL, content and gate it had in the marketplace plugin before it moved into the AI plugin (AGL-2939): a move, not a new flow, so /legal/subprocessors still describes it.',
  ],
  [
    'libs/plugins/ai/src/lib/runtime/ai-doctrine.ts',
    'The building doctrine’s generation loop (AGL-2935), which every generator runs its request through. It sends what the calling door sends. A generation job’s plan step (`jobs/ai-job-plan-step.ts`): the job’s brief, kind and scalar inputs. Its layout and template steps (`jobs/ai-job-layout-step.ts`, `jobs/ai-job-template-step.ts`, AGL-2909): the brief and the confirmed plan as references — the ids and names it reuses, and what it creates with the reasons given — and, for a template, what the page is for (a content collection’s entries, with that collection’s name and slug; a product; an author) with the names of the binding tokens that page fills, beside the platform’s own starter pages as examples. Its email and campaign steps (`jobs/ai-job-email-step.ts`, `jobs/ai-job-campaign-step.ts`, AGL-2912): the brief, the email’s or campaign’s name, the kind of email the member picked, for an email job the confirmed plan as references, and how many product blocks to place — a count, never a product’s name, description, price or picture, which the send fills by id. Products are bound, a list the brief names is suggested and a send time is computed from that list’s past sends on the site, all in code and never in a prompt, so no email list, contact, recipient, CRM record, product record or engagement statistic is sent, and a list or product the brief names reaches the model only as the brief’s own words. Its form step (`jobs/ai-job-form-step.ts`, AGL-2913): the brief, the form’s name and the confirmed plan as references; it reads no email list, contact, CRM record or form submission, so none of them is sent, and a list the brief names reaches the model only as the brief’s own words. Its component step (`jobs/ai-job-component-step.ts`, AGL-2908): the brief, the component’s name and the confirmed plan as references, as a layout’s step sends them, and no other content of the site. The second way into that step, saving a section already on the page as a component (`server/ai-generate-component.ts`, AGL-2908), sends instead the outline of the open page, component or layout — its elements, their names, their shortened settings and text, and the selected element’s own styles — with the name the member typed, and NO site inventory at all: no other page, no entry, no product, no contact and no form submission is read, so none is sent. It answers property names and where they bind, never a document, and writes nothing itself. Its page step (`jobs/ai-job-page-step.ts`, AGL-2907), one pass for each section of the page: the brief, the page type the member picked, the confirmed plan as references, the section to build with the inventory ids it places, and the names of the sections already built above it, never their content. Each travels with the site inventory: the names and ids of the site’s reusable components (with their prop names), layouts, templates, forms and datasets (with their field names), content collections and screens (with their slugs), and the theme’s summary, light-scheme colors and fonts. A generation job’s theme step (`jobs/ai-job-theme-step.ts`, AGL-2938): the brief, the site’s current theme settings — its colors, font, corner radius, spacing, navigation heights and component style overrides — and brand colors as hex values: a white-label workspace’s brand color, colors read from the site logo in its media library, and colors read from a public page the brief links to, with no site inventory. A generation job’s `seo` step (`jobs/ai-job-seo-step.ts`, through `runtime/seo-fields.ts`, AGL-2910), with no site inventory: for one page’s search listing, the page’s text as its Markdown representation, its current title, description, breadcrumb label and image description, the text beside its share image, the site’s name, the titles the site’s other pages use and the target keywords the member typed; for a product, the name and description its editor handed over; for a site audit, each audited page’s findings, current listing, main heading, text and undescribed images with the text beside them, and, for the site-wide proposal, the site’s page list with names and titles, the text of its home, about and contact pages, and its content collection names. A generation job’s `workflow` step (`jobs/ai-job-workflow-step.ts`, AGL-2919), with no site inventory block: to draft an automation, the brief, whether the workspace has the CRM, webhooks and bookings, and the names and field names of the site’s forms and the names of its datasets, which the published row names for a generation job; every email list, campaign, workflow, webhook and pipeline stage the brief names reaches the model only as the brief’s own words and is looked up among the site’s records in code, after the answer, so none of their names is sent. To explain a saved automation, an outline of how it is set up — its trigger, its conditions, each step by its label with the text an email, an alert, a tag or a task was given, whether each list, campaign, workflow, webhook and dataset it names still exists, and for a workflow its function names and argument expressions — and, to explain a failed run, when it ran, on what, what it did and the errors the run history recorded. Every email address in an outline is replaced by `[email address]`, a teammate is named only as a named teammate, and a run’s event payload, which holds what a visitor submitted, is never read. The Anthropic row and the Privacy Policy published on September 17, 2026 (legal v8, AGL-3069) name an automation’s outline and a failed run’s recorded errors; both doors still stay behind `release_ai_generative` (AGL-2919). A generation job’s `products` step (`jobs/ai-job-products-step.ts`, AGL-2916), with no site inventory: for one product’s copy, the product’s name, type, description, tags, option names and values and current search title and description as its editor holds them, the names of the site’s product categories and the store’s name, and — only to a model whose catalog row says it reads pictures (`vision`) — the product’s FIRST photo, read only as an asset of the site’s own media library or its org’s, the way the media CDN would serve it, and sent as a new JPEG at most 768 pixels on its longer edge at quality 80 that carries none of the original file’s metadata. No other photo of the product and no other media asset, file name, folder or alt text is read, and no URL is fetched. A bulk job sends the same for each saved product it was given, one product a request. A catalog request sends the brief and the store’s name; a categories-and-discounts request sends those and the names of the store’s existing categories. No price, stock level, order, customer, discount or payout is read for any of them, and the step writes nothing: every answer is a proposal the commerce plugin’s own surfaces save when a person accepts it. The Anthropic row and the Privacy Policy published on September 17, 2026 (legal v8, AGL-3069) name the product’s first photo, sent as a reduced copy with its metadata removed; the step still stays behind `release_ai_generative`. On its one re-ask it also sends the rules the first answer broke, with the offending parts of that answer. The customer’s own brief, the structure of their site and its design settings, and for the `seo` step the text of the pages and the product it writes about: no visitor or personal data, no form submission, and no other entry’s, product’s or author’s content. An `seo` step writes nothing back to the site. Behind `release_ai_generative`, the `aiGenerative` entitlement, the `ai-generate` lockdown key and the `ai.generate` permission. `/legal/subprocessors` has named a generation job’s brief, the site inventory these steps send, and the site’s current theme settings and the brand colors a theme change sends in its Anthropic row since the September 15, 2026 change-log entry (AGL-2902). The published Anthropic row (since v7, 2026-09-15) describes the `seo` step: its purpose names search titles and descriptions, and its data names, for features that review or write search information, the text and structure of the pages concerned. A product listing’s name and description are the text of that product’s page, so they fall under the same words. A generation job’s `crm` step (`jobs/ai-job-crm-step.ts`, AGL-2917), with no site inventory, sends what the CRM’s own readers report on the record-facts seam for the member who asked, and nothing the step read itself. For a contact, company, deal or lead: the record’s name, job title, company name, lifecycle stage, tags, the kinds of capture that met the person, an order count and the last purchase day, the days it was created and last engaged with an email, its notes cut to 600 characters, its twelve newest timeline entries (the day, the kind of activity or capture, an email’s direction, delivery state and subject, and the text cut to 280 characters), up to eight open tasks (title, kind, priority, due day) and up to five deals (title, stage, status, amount, expected close day); for a company also its domain, industry and how many people it has; for a deal also its pipeline’s stage names and ids, the day it entered its stage, a lost reason, the names of the person and company it is with and a count of its products; for a lead its status, capture kinds, capture count, first and last seen days, whether it is assigned or converted, and an unqualified reason. Text a person wrote into the record (names, job titles, tags, notes, logged activities, capture summaries, task and deal titles, reasons) is sent as written, except that an email address or a phone number inside it is replaced by a placeholder first; a postal address typed into a note is not recognized. An email draft adds the request the member typed, cut to 600 characters, and the merge field names the record can fill. An import’s column matching sends the import’s field labels and types, custom fields included, and each column’s header cut to 60 characters with the shape of its values read in the browser, never a cell. No email address, phone number, postal address, consent, custom field value, team member or record id is sent. The step writes no CRM record: its answer is kept for 14 days apart from the job, at `orgs/{orgId}/aiCrmAnswers/{jobId}`, and served only to a member the CRM lets read the record, and for an email draft or an import only to the member who asked. The Anthropic row and the Privacy Policy published on September 17, 2026 (legal v8, AGL-3069) name CRM records, email requests and an import’s column headers; the step still stays behind `release_ai_generative`. When a person runs the eval harness live (`AI_EVAL_LIVE=1 npm run eval:ai-live`, AGL-2937, from a machine that holds a provider key and never in CI or on a deployment), the loop sends the harness’s own golden briefs, fixture inventories and theme settings, written in the repository, and a grader’s request quoting the answer it grades: no customer content.',
  ],
  [
    'libs/plugins/ai/src/lib/jobs/ai-job-insight-step.ts',
    'A generation job’s insight step (AGL-2915): a question about a site’s or a workspace’s own figures, and the weekly insights a member asked for. Two calls. The first sends the question, the window picked, and the ids, names and descriptions of the figure readers the workspace may read here — and, for a question asked on a Data page, the names of the datasets the member may see with their fields’ names and types — and answers only a choice among those readers. The second sends the question and the tables the chosen readers returned: AGGREGATES, never records — page views, visitors and the change from the window before; the most viewed page paths and referring sites with their views; each form’s name with its views, submissions, completion rate and leads; the store’s revenue, orders and average order and its best-selling products’ names with units and line revenue; bookings counted by service name; campaign emails by subject with delivered, opened and clicked rates; A/B test and variant names with visitors shown, conversions, rates and lift; a dataset’s records, fields and fill rates, or its records grouped by the values of one field with at most sixty different values, with a count, sum, average, lowest or highest, every group of fewer than three records folded into one row. No visitor, contact, lead, customer, order, booking, submission, recipient or dataset record is sent, and every text cell is stripped of email addresses and phone numbers before a table is built. A weekly digest makes no first call: code reads its readers. It writes the answer to `orgs/{orgId}/aiInsights/{jobId}` (no client reads it) and nothing else. Behind `release_ai_generative`, the `aiGenerative` entitlement, the `ai-generate` lockdown key, the `ai.generate` permission and the per-site AI switch, so it runs nowhere the flag is off. THE PUBLISHED ANTHROPIC ROW DOES NOT YET NAME THIS CATEGORY: its data list covers a brief, the site inventory, theme settings and page text, not analytics or sales figures. The Anthropic row and the Privacy Policy published on September 17, 2026 (legal v8, AGL-3069) name AI insights and the tables of figures it sends; the flag still stays off for customers until it is turned on.',
  ],
  [
    'libs/plugins/ai/src/lib/jobs/ai-job-text-step.ts',
    'A generation job’s text step (AGL-2904): the brief the job was created with. Behind `release_ai_generative`, the `aiGenerative` entitlement and the `ai-generate` lockdown key. The eval harness’s live run (AGL-2937, `AI_EVAL_LIVE=1`, never in CI or on a deployment) sends it the harness’s own golden briefs from the repository. It called the shared runtime before the AI plugin existed too; it is listed because the runtime’s callers are now the list that pins each flow, not because the flow is new.',
  ],
])

/**
 * Tracked files that NAME the key without sending anything to Anthropic —
 * provisioning, documentation, specs, and the legal record. Each carries why,
 * because the interesting ones are not the docs.
 */
const MENTIONS_ONLY = new Map<string, string>([
  [
    'tools/scripts/bootstrap-platform.mjs',
    'The provisioning script that SETS the key on the Vercel projects. Not a data flow — it is the act that starts every data flow above, and therefore the step AGL-1909 orders after publication.',
  ],
  [
    'apps/console/constants/legal-documents.ts',
    "The legal snapshot record. Its v3 note (2026-08-14, AGL-1555) says the Privacy Policy's §3 provider bullet DROPS Anthropic because `ANTHROPIC_API_KEY` is absent from production and the AI-assist route 501s — so the privacy page, not only /legal/subprocessors, was rewritten on that premise and becomes wrong when the key is set.",
  ],
  [
    'apps/console/constants/subprocessor-inventory.ts',
    "The subprocessor registry (AGL-1648) — the declarative disclosure of who Aglyn shares data with. It names the key once, in its header's table of the four checks that could not see the Linear flow, where this suite is the guard pinned to one env var name. The Anthropic row it discloses is not written in it: the registry folds that row in from the generated subprocessors manifest below, and the AI plugin's provider catalog declares the row's wording (AGL-2984). It is imported by nothing but specs, so it reads no key and reaches no runtime.",
  ],
  [
    'apps/console/constants/plugins.subprocessors.generated.ts',
    "The subprocessors manifest (AGL-2984), written by `generate-plugin-manifests.mjs`: the AI plugin's subprocessor declarations as data, which the subprocessor registry folds in. It names the key inside the Anthropic row's `reason`, where the adapter's `apiKeyEnv` fills the catalog wording's placeholder, so the mention is the disclosure itself. Data and a type import only: it reads no key and reaches no runtime.",
  ],
  [
    'apps/console/constants/subprocessor-inventory-plugins.spec.ts',
    'Pins the Anthropic row the subprocessor registry folds in from the generated manifest to the published text, field for field (AGL-2984), so the key appears inside the pinned `reason`. A test of the disclosure, not a flow.',
  ],
  [
    'libs/plugins/ai/src/lib/subprocessors.spec.ts',
    'Pins the Anthropic row the AI plugin derives from its provider catalog to the published text, field for field (AGL-2984), so the key appears inside the pinned `reason`. A test of the disclosure, not a flow.',
  ],
  [
    'libs/aglyn/src/lib/app-utils/release-flags.ts',
    'The `release_assist` description, which carries the precondition this suite pins.',
  ],
  [
    'docs/BREACH_NOTIFICATION.md',
    'The credential-rotation checklist (AGL-1915) lists the key among the secrets to rotate after an incident. Naming a secret in a runbook is the opposite of a data flow — but the suite is right to have stopped on it, because "a new file mentions ANTHROPIC_API_KEY" is exactly the event it exists to make someone look at.',
  ],
  [
    '.github/workflows/tools-guards.yml',
    'The workflow step that RUNS `check:provider-key-exposure` — the guard proving no model-provider key is reachable from the client closure (AGL-2379). It names the key only in the comment explaining what that guard proves. A workflow that runs a check ABOUT the key is the opposite of a data flow, but the suite is right to have stopped on it: "a new file mentions ANTHROPIC_API_KEY" is exactly the event it exists to make someone look at.',
  ],
  [
    'cloud/firebase-remoteconfig.template.json',
    'The DEPLOYED flag seed and its staff-facing description — the one that actually decides the flag in production.',
  ],
  [
    'libs/plugins/ai/src/lib/server/assist-chat.spec.ts',
    'Sets a fake key to exercise the 501 gate. It moved with the chat door into the AI plugin (AGL-2939); still a test double, not a flow.',
  ],
  [
    'libs/plugins/ai/src/lib/server/assist-chat-edit-rung.spec.ts',
    'Sets a fake key (`test-key`) so the chat door reaches its mocked provider on the edit rung (AGL-2906), and asserts on the request that fake receives — including that the canvas never reaches it below the rung. A test double, not a flow; the door it drives is the `assist-chat.ts` entry in `AI_DOORS`.',
  ],
  [
    'libs/plugins/ai/src/lib/server/ai-assist.spec.ts',
    'Sets a fake key (`sk-test`) to exercise the same 501 gate on the besigner route, and asserts the mocked fetch is never called. Added by AGL-2073; not a data flow. It moved with its handler into the AI plugin (AGL-2939).',
  ],
  [
    'libs/plugins/ai/src/lib/runtime/ai-runtime.spec.ts',
    'Sets a fake key (`sk-test`) to drive the shared runtime against a mocked fetch (AGL-2903), and asserts it refuses to run without one. A test double, not a flow. It moved with the runtime into the AI plugin (AGL-2939).',
  ],
  [
    'libs/plugins/ai/src/lib/providers/conformance.spec.ts',
    'The provider conformance suite (AGL-2939). Sets a fake key (`sk-test`) so the Anthropic adapter answers recorded fixtures through a mocked `fetch`, with no network and no real key. A test double, not a flow.',
  ],
  [
    'apps/console/.env.development.local.example',
    'Local development template.',
  ],
  [
    'docs/drafts/agl-1648-dpa-transfer-scc-language.md',
    'AGL-1648 working draft of proposed DPA transfer/SCC wording. Prose about whether Anthropic must be disclosed as a subprocessor — it names the key to explain WHY the disclosure question exists. Analysis, not a data flow, and it reaches no runtime.',
  ],
  [
    'docs/drafts/agl-1648-subprocessor-change-notification.md',
    'AGL-1648 working draft of the subprocessor change-notification mechanism. Names the key while arguing that setting it in production is what makes Anthropic a live subprocessor — which is this suite\'s own premise, written down. Prose, not a data flow.',
  ],
  [
    '.env.selfhost.example',
    'The self-host env template (AGL-2014). Names the key so an operator knows Assist needs their OWN Anthropic key; without it both Assist surfaces answer 501. A template, not a flow.',
  ],
  [
    'docs/SELF_HOSTING.md',
    'The self-host runbook (AGL-2014). Documents the same key as an optional operator-supplied credential. Documentation, not a flow.',
  ],
  [
    'libs/plugins/ai/src/lib/components/assist-panel.component.spec.tsx',
    'The panel suite (AGL-2486). Names the key only inside a CANNED 501 body it arms, to assert the panel does NOT relay that operator string to the user. A test double, not a flow — and the assertion is that the string stops there. It moved with the panel into the AI plugin (AGL-2939).',
  ],
  ['docs/PLATFORM_PROVISIONING.md', 'Documentation.'],
  ['apps/docs/docs/developers/self-hosting.md', 'Documentation.'],
  [
    'apps/docs/docs/developers/self-hosting-environment.md',
    'The published environment-variable reference. Names the key in the row telling an operator to bring their own, alongside the spend ceilings that bound it. Documentation, not a flow.',
  ],
  [
    'docs/BREACH_NOTIFICATION.md',
    'The breach runbook (AGL-1915). Names the key only in the list of credentials to rotate after an exposure, alongside FIREBASE_PRIVATE_KEY and STRIPE_SECRET_KEY — a rotation target, not a data flow to Anthropic.',
  ],
  [
    'apps/console/specs/assist-anthropic-subprocessor-gate.spec.ts',
    'This suite.',
  ],
  [
    'tools/scripts/check-provider-key-exposure.mjs',
    'The AGL-2240 exposure checker. Names the key only inside a regex of provider-credential NAMES it refuses to find in the browser bundle; it never reads `process.env` for one and sends nothing anywhere. The complement of this suite: that one asks which MODULE GRAPH a reader is in, this one asks which FILES read it at all — and a reader can be correctly listed here while shipping to every visitor, which is the hole it closes.',
  ],
  [
    'apps/console/specs/provider-key-exposure.spec.ts',
    'The spec driving that checker. Names the key in its expected-reader assertions and in the list of env names the pattern must match. A guard, not a flow.',
  ],
])

/** Tracked files naming the env var at all, build output excluded. */
function filesNamingTheKey(): string[] {
  const tracked = execSync('git ls-files', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((path) => !path.includes('/build/'))
  return tracked.filter((path) => {
    try {
      return readFileSync(join(REPO_ROOT, path), 'utf8').includes(
        'ANTHROPIC_API_KEY',
      )
    } catch {
      // Binary or unreadable — it is not source that reads an env var.
      return false
    }
  })
}

describe('the Assist flag carries its own legal precondition (AGL-1909)', () => {
  const assist = RELEASE_FLAGS.find((flag) => flag.key === 'release_assist')

  it('is still OFF by default', () => {
    // Flipping the default in code — as opposed to per-org in the staff
    // console, which is the reviewable path — must be a failing test rather
    // than a quiet deploy.
    expect(assist).toBeTruthy()
    expect(assist?.defaultEnabled).toBe(false)
  })

  it('names BOTH published artifacts that gate it, and names Anthropic', () => {
    // The precondition has to travel with the flag: this description is what
    // a staff user reads in the flags admin at the moment they decide to
    // flip it. AGL-1909 exists because the same precondition, written on a
    // checklist line already ticked Done, read as satisfied.
    const description = String(assist?.description ?? '')
    expect(description).toContain('/legal/subprocessors')
    expect(description).toContain('Anthropic')
    expect(description).toMatch(/privacy/i)
    expect(description).toContain('AGL-1909')
  })

  it('is seeded OFF in the Remote Config template too', () => {
    // `defaultEnabled` above is only the fallback for an unreachable Remote
    // Config. THIS file is what gets deployed and what actually decides the
    // flag in production, so a guard that watched only the TypeScript
    // constant would pass while the deployed template said `true` — and the
    // constant's own doc comment requires the two to agree.
    const template = JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'cloud/firebase-remoteconfig.template.json'),
        'utf8',
      ),
    )
    const seeded = template.parameters?.release_assist
    expect(JSON.parse(seeded.defaultValue.value)).toMatchObject({
      enabled: false,
    })
    // And the precondition travels with it here as well: this description is
    // what a staff user sees in the Firebase console.
    expect(seeded.description).toContain('/legal/subprocessors')
    expect(seeded.description).toContain('ANTHROPIC_API_KEY')
    expect(seeded.description).toContain('AGL-1909')
  })

  it('says the KEY is the trigger, not the flag', () => {
    // The correction to the issue's own premise. A reader who takes the flag
    // for the gate will set the key first and publish second, which is the
    // exact ordering AGL-1909 exists to prevent.
    expect(String(assist?.description ?? '')).toContain('ANTHROPIC_API_KEY')
  })
})

describe('every Anthropic data flow is a known one (AGL-1909)', () => {
  it('has exactly the expected files reading ANTHROPIC_API_KEY', () => {
    // The guard that can catch a flow nobody declared. A new reader is a new
    // customer-content path to Anthropic, and it fails here until someone
    // has checked the published subprocessor page against reality.
    const readers = filesNamingTheKey().filter(
      (path) => !MENTIONS_ONLY.has(path),
    )
    expect(readers.sort()).toEqual([...KEY_READERS.keys()].sort())
  })

  it('keeps the mentions-only list honest', () => {
    // Without this, a stale exemption silently widens what is allowed: a file
    // that stopped naming the key at all would keep excusing a future one
    // that does. Same staleness check the naming sweep uses.
    const naming = new Set(filesNamingTheKey())
    for (const path of MENTIONS_ONLY.keys()) {
      expect([path, naming.has(path)]).toEqual([path, true])
    }
  })

  it('has exactly the expected doors calling the AI runtime', () => {
    // The adapter is the only key reader, so a new customer-content path is a
    // new CALLER of the runtime rather than a new reader of the key. Specs
    // drive the runtime with doubles and are not doors.
    const tracked = execSync('git ls-files libs apps', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((path) => /\.(ts|tsx)$/.test(path) && !/\.spec\.tsx?$/.test(path))
    const callers = tracked.filter(
      (path) =>
        path !== 'libs/plugins/ai/src/lib/runtime/ai-runtime.ts' &&
        /\brunAiRequest\(/.test(readFileSync(join(REPO_ROOT, path), 'utf8')),
    )
    expect(callers.sort()).toEqual([...AI_DOORS.keys()].sort())
  })

  it('records the besigner assistant as unflagged, so nobody re-derives it', () => {
    const besigner = AI_DOORS.get('libs/plugins/ai/src/lib/server/ai-assist.ts')
    expect(besigner).toContain('NO release flag')
    // And the claim is checked against the source, not just asserted about
    // the comment: the handler is registered with no flag around it.
    const server = readFileSync(
      join(REPO_ROOT, 'libs/plugins/ai/src/lib/server.ts'),
      'utf8',
    )
    expect(server).toContain("registerPluginApiRoute('ai/assist', aiAssistHandler)")
    const handler = readFileSync(
      join(REPO_ROOT, 'libs/plugins/ai/src/lib/server/ai-assist.ts'),
      'utf8',
    )
    expect(handler).not.toMatch(/isServerReleaseFlagOnForOrg|release_/)
  })
})
