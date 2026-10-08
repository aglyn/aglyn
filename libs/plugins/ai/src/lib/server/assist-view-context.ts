/**
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

import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  ASSIST_EDIT_ACTION_ID,
  ASSIST_EDIT_DOCUMENT_KINDS,
  ASSIST_EDIT_TOOL_NAME,
  type AssistEditDocumentKind,
} from '../model/assist-edit'
import {
  ASSIST_OPEN_DRAFT_ACTION_ID,
  ASSIST_OPEN_DRAFT_PARAM,
  type AssistBuildDraft,
} from '../model/assist-follow-up'

/**
 * Aglyn Assist level 2 — the GUIDE capability (AGL-1988, under AGL-1860).
 *
 * Level 1 answers from the docs. Level 2 answers about **the thing in front
 * of the user**: the console screen they are standing on. This module is the
 * whole of that knowledge, and three decisions shape it.
 *
 * ## 1. A curated descriptor, not a state dump
 *
 * The tempting design is to serialise the page — props, records, the loaded
 * list — into the prompt. That buys worse answers at higher cost: the model
 * gets rows when what it needs is *what this screen is for*, and every extra
 * token is billed per turn against a hard margin constraint.
 *
 * So the view block is assembled from a STATIC, in-repo table keyed by route
 * pattern, plus a fixed handful of scalars about the current org. Nothing is
 * read out of the customer's data to build it. That is also why the privacy
 * guard is cheap to state and cheap to prove: there is no path from a
 * Firestore document to this prompt except the two fields `safeOrgFacts`
 * names, and no path from client input except three sanitised strings.
 *
 * ## 2. One answer for both ends of the ICP range
 *
 * the requirement is a single feature that is "easy for someone who
 * doesn't know code and even easier for someone who does". Two modes would
 * be the obvious build and the wrong one — it makes the beginner choose a
 * label for themselves before they have a question, and it makes the
 * developer opt in to being taken seriously.
 *
 * Progressive disclosure instead: every view carries a `plain` layer (what
 * you can do here, in words a first-business owner reads) and a `technical`
 * layer (the route template, the ids in the path, the API or field names
 * behind it). The model leads with plain and appends the technical layer
 * under a fixed `Under the hood:` marker, which the panel renders collapsed.
 * Same answer, two depths, one message.
 *
 * ## 3. Actions are PROPOSALS, and a proposal cannot write
 *
 * "Automate current view" is level 2's edge and needs a hard boundary — the
 * AGL-1860 ladder puts acting in the besigner at level 3, after launch. The
 * boundary here is structural rather than behavioural, because a rule the
 * model is asked to follow is not a boundary:
 *
 *   - An action descriptor has no field that could carry a write. There is no
 *     method, no body, no endpoint — only a `route` template and the NAMES of
 *     params. `assertInertActions()` proves that over the live table.
 *   - The model never supplies a destination. It may name an `id` from the
 *     closed set attached to the view it is already on, and supply values for
 *     params that view declared. `resolveAssistProposal` builds the href from
 *     the registry; an unknown id, a foreign id, or an undeclared param is
 *     dropped rather than honoured.
 *   - Confirming NAVIGATES. The destination form's own submit button, with
 *     its own permission checks, stays the only thing that writes.
 *
 * `prefill` is deliberately `false` across the table today: no console page
 * reads `assist_*` search params yet, and a card that claims "I filled that
 * in for you" over a form that came up empty is worse than one that names the
 * values to type. The plumbing is here so switching a page on is a one-line
 * change, and `PREFILL_READY_ROUTES` is the allowlist that has to grow first.
 *
 * ## 4. The one action that edits, and where it opens (AGL-2906)
 *
 * Level 3 makes a single exception, on the besigner only: the `edit` action.
 * The server still writes nothing. The model proposes typed canvas operations
 * through a strict tool, the server validates them against the canvas the
 * request described, and the panel shows the change and applies it in the
 * author's own editor when they press Apply — an unsaved change, undone by
 * the editor's own undo. The rung is closed unless the org carries
 * `aiGenerative`, `release_ai_generative` is on for it and the caller holds
 * `ai.generate`. `offeredActions` hands an edit action only to a request that
 * cleared the rung, and `assertInertActions` fails any edit action offered
 * without it, or one that carries a destination the way a navigation does.
 */

/**
 * One thing the assistant may PROPOSE from a given view, by navigating.
 *
 * Note what this interface cannot express. There is no `method`, no `body`,
 * no `endpoint`, no `submit` — a descriptor is a signpost, and the type is
 * the first line of the write boundary. Adding any of those fields would
 * break `assertInertActions()`, which is the point of writing it down.
 */
export interface AssistNavigateAction {
  /** `navigate`, or absent. */
  kind?: 'navigate'
  /** Stable id; the ONLY thing the model gets to choose from. */
  id: string
  /** Beginner-facing label on the confirm card. */
  label: string
  /** What the user will be looking at once they confirm. */
  outcome: string
  /**
   * Server-owned destination template (`/[orgSlug]/…`). Built here, never
   * supplied by the model — so the worst a bad completion can do is send the
   * user to a different page in their own console.
   */
  route: string
  /** Param names the model may supply values for. Anything else is dropped. */
  params: readonly string[]
  /**
   * Whether the destination actually reads `assist_*` search params. False
   * everywhere today — see the module header. When false the values are
   * shown on the card as "use these" rather than pushed into the URL.
   */
  prefill: boolean
}

/**
 * The besigner's edit action (AGL-2906). Its proposal is typed canvas
 * operations the panel applies on confirm — never a destination and never a
 * server write — so it carries none of a navigation's `route`, `params` or
 * `prefill`, and `assertInertActions` fails one that does.
 */
export interface AssistEditAction {
  kind: 'edit'
  /** Stable id; the ONLY thing the model gets to choose from. */
  id: string
  /** Beginner-facing label on the confirm button. */
  label: string
  /** What changes once the author confirms. */
  outcome: string
  /** The besigner documents the action opens on. */
  documents: readonly AssistEditDocumentKind[]
}

export type AssistViewAction = AssistNavigateAction | AssistEditAction

/** What a request cleared, which decides the actions a view offers it. */
export interface AssistActionRung {
  /**
   * The edit rung: `aiGenerative`, `release_ai_generative` and `ai.generate`,
   * on a versioned besigner route, with the canvas described.
   */
  edit: boolean
}

/** A console screen, described for the assistant rather than for a router. */
export interface AssistView {
  /** Registry key; also the analytics/debug handle. */
  key: string
  /** Route matcher. First match wins, so the table is ordered specific-first. */
  match: RegExp
  /** One line: what this screen is. */
  screen: string
  /** The beginner layer — what a person can do here, in plain words. */
  plain: readonly string[]
  /** The developer layer — route template, path ids, API surface. */
  technical: readonly string[]
  /** Proposals available from this view: navigations, and on the besigner the edit action. */
  actions: readonly AssistViewAction[]
}

/**
 * Destinations verified to read `assist_*` search params. EMPTY on purpose:
 * `assertInertActions()` fails any action with `prefill: true` whose route is
 * not listed, so turning prefill on requires wiring the page first rather
 * than remembering to.
 */
export const PREFILL_READY_ROUTES: readonly string[] = []

/** Query-param prefix for proposed values. Namespaced so a page opting in
 * can never confuse an assistant suggestion with its own state. */
export const ASSIST_PREFILL_PREFIX = 'assist_'

const orgAction = (
  id: string,
  label: string,
  outcome: string,
  route: string,
  params: readonly string[] = [],
): AssistNavigateAction => ({ id, label, outcome, route, params, prefill: false })

const isNavigateAction = (action: AssistViewAction): action is AssistNavigateAction =>
  action.kind !== 'edit'

/**
 * The registry. Ordered specific-first — `describeView` takes the first
 * match, so a host sub-page must precede the host dashboard, and every
 * host route must precede the bare `/[orgSlug]` home.
 *
 * Content rule: every line here has to be TRUE of the shipped console. These
 * strings are asserted to the model as fact and it will repeat them, so a
 * guessed button label becomes a confidently wrong instruction. Where the
 * exact affordance is uncertain the line names the SCREEN and its purpose
 * and lets docs retrieval supply the steps — a vaguer sentence that is right
 * beats a specific one that is invented.
 */
export const ASSIST_VIEWS: readonly AssistView[] = [
  {
    key: 'besigner',
    match: /^\/[^/]+\/hosts\/[^/]+\/(screens|components|templates|layouts|emails)\/.*\/besigner$/,
    screen: 'The Besigner — the visual editor for a page, component, template, layout or email.',
    plain: [
      'Edit the page visually: pick an element on the canvas and change its text, styling and layout.',
      'Work is saved to a draft version; publishing is a separate, deliberate step.',
      'Preview shows the draft as a visitor would see it, without publishing.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner (and the component, template, layout and email variants).',
      'Editing writes to the version named in the path — versioning is the undo, so a save never overwrites what is live.',
      'The preview route is the same path with /preview in place of /besigner.',
    ],
    actions: [
      {
        kind: 'edit',
        id: ASSIST_EDIT_ACTION_ID,
        label: 'Apply as draft',
        outcome: 'the proposed changes on the open canvas, unsaved until the document is saved',
        documents: ASSIST_EDIT_DOCUMENT_KINDS,
      },
    ],
  },
  {
    key: 'host-screens',
    match: /^\/[^/]+\/hosts\/[^/]+\/screens(\/|$)/,
    screen: 'Pages — the list of pages on this site.',
    plain: [
      'Every page a visitor can reach is listed here.',
      'Open a page to see its versions, then open the Besigner to edit it.',
      'Publishing a page version is what puts a change on the live site.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/screens; detail is .../screens/[screenId]/versions/[versionId]/view.',
      '[host] in the path is the site (host) document id, not the domain name.',
    ],
    actions: [
      orgAction(
        'open.host.screens',
        'Open Pages',
        'the list of pages on this site',
        '/[orgSlug]/hosts/[host]/screens',
      ),
    ],
  },
  {
    key: 'host-theme',
    match: /^\/[^/]+\/hosts\/[^/]+\/theme(\/|$)/,
    screen: 'Theme — the site-wide colors, type and spacing every page inherits.',
    plain: [
      'Change something here and it changes everywhere on the site at once.',
      'This is the place to fix a color or a font you keep re-setting on individual elements.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/theme.',
      'Theme values resolve at render time, so pages pick them up without being republished individually.',
    ],
    actions: [],
  },
  {
    // The key is the analytics/debug handle and stays as it is; the section
    // it names is what was renamed. Both addresses match because the console
    // redirects the older one, so a client can report either.
    key: 'host-workflows',
    match: /^\/[^/]+\/hosts\/[^/]+\/(automation|workflows)(\/|$)/,
    screen:
      'Automation — workflows, actions and webhooks that run when something happens on the site.',
    plain: [
      'A workflow is a trigger plus the actions that follow it, such as sending an email when a form is submitted.',
      'Build the trigger first, then add the actions it should run.',
      'Workflows, Actions and Webhooks are the three sections of this page, in the rail beside it.',
      'Create with AI, beside Add action and at the top of Workflows, drafts an automation from a description; it arrives switched off for you to review.',
      'In a saved action’s editor, Explain it says what it does, and Change with AI or Fix with AI writes a changed copy, switched off, beside the original. A failed run in the Runs log has Why did this fail?.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/automation/workflows, /automation/actions or /automation/webhooks.',
      'Webhook actions let a workflow call an external endpoint; see the automation docs for the payload shape.',
      'Each action is one document stored with the site; every run is a row in the site’s activity log.',
    ],
    actions: [
      orgAction(
        'open.host.automation.actions',
        'Open Actions',
        'this site’s actions, where Create with AI drafts a new one',
        '/[orgSlug]/hosts/[host]/automation/actions',
      ),
      orgAction(
        'open.host.automation.workflows',
        'Open Workflows',
        'this site’s workflows',
        '/[orgSlug]/hosts/[host]/automation/workflows',
      ),
    ],
  },
  // CRM, Logic, Forms and Emails (AGL-3603), each ahead of the site
  // dashboard that would otherwise take them.
  {
    key: 'host-crm',
    match: /^\/[^/]+\/hosts\/[^/]+\/crm(\/|$)/,
    screen: 'CRM — the contacts, leads, companies, deals and tasks this site works with.',
    plain: [
      'The sections are Contacts, Leads, Companies, Deals, Tasks, Reports, Fields and Settings, in the rail beside the page.',
      'Records belong to the workspace; a site lists the ones shared with it.',
      'On a contact’s, company’s, deal’s or lead’s page, AI can summarize where things stand and suggest a next step; nothing is saved until you save it.',
      'In the email composer on a record, Draft the message writes a one-to-one email from what you describe. AI never sends it: you do.',
      'Reports shows the pipeline and where people came from; Ask about your numbers in the Assist panel answers questions about those figures.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/crm/[section], with sections contacts, leads, companies, deals, tasks, reports, fields and settings.',
      'Records are stored with the organization, one collection per record type, and are shared with a site through their visibleTo scope.',
      'The CRM is included from the Starter plan; on a plan without it every section shows the upgrade notice.',
    ],
    actions: [
      orgAction('open.host.crm.contacts', 'Open Contacts', 'the contacts shared with this site', '/[orgSlug]/hosts/[host]/crm/contacts'),
      orgAction('open.host.crm.deals', 'Open Deals', 'the deals shared with this site, by stage', '/[orgSlug]/hosts/[host]/crm/deals'),
      orgAction('open.host.crm.reports', 'Open CRM reports', 'this site’s pipeline and lead source figures', '/[orgSlug]/hosts/[host]/crm/reports'),
    ],
  },
  {
    key: 'host-logic',
    match: /^\/[^/]+\/hosts\/[^/]+\/logic(\/|$)/,
    screen: 'Logic — the site’s functions and variables, and the health of the references that use them.',
    plain: [
      'A variable holds a value pages and functions read by name; a function works something out from what it is given.',
      'Create with AI at the top of the Functions or Variables card writes one from a description and opens it in the editor, unsaved.',
      'In a saved function’s editor, Explain it, Change with AI and Fix with AI work on the function as it is saved; a change is put in the editor, unsaved.',
      'Reference health lists references that point at something the site no longer has; one an automation holds offers Fix with AI, which writes a fixed copy of the automation, switched off.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/logic.',
      'Functions run in the editor’s own evaluator: arithmetic, the listed built-ins, the function’s parameters and locals, and the site’s variables by name.',
    ],
    actions: [
      orgAction('open.host.logic', 'Open Logic', 'this site’s functions and variables', '/[orgSlug]/hosts/[host]/logic'),
    ],
  },
  {
    key: 'host-forms',
    match: /^\/[^/]+\/hosts\/[^/]+\/forms(\/|$)/,
    screen: 'Forms — the saved forms on this site and what visitors sent through them.',
    plain: [
      'Create Form starts an empty form; Create with AI, beside it, plans a form from a description and builds it as a draft once you confirm the plan.',
      'Open a form to see its submissions. Every submission also lands in the Inbox.',
      'A form shows on the live site only once a page places it.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/forms; one form is /[orgSlug]/hosts/[host]/forms/[formId].',
      'Forms are documents at hosts/[host]/forms/[formId], counted against the plan’s saved forms per site.',
    ],
    actions: [
      orgAction('open.host.forms', 'Open Forms', 'the saved forms on this site', '/[orgSlug]/hosts/[host]/forms'),
    ],
  },
  {
    key: 'host-emails',
    match: /^\/[^/]+\/hosts\/[^/]+\/emails(\/|$)/,
    screen: 'Emails — the messages this site sends, the templates they are built from, and who they reach.',
    plain: [
      'The sections are Messages, Templates, Audiences, Topics, Sending, Consent groups and Suppressions, in the rail beside the page.',
      'Messages lists every email sent or scheduled, each with its own report. A campaign that groups messages lives under Marketing.',
      'Audiences are the lists you send to; Suppressions are the addresses a send skips; Topics are the streams a recipient can leave one at a time.',
      'Sending sets the name and address the mail comes from.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/emails/[section], with sections messages, templates, audiences, topics, sending, consent-groups and suppressions.',
      'Templates are Besigner documents, edited at .../emails/[templateKey]/versions/[versionId]/besigner.',
      'The workspace-wide view is /[orgSlug]/emails.',
    ],
    actions: [
      orgAction('open.host.emails.messages', 'Open Messages', 'the emails this site sent or scheduled', '/[orgSlug]/hosts/[host]/emails/messages'),
      orgAction('open.host.emails.audiences', 'Open Audiences', 'the lists this site sends to', '/[orgSlug]/hosts/[host]/emails/audiences'),
    ],
  },
  {
    key: 'host-products',
    match: /^\/[^/]+\/hosts\/[^/]+\/products(\/|$)/,
    screen: 'Products — the commerce catalog for this site.',
    plain: [
      'Add and edit the things this site sells, including price and availability.',
      'A product has to exist here before a page can put it in front of a buyer.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/products.',
      'Catalog data is site-scoped: products belong to [host], not to the workspace.',
    ],
    actions: [],
  },
  {
    key: 'host-redirects',
    match: /^\/[^/]+\/hosts\/[^/]+\/redirects(\/|$)/,
    screen: 'Redirects — rules that send one path on this site to another.',
    plain: [
      'Use a redirect when a page has moved, so an old link still lands somewhere useful.',
      'Each rule is a path to match and a destination to send it to.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/redirects.',
      'Rules are evaluated by the tenant runtime on the request path, before the page is resolved.',
    ],
    actions: [
      orgAction(
        'open.host.redirects',
        'Open Redirects',
        'the redirect rules for this site',
        '/[orgSlug]/hosts/[host]/redirects',
        ['source', 'target'],
      ),
    ],
  },
  {
    key: 'host-analytics',
    match: /^\/[^/]+\/hosts\/[^/]+\/analytics(\/|$)/,
    screen: 'Analytics — traffic and visitor figures for this site.',
    plain: [
      'See how many people visited, and which pages they landed on.',
      'Figures cover the live site only — drafts and previews are not counted.',
    ],
    technical: ['Route: /[orgSlug]/hosts/[host]/analytics.'],
    actions: [],
  },
  // The Marketing hub's sections (AGL-3603), one view each, ahead of the site
  // dashboard that would otherwise take them.
  {
    key: 'host-marketing-campaigns',
    match: /^\/[^/]+\/hosts\/[^/]+\/marketing\/campaigns(\/|$)/,
    screen: 'Marketing → Campaigns — the email campaigns sent from this site.',
    plain: [
      'A campaign groups the emails you send to a set of lists over a window of dates.',
      'Create campaign starts an empty one. Create with AI writes an email design and a draft campaign from a brief; it is sent to nobody until you pick its lists and schedule it.',
      'Open a campaign to see its report: delivery, opens, clicks, conversions and revenue, each with the population it is measured against.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/marketing/campaigns; one campaign is .../marketing/campaigns/[campaignId].',
      'Campaigns and their sends are stored with the organization; a site lists the ones placed on it.',
    ],
    actions: [
      orgAction(
        'open.host.marketing.campaigns',
        'Open Campaigns',
        'the campaigns sent from this site',
        '/[orgSlug]/hosts/[host]/marketing/campaigns',
      ),
    ],
  },
  {
    key: 'host-marketing-overlays',
    match: /^\/[^/]+\/hosts\/[^/]+\/marketing\/overlays(\/|$)/,
    screen: 'Marketing → Overlays — the announcement bars and popups shown on this site.',
    plain: [
      'Each bar or popup has its own schedule, the pages it shows on, and an on-switch.',
      'When several match a page, the first bar and the first popup in the list show; the arrows change the order.',
      'Create with AI writes a new bar or popup and saves it switched off; Write with AI in the editor fills its copy, unsaved until you save.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/marketing/overlays.',
      'Each overlay is one document stored with the site, gated by the marketingOverlays plan entitlement.',
    ],
    actions: [
      orgAction(
        'open.host.marketing.overlays',
        'Open Overlays',
        'the announcement bars and popups on this site',
        '/[orgSlug]/hosts/[host]/marketing/overlays',
      ),
    ],
  },
  {
    key: 'host-marketing-conversions',
    match: /^\/[^/]+\/hosts\/[^/]+\/marketing\/conversions(\/|$)/,
    screen: 'Marketing → Conversions — what this site’s campaigns caused.',
    plain: [
      'Form submissions, leads, contacts and bookings credited to a campaign, one kind at a time.',
      'The kinds are never added together: one visit can make a submission, a lead and a contact.',
      'Ask AI about these numbers explains the figures in words, citing the rows each number comes from.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/marketing/conversions; .../conversions/[campaignId] narrows the list to one campaign.',
      'Each credit is a record in hosts/[host]/campaignAttributions, keyed by kind and the record it credits.',
    ],
    actions: [
      orgAction(
        'open.host.marketing.conversions',
        'Open Conversions',
        'the conversions this site’s campaigns were credited with',
        '/[orgSlug]/hosts/[host]/marketing/conversions',
      ),
    ],
  },
  {
    key: 'host-marketing-experiments',
    match: /^\/[^/]+\/hosts\/[^/]+\/marketing\/experiments(\/|$)/,
    screen: 'Marketing → A/B testing — the experiments running on this site.',
    plain: [
      'An A/B test shows each visitor one of up to four variants of a page, a section or an email, and counts conversions for each.',
      'Write variants with AI sits in a test’s editor, and Explain this result with AI below its results.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/marketing/experiments.',
      'Each experiment is one document stored with the site, gated by the abTesting plan entitlement.',
    ],
    actions: [
      orgAction(
        'open.host.marketing.experiments',
        'Open A/B testing',
        'the A/B tests on this site',
        '/[orgSlug]/hosts/[host]/marketing/experiments',
      ),
    ],
  },
  {
    key: 'host-marketing',
    match: /^\/[^/]+\/hosts\/[^/]+\/marketing(\/|$)/,
    screen: 'Marketing — this site’s campaigns, conversions, overlays and A/B tests.',
    plain: [
      'The sections are Overview, Campaigns, Conversions, Overlays and A/B testing, in the rail beside the page.',
      'Campaigns are shared with the rest of the workspace; overlays, A/B tests and conversions are this site’s own.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/marketing, with each section a route beneath it.',
      'The workspace-wide view is /[orgSlug]/marketing.',
    ],
    actions: [
      orgAction(
        'open.host.marketing',
        'Open Marketing',
        'this site’s Marketing page, on its first section',
        '/[orgSlug]/hosts/[host]/marketing',
      ),
    ],
  },
  {
    key: 'host-setup',
    match: /^\/[^/]+\/hosts\/[^/]+\/setup(\/|$)/,
    screen: 'Site setup — the site’s own settings, including its domain.',
    plain: [
      'Connecting a custom domain starts here.',
      'A domain change needs DNS records at whoever the domain is registered with; the console shows which ones.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/setup.',
      'Owner/admin-only controls live on the sibling /admin page rather than here, so collaborators can use Setup safely.',
    ],
    actions: [
      orgAction(
        'open.host.setup',
        'Open site setup',
        'this site’s settings, where a custom domain is connected',
        '/[orgSlug]/hosts/[host]/setup',
        ['domain'],
      ),
    ],
  },
  {
    key: 'host-data',
    match: /^\/[^/]+\/hosts\/[^/]+\/data(\/|$)/,
    screen: 'Site data — the datasets this site reads and writes.',
    plain: [
      'A dataset is a structured list — products, posts, submissions — that pages can display.',
      'Define the fields first; pages bind to them afterwards.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/data. The workspace-wide view is /[orgSlug]/data.',
    ],
    actions: [],
  },
  {
    key: 'host-dashboard',
    match: /^\/[^/]+\/hosts\/[^/]+(\/|$)/,
    screen: 'Site dashboard — the home page for one site in this workspace.',
    plain: [
      'Everything about one site hangs off this dashboard: its pages, theme, data, commerce and settings.',
      'A workspace can hold several sites; this is one of them.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]. The [host] segment is the site document id.',
    ],
    actions: [],
  },
  {
    key: 'org-hosts',
    match: /^\/[^/]+\/hosts(\/|$)/,
    screen: 'Sites — every site in this workspace.',
    plain: [
      'Each row is a site with its own pages, theme and domain.',
      'Agencies typically run one site per client from here.',
    ],
    technical: ['Route: /[orgSlug]/hosts.'],
    actions: [
      orgAction(
        'open.org.hosts',
        'Open Sites',
        'every site in this workspace',
        '/[orgSlug]/hosts',
      ),
    ],
  },
  {
    key: 'org-marketing',
    match: /^\/[^/]+\/marketing(\/|$)/,
    screen: 'Marketing — campaigns, conversions, overlays and A/B tests across every site in this workspace.',
    plain: [
      'The same sections as a site’s Marketing page, each answering for every site at once.',
      'Campaigns belong to the workspace; overlays, A/B tests and conversions are each one site’s, so editing them happens on that site.',
    ],
    technical: [
      'Route: /[orgSlug]/marketing, with /campaigns, /conversions, /overlays and /experiments beneath it.',
      'A site’s own hub is /[orgSlug]/hosts/[host]/marketing.',
    ],
    actions: [
      orgAction(
        'open.org.marketing.campaigns',
        'Open Campaigns',
        'every campaign in this workspace',
        '/[orgSlug]/marketing/campaigns',
      ),
      orgAction(
        'open.org.marketing.conversions',
        'Open Conversions',
        'the conversions credited to campaigns, one site at a time',
        '/[orgSlug]/marketing/conversions',
      ),
    ],
  },
  {
    key: 'org-billing',
    match: /^\/[^/]+\/billing(\/|$)/,
    screen: 'Billing & plans — the workspace subscription, plan and invoices.',
    plain: [
      'The current plan and what it includes, and where to change it.',
      'Plan limits that stop you elsewhere in the console are set here.',
    ],
    technical: [
      'Route: /[orgSlug]/billing.',
      'Entitlements are resolved from the org plan; a limit reached elsewhere reports the entitlement it needs.',
    ],
    actions: [
      orgAction(
        'open.billing',
        'Open Billing & plans',
        'the plan for this workspace and how to change it',
        '/[orgSlug]/billing',
      ),
    ],
  },
  {
    key: 'org-team',
    match: /^\/[^/]+\/team(\/|$)/,
    screen: 'Team — the people in this workspace and what each may do.',
    plain: [
      'Invite a teammate by email, and choose the role that decides what they can reach.',
      'Removing someone here removes their access to every site in the workspace.',
    ],
    technical: [
      'Route: /[orgSlug]/team; one member is /[orgSlug]/team/[uid].',
      'Seat counts follow the plan, so an invite can be refused by the billing entitlement rather than by permissions.',
    ],
    actions: [
      orgAction(
        'open.team',
        'Open Team',
        'the members of this workspace, where invites are sent',
        '/[orgSlug]/team',
        ['email', 'role'],
      ),
    ],
  },
  {
    key: 'org-data',
    match: /^\/[^/]+\/data(\/|$)/,
    screen: 'Data — datasets shared across the whole workspace.',
    plain: [
      'Structured lists defined once here can be used by any site in the workspace.',
      'If a list only belongs to one site, define it on that site’s own Data page instead.',
      'Define the fields before building the page that displays them — pages bind to fields that already exist.',
    ],
    technical: [
      'Route: /[orgSlug]/data. The per-site view is /[orgSlug]/hosts/[host]/data.',
      'Workspace datasets are visible to every site in the workspace, so a field change here reaches all of them.',
    ],
    actions: [
      orgAction(
        'open.org.data',
        'Open Data',
        'the datasets shared across this workspace',
        '/[orgSlug]/data',
      ),
    ],
  },
  {
    key: 'org-automation',
    match: /^\/[^/]+\/automation(\/|$)/,
    screen: 'Automation — org automations, written once and placed on the sites you choose, and every site’s workflows, actions and webhooks.',
    plain: [
      'An org automation starts on something the server sees — a form, a lead, a booking, a member or a CRM event — and runs on each site it is placed on, as that site.',
      'Each site can pause an org automation for itself without changing it for the others.',
      'Create with AI in the Org automations card’s header drafts one from a description and opens it in the editor, switched off and unsaved, for you to place on sites and save.',
      'A site’s own actions, workflows and webhooks are built on that site’s Automation page.',
    ],
    technical: [
      'Route: /[orgSlug]/automation/automations, with /workflows, /actions and /webhooks beside it.',
      'Org automations are documents at orgs/[orgId]/automations/[automationId], written only through the plugin’s save route and gated by the actions plan entitlement.',
    ],
    actions: [
      orgAction('open.org.automation', 'Open org automations', 'the automations this workspace places on its sites', '/[orgSlug]/automation/automations'),
    ],
  },
  {
    key: 'org-crm',
    match: /^\/[^/]+\/crm(\/|$)/,
    screen: 'CRM — the contacts, leads, companies, deals and tasks of every site in this workspace.',
    plain: [
      'The same sections as a site’s CRM, each answering for every site at once.',
      'Reports totals the pipeline across every site; Ask about your numbers in the Assist panel answers questions about the pipeline and the deals closed.',
      'Record summaries and Draft the message work here as they do on a site.',
    ],
    technical: [
      'Route: /[orgSlug]/crm/[section]. A site’s own hub is /[orgSlug]/hosts/[host]/crm.',
      'Records live under orgs/[orgId]; the workspace view reads every one, a site’s view only those shared with it.',
    ],
    actions: [
      orgAction('open.org.crm.contacts', 'Open Contacts', 'every contact in this workspace', '/[orgSlug]/crm/contacts'),
      orgAction('open.org.crm.reports', 'Open CRM reports', 'the pipeline across every site', '/[orgSlug]/crm/reports'),
    ],
  },
  {
    key: 'org-emails',
    match: /^\/[^/]+\/emails(\/|$)/,
    screen: 'Emails — the messages, templates and audiences of every site in this workspace.',
    plain: [
      'The same sections as a site’s Emails page, each answering for every site; audiences and topics belong to the workspace.',
      'Consent groups decide which sites share a signup, an unsubscribe and a CRM record.',
    ],
    technical: [
      'Route: /[orgSlug]/emails/[section]. A site’s own page is /[orgSlug]/hosts/[host]/emails.',
    ],
    actions: [
      orgAction('open.org.emails.messages', 'Open Messages', 'every email this workspace sent or scheduled', '/[orgSlug]/emails/messages'),
    ],
  },
  {
    key: 'org-media',
    match: /^\/[^/]+\/media(\/|$)/,
    screen: 'Media — images and files for this workspace.',
    plain: [
      'Upload once here and use the file on any site in the workspace.',
      'If the file belongs to one site only, upload it on that site’s own Media page instead.',
      'Files are referenced by the pages that use them, so replacing a file changes it everywhere it appears.',
    ],
    technical: [
      'Route: /[orgSlug]/media. The per-site library is /[orgSlug]/hosts/[host]/media.',
      'Workspace media is shared across every site in the workspace; site media is scoped to that site.',
    ],
    actions: [
      orgAction(
        'open.org.media',
        'Open Media',
        'the images and files shared across this workspace',
        '/[orgSlug]/media',
      ),
    ],
  },
  {
    key: 'org-plugins',
    match: /^\/[^/]+\/plugins(\/|$)/,
    screen: 'Plugins — what is installed in this workspace.',
    plain: [
      'A plugin adds a feature to the console, to your sites, or to both.',
      'Open one to see its settings and the permissions it was granted.',
    ],
    technical: [
      'Route: /[orgSlug]/plugins; one install is /[orgSlug]/plugins/[pluginRef].',
      'Plugins run inside a sandbox; the permissions listed on the install page are the boundary.',
    ],
    actions: [],
  },
  {
    key: 'org-marketplace',
    match: /^\/[^/]+\/marketplace(\/|$)/,
    screen: 'Marketplace — plugins and items available to install.',
    plain: ['Browse what can be added, and install into this workspace.'],
    technical: [
      'Route: /[orgSlug]/marketplace; a listing is /[orgSlug]/marketplace/[listingId].',
      'Publishing your own plugin is /[orgSlug]/marketplace/publish/plugin.',
    ],
    actions: [],
  },
  {
    key: 'org-support',
    match: /^\/[^/]+\/support(\/|$)/,
    screen: 'Support — the channels for getting help.',
    plain: [
      'Raise a ticket, or ask in the forum.',
      'Which channels are available depends on the workspace plan.',
    ],
    technical: [
      'Route: /[orgSlug]/support, which forwards to the channel the plan makes primary.',
      'Channels are /[orgSlug]/support/tickets and /[orgSlug]/support/forum.',
    ],
    actions: [
      orgAction(
        'open.support',
        'Open Support',
        'the support channels for this workspace',
        '/[orgSlug]/support',
      ),
    ],
  },
  {
    key: 'org-settings',
    match: /^\/[^/]+\/settings(\/|$)/,
    screen: 'Workspace settings — the workspace’s own name, slug and options.',
    plain: ['Settings that apply to the whole workspace rather than to one site.'],
    technical: [
      'Route: /[orgSlug]/settings.',
      'The workspace slug is the [orgSlug] segment in every console URL, so changing it changes those links.',
    ],
    actions: [],
  },
  {
    key: 'org-home',
    match: /^\/[^/]+\/?$/,
    screen: 'Workspace home — the landing page for one workspace.',
    plain: [
      'The starting point for a workspace: its sites, and the workspace-wide areas beside them.',
    ],
    technical: ['Route: /[orgSlug].'],
    actions: [],
  },
]

/** The view the user is standing on, or null where the route is unknown. */
export function describeView(route: string): AssistView | null {
  const path = sanitiseRoute(route)
  if (!path) return null
  return ASSIST_VIEWS.find((view) => view.match.test(path)) ?? null
}

/**
 * The actions a view offers a request: every navigation, and the edit action
 * only to a request that cleared the edit rung.
 */
export function offeredActions(
  view: AssistView | null,
  rung: AssistActionRung,
): readonly AssistViewAction[] {
  if (!view) return []
  return view.actions.filter((action) => action.kind !== 'edit' || rung.edit)
}

/**
 * Client-supplied strings that end up inside a SYSTEM block have to be
 * treated as hostile, not merely untidy. `route` is whatever the panel says
 * the pathname is, and an attacker who can shape it can otherwise write
 * newlines, backticks and prose into the model's instructions — including a
 * forged action fence, which is the one construct in this feature the model
 * is told to treat as meaningful.
 *
 * So the allowed alphabet is exactly what a console path is made of. Anything
 * else is dropped rather than escaped: there is no legitimate route that
 * needs a backtick, and a sanitiser that tries to preserve intent is a
 * sanitiser with a bypass in it.
 */
export function sanitiseRoute(route: string): string {
  const cleaned = String(route ?? '')
    .replace(/[^A-Za-z0-9/_\-.[\]]/g, '')
    .slice(0, 200)
  return cleaned.startsWith('/') ? cleaned : ''
}

/**
 * Same reasoning as `sanitiseRoute`, for a Firestore-shaped document id.
 *
 * Rejects rather than truncates, which is the difference between refusing an
 * id and quietly pointing at a different one: `slice(0, 64)` on an over-long
 * value yields a well-formed id for some OTHER document, and this function's
 * output is substituted straight into a destination path.
 */
export function sanitiseId(value: string): string {
  const raw = String(value ?? '')
  return raw.length <= 64 && /^[A-Za-z0-9_-]+$/.test(raw) ? raw : ''
}

/**
 * The ONLY fields of the org document that may enter a prompt.
 *
 * An allowlist rather than a denylist, and stated as a literal rather than
 * derived, because the failure mode is silent: the org doc grows a field one
 * day — a Stripe customer id, an owner's email, a support note — and a
 * spread would carry it into a third party's API without anything failing.
 * Both fields named here are already on screen for any member who can open
 * the panel, so nothing is disclosed that the asker could not read anyway.
 *
 * The plan is the one the workspace resolves to, as the console's badges name
 * it (AGL-3034): a canceled subscription's stored plan grants nothing, and a
 * staff comp grants a plan the stored field may not name.
 */
export function safeOrgFacts(org: Record<string, unknown>): {
  name: string
  plan: string
} {
  return {
    name: String(org?.['name'] ?? '').slice(0, 120),
    plan: resolveEffectivePlan(org as never).slice(0, 40),
  }
}

/**
 * The per-VIEW system block — the screen description, and nothing about who
 * is looking at it.
 *
 * The split from `viewFactsBlock` is the whole caching design, and it was
 * not the first shape this took. Folding the workspace name, plan, slug and
 * host id in here reads more natural and quietly destroys the cache: a
 * prefix carrying the tenant's name is unique to that tenant, so on a
 * multi-tenant console every org warms its own copy and the entry is usually
 * cold when it matters. Derived purely from the route, the same block serves
 * every workspace asking anything on that screen — which on a shared console
 * is the difference between a cache that pays and one that mostly writes.
 *
 * So this block is a pure function of the registry and the rung — two
 * variants a route at most, neither carrying a tenant byte — and everything
 * that varies per request lives after the breakpoint.
 */
export function viewScreenBlock(
  view: AssistView | null,
  rung: AssistActionRung = { edit: false },
): string {
  const lines: string[] = []
  if (view) {
    lines.push(`This console page: ${view.screen}`)
    if (view.plain.length) {
      lines.push('What the user can do here:')
      for (const line of view.plain) lines.push(`- ${line}`)
    }
    if (view.technical.length) {
      lines.push('Technical detail for the "Under the hood" line:')
      for (const line of view.technical) lines.push(`- ${line}`)
    }
    const offered = offeredActions(view, rung)
    const navigations = offered.filter(isNavigateAction)
    if (navigations.length) {
      lines.push(
        'Actions you may PROPOSE from this console page (ids are exact; propose at most one, and only when the user asked to get something done):',
      )
      for (const action of navigations) {
        const params = action.params.length
          ? ` params: ${action.params.join(', ')}`
          : ' params: none'
        lines.push(`- id "${action.id}" — ${action.label}: opens ${action.outcome}.${params}`)
      }
    } else if (offered.length) {
      lines.push('This console page offers nothing to open. Do not emit an action block here.')
    } else {
      lines.push(
        'This console page offers no proposable actions. Do not emit an action block here.',
      )
    }
    for (const action of offered) {
      if (action.kind !== 'edit') continue
      lines.push(
        `Edits you may PROPOSE on this console page (id "${action.id}"): through the ${ASSIST_EDIT_TOOL_NAME} tool described below, never an action block.`,
      )
    }
  } else {
    lines.push(
      'This exact console page is not in the assistant’s index of console pages. Answer from the documentation and describe navigation in words rather than asserting what this page contains.',
      'Do not emit an action block.',
    )
  }
  return lines.join('\n')
}

/**
 * The per-REQUEST facts. Everything here varies by workspace or by page, so
 * it sits after the last cache breakpoint where it invalidates nothing.
 *
 * Only `safeOrgFacts`' two allowlisted fields and the three sanitised client
 * strings ever reach this — see the module header.
 */
export function viewFactsBlock(facts: {
  route: string
  hostId: string
  orgSlug: string
  name: string
  plan: string
}): string {
  const lines: string[] = ['Where the user is right now:']
  lines.push(`- Console page path: ${facts.route}`)
  if (facts.orgSlug) lines.push(`- Workspace URL slug: ${facts.orgSlug}`)
  if (facts.hostId) lines.push(`- Selected site (host) id: ${facts.hostId}`)
  if (facts.name) lines.push(`- Workspace name: ${facts.name}`)
  if (facts.plan) lines.push(`- Workspace plan: ${facts.plan}`)
  return lines.join('\n')
}

/* ------------------------------------------------------------------ *
 * The proposal channel
 * ------------------------------------------------------------------ */

/** Fence the model wraps a proposal in. Kept out of the visible answer. */
export const ASSIST_ACTION_FENCE = '```aglyn:action'

/**
 * How much of `raw` is safe to stream to the user.
 *
 * The proposal fence must never reach the panel as text — a user watching
 * raw JSON appear mid-answer reads it as the assistant breaking. Trimming
 * only at the end is not enough either, because by then the tokens have
 * already been emitted as deltas.
 *
 * So the visible prefix is recomputed on every delta, and the tail is held
 * back only while it could still turn out to be the start of a fence. That
 * matters for latency: holding a fixed window would delay every answer by
 * the fence's length, whereas this holds nothing back unless the text
 * genuinely ends in a backtick run.
 */
export function visibleAssistText(raw: string): string {
  const cut = raw.indexOf(ASSIST_ACTION_FENCE)
  if (cut >= 0) return raw.slice(0, cut)
  for (let n = Math.min(ASSIST_ACTION_FENCE.length - 1, raw.length); n > 0; n--) {
    if (ASSIST_ACTION_FENCE.startsWith(raw.slice(raw.length - n))) {
      return raw.slice(0, raw.length - n)
    }
  }
  return raw
}

/**
 * The visible answer once the stream has ENDED — no holdback.
 *
 * `visibleAssistText` withholds a tail that might still become a fence,
 * which is right mid-stream and wrong at the end: an answer that genuinely
 * closes on a code fence would otherwise lose its last three characters
 * permanently, both on screen and in the stored exchange. Once there are no
 * more deltas the ambiguity is resolved, so the only cut left is a real one.
 */
export function finalAssistText(raw: string): string {
  const cut = raw.indexOf(ASSIST_ACTION_FENCE)
  return cut >= 0 ? raw.slice(0, cut) : raw
}

/** The raw JSON body between the fences, if the model emitted one. */
export function extractAssistAction(raw: string): string | null {
  const start = raw.indexOf(ASSIST_ACTION_FENCE)
  if (start < 0) return null
  const bodyStart = start + ASSIST_ACTION_FENCE.length
  const end = raw.indexOf('```', bodyStart)
  const body = (end < 0 ? raw.slice(bodyStart) : raw.slice(bodyStart, end)).trim()
  return body || null
}

/**
 * The navigation to a draft a build in this chat made (AGL-3616), offered
 * beside the view's own when the request listed any. Its destination is the
 * site's Pages list, where every draft waits: the panel, which holds the
 * draft's own address, sends the person to that draft's Besigner instead and
 * asks the request again there. The server never builds an address from a
 * draft, so a ref cannot steer anyone anywhere the registry does not point.
 */
export const ASSIST_OPEN_DRAFT_ACTION: AssistNavigateAction = orgAction(
  ASSIST_OPEN_DRAFT_ACTION_ID,
  'Open the draft in the Besigner',
  'a draft this chat built, in the Besigner, where your request is asked again',
  '/[orgSlug]/hosts/[host]/screens',
  [ASSIST_OPEN_DRAFT_PARAM],
)

/** The view with the open-draft navigation added, where the request listed drafts. */
export function withAssistOpenDraftAction(
  view: AssistView | null,
  drafts: readonly AssistBuildDraft[],
): AssistView | null {
  if (!view || !drafts.length) return view
  return { ...view, actions: [...view.actions, ASSIST_OPEN_DRAFT_ACTION] }
}

/** A proposal that survived validation — inert, and safe to show. */
export interface AssistProposal {
  id: string
  label: string
  outcome: string
  /** Fully-resolved console path. Server-built; the model never sees it. */
  href: string
  /** Values the model suggested, in the order the action declared them. */
  values: ReadonlyArray<{ name: string; value: string }>
  /** Whether `href` carries the values, or the card must ask the user to type them. */
  prefill: boolean
  /**
   * For the open-draft navigation (AGL-3616): the ref of the draft to open,
   * one the request listed. The panel resolves it to the draft's Besigner
   * and asks the request again there.
   */
  draft?: AssistBuildDraft
}

const MAX_PARAM_VALUE_CHARS = 200

/**
 * Turn a model-emitted action block into a proposal, or nothing.
 *
 * Everything here is a narrowing. The id must be one the CURRENT view
 * offers as a navigation — not merely a real id somewhere in the registry,
 * because "propose the billing page from the besigner" is exactly the kind
 * of plausible wandering that makes an assistant feel unsafe, and not the
 * edit action either, which is never a destination. Param names must be ones
 * that action declared. The href is composed from the registry template and
 * the caller's own server-resolved slug and host, so a completion cannot
 * steer the user anywhere the registry does not already point.
 *
 * Anything unexpected returns null. A dropped proposal costs the user a
 * button; an honoured bad one costs them trust.
 */
export function resolveAssistProposal(
  rawBlock: string | null,
  view: AssistView | null,
  scope: { orgSlug: string; hostId: string },
  drafts: readonly AssistBuildDraft[] = [],
): AssistProposal | null {
  if (!rawBlock || !view) return null
  const navigations = view.actions.filter(isNavigateAction)
  if (!navigations.length) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawBlock) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const id = String(parsed['id'] ?? '').trim()
  const action = navigations.find((candidate) => candidate.id === id)
  if (!action) return null

  const supplied = (parsed['params'] ?? {}) as Record<string, unknown>
  const values: Array<{ name: string; value: string }> = []
  if (supplied && typeof supplied === 'object' && !Array.isArray(supplied)) {
    for (const name of action.params) {
      const value = String(supplied[name] ?? '')
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, MAX_PARAM_VALUE_CHARS)
      if (value) values.push({ name, value })
    }
  }

  const href = buildActionHref(action, scope, values)
  if (!href) return null

  // The open-draft navigation names a draft the request listed, or nothing.
  if (action.id === ASSIST_OPEN_DRAFT_ACTION_ID) {
    const ref = values.find((value) => value.name === ASSIST_OPEN_DRAFT_PARAM)?.value
    const draft = drafts.find((one) => one.ref === ref)
    if (!draft) return null
    return {
      id: action.id,
      label: `Open “${draft.label}” in the Besigner`,
      outcome: `the ${draft.noun} “${draft.label}” in the Besigner, where your request is asked again`,
      href,
      values: [],
      prefill: false,
      draft,
    }
  }

  return {
    id: action.id,
    label: action.label,
    outcome: action.outcome,
    href,
    values,
    prefill: action.prefill,
  }
}

/**
 * Compose the destination from the registry template and the server's own
 * scope values. Returns '' when the template needs a segment this page does
 * not have — a half-substituted path like `/acme/hosts//setup` is a 404 with
 * a confirm button on it, which is worse than no button.
 */
function buildActionHref(
  action: AssistNavigateAction,
  scope: { orgSlug: string; hostId: string },
  values: ReadonlyArray<{ name: string; value: string }>,
): string {
  const orgSlug = sanitiseId(scope.orgSlug)
  const hostId = sanitiseId(scope.hostId)
  let path = action.route
  if (path.includes('[orgSlug]')) {
    if (!orgSlug) return ''
    path = path.replace('[orgSlug]', orgSlug)
  }
  if (path.includes('[host]')) {
    if (!hostId) return ''
    path = path.replace('[host]', hostId)
  }
  // Nothing above can produce these, which is exactly why they are worth
  // asserting: this is the last line before a path reaches a router.
  if (!path.startsWith('/') || path.includes('..') || path.includes('//')) return ''
  if (/\[|\]/.test(path)) return ''

  if (!action.prefill || !values.length) return path
  const query = values
    .map(
      ({ name, value }) =>
        `${ASSIST_PREFILL_PREFIX}${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join('&')
  return `${path}?${query}`
}

/**
 * The write boundary, asserted over the live table rather than described in
 * a comment. Called by the spec; exported so the check travels with the data
 * it checks rather than living in a test file someone can delete.
 *
 * Every action is inert UNLESS it is an edit action and the request cleared
 * the edit rung: a navigation carries no write-capable field and no ops, an
 * edit action carries no destination, and an edit action offered to a
 * request below the rung is a violation. `offer` is the function the doors
 * decide with; a spec passes a broken one to show this check can fail.
 *
 * Returns the list of violations so a failure names the offending action.
 */
export function assertInertActions(
  views: readonly AssistView[] = ASSIST_VIEWS,
  rung: AssistActionRung = { edit: false },
  offer: typeof offeredActions = offeredActions,
): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  const forbidden = ['method', 'body', 'endpoint', 'submit', 'url', 'api', 'mutation']
  for (const view of views) {
    const offered = offer(view, rung)
    for (const action of view.actions) {
      const where = `${view.key}/${action.id}`
      if (seen.has(action.id)) problems.push(`${where}: duplicate action id`)
      seen.add(action.id)
      for (const key of Object.keys(action)) {
        if (forbidden.includes(key.toLowerCase())) {
          problems.push(`${where}: action carries a write-capable field "${key}"`)
        }
      }
      if (action.kind === 'edit') {
        if (!rung.edit && offered.includes(action)) {
          problems.push(
            `${where}: an edit action is offered to a request that did not clear the edit rung`,
          )
        }
        for (const key of ['route', 'params', 'prefill']) {
          if (key in action) {
            problems.push(
              `${where}: an edit action carries "${key}" — it applies ops on the open canvas and never navigates`,
            )
          }
        }
        const documents = action.documents ?? []
        if (
          !documents.length ||
          documents.some((kind) => !ASSIST_EDIT_DOCUMENT_KINDS.includes(kind))
        ) {
          problems.push(`${where}: an edit action names a document the edit rung does not open on`)
        }
        continue
      }
      if ('ops' in action) {
        problems.push(`${where}: only an edit action carries ops`)
      }
      if (!action.route.startsWith('/')) {
        problems.push(`${where}: route is not a root-relative console path`)
      }
      if (action.route.includes('/api/')) {
        problems.push(`${where}: route points at an API endpoint`)
      }
      if (action.prefill && !PREFILL_READY_ROUTES.includes(action.route)) {
        problems.push(
          `${where}: prefill:true but ${action.route} is not in PREFILL_READY_ROUTES — wire the page to read ${ASSIST_PREFILL_PREFIX}* params first`,
        )
      }
    }
  }
  return problems
}
