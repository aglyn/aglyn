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
 * token is billed per turn against a margin constraint Zach set as hard.
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
 * Zach's requirement is a single feature that is "easy for someone who
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
 */

/**
 * One thing the assistant may PROPOSE from a given view.
 *
 * Note what this interface cannot express. There is no `method`, no `body`,
 * no `endpoint`, no `submit` — a descriptor is a signpost, and the type is
 * the first line of the write boundary. Adding any of those fields would
 * break `assertInertActions()`, which is the point of writing it down.
 */
export interface AssistViewAction {
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
  /** Navigate-only proposals available from this view. */
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
): AssistViewAction => ({ id, label, outcome, route, params, prefill: false })

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
    screen: 'The Besigner — the visual editor for a screen, component, template, layout or email.',
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
    actions: [],
  },
  {
    key: 'host-screens',
    match: /^\/[^/]+\/hosts\/[^/]+\/screens(\/|$)/,
    screen: 'Screens — the list of pages on this site.',
    plain: [
      'Every page a visitor can reach is a screen listed here.',
      'Open a screen to see its versions, then open the Besigner to edit it.',
      'Publishing a screen version is what puts a change on the live site.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/screens; detail is .../screens/[screenId]/versions/[versionId]/view.',
      '[host] in the path is the site (host) document id, not the domain name.',
    ],
    actions: [
      orgAction(
        'open.host.screens',
        'Open Screens',
        'the list of pages on this site',
        '/[orgSlug]/hosts/[host]/screens',
      ),
    ],
  },
  {
    key: 'host-theme',
    match: /^\/[^/]+\/hosts\/[^/]+\/theme(\/|$)/,
    screen: 'Theme — the site-wide colours, type and spacing every screen inherits.',
    plain: [
      'Change something here and it changes everywhere on the site at once.',
      'This is the place to fix a colour or a font you keep re-setting on individual elements.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/theme.',
      'Theme values resolve at render time, so screens pick them up without being republished individually.',
    ],
    actions: [],
  },
  {
    key: 'host-workflows',
    match: /^\/[^/]+\/hosts\/[^/]+\/workflows(\/|$)/,
    screen: 'Workflows — automations that run when something happens on the site.',
    plain: [
      'A workflow is a trigger plus the actions that follow it, such as sending an email when a form is submitted.',
      'Build the trigger first, then add the actions it should run.',
    ],
    technical: [
      'Route: /[orgSlug]/hosts/[host]/workflows.',
      'Webhook actions let a workflow call an external endpoint; see the workflows docs for the payload shape.',
    ],
    actions: [],
  },
  {
    key: 'host-products',
    match: /^\/[^/]+\/hosts\/[^/]+\/products(\/|$)/,
    screen: 'Products — the commerce catalog for this site.',
    plain: [
      'Add and edit the things this site sells, including price and availability.',
      'A product has to exist here before a screen can put it in front of a buyer.',
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
      'Rules are evaluated by the tenant runtime on the request path, before the screen is resolved.',
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
      'See how many people visited, and which screens they landed on.',
      'Figures cover the live site only — drafts and previews are not counted.',
    ],
    technical: ['Route: /[orgSlug]/hosts/[host]/analytics.'],
    actions: [],
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
      'A dataset is a structured list — products, posts, submissions — that screens can display.',
      'Define the fields first; screens bind to them afterwards.',
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
      'Everything about one site hangs off this page: its screens, theme, data, commerce and settings.',
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
      'Each row is a site with its own screens, theme and domain.',
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
      'Define the fields before building the screen that displays them — screens bind to fields that already exist.',
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
    key: 'org-media',
    match: /^\/[^/]+\/media(\/|$)/,
    screen: 'Media — images and files for this workspace.',
    plain: [
      'Upload once here and use the file on any site in the workspace.',
      'If the file belongs to one site only, upload it on that site’s own Media page instead.',
      'Files are referenced by the screens that use them, so replacing a file changes it everywhere it appears.',
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
 */
export function safeOrgFacts(org: Record<string, unknown>): {
  name: string
  plan: string
} {
  return {
    name: String(org?.['name'] ?? '').slice(0, 120),
    plan: String(org?.['plan'] ?? '').slice(0, 40),
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
 * So this block is a pure function of the registry, and everything that
 * varies per request lives after the breakpoint.
 */
export function viewScreenBlock(view: AssistView | null): string {
  const lines: string[] = []
  if (view) {
    lines.push(`This screen: ${view.screen}`)
    if (view.plain.length) {
      lines.push('What the user can do here:')
      for (const line of view.plain) lines.push(`- ${line}`)
    }
    if (view.technical.length) {
      lines.push('Technical detail for the "Under the hood" line:')
      for (const line of view.technical) lines.push(`- ${line}`)
    }
    if (view.actions.length) {
      lines.push(
        'Actions you may PROPOSE from this screen (ids are exact; propose at most one, and only when the user asked to get something done):',
      )
      for (const action of view.actions) {
        const params = action.params.length
          ? ` params: ${action.params.join(', ')}`
          : ' params: none'
        lines.push(`- id "${action.id}" — ${action.label}: opens ${action.outcome}.${params}`)
      }
    } else {
      lines.push(
        'This screen offers no proposable actions. Do not emit an action block here.',
      )
    }
  } else {
    lines.push(
      'This exact screen is not in the assistant’s screen index. Answer from the documentation and describe navigation in words rather than asserting what this page contains.',
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
}

const MAX_PARAM_VALUE_CHARS = 200

/**
 * Turn a model-emitted action block into a proposal, or nothing.
 *
 * Everything here is a narrowing. The id must be one the CURRENT view
 * offers — not merely a real id somewhere in the registry, because "propose
 * the billing page from the besigner" is exactly the kind of plausible
 * wandering that makes an assistant feel unsafe. Param names must be ones
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
): AssistProposal | null {
  if (!rawBlock || !view || !view.actions.length) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawBlock) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const id = String(parsed['id'] ?? '').trim()
  const action = view.actions.find((candidate) => candidate.id === id)
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
  action: AssistViewAction,
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
 * Returns the list of violations so a failure names the offending action.
 */
export function assertInertActions(views: readonly AssistView[] = ASSIST_VIEWS): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  const forbidden = ['method', 'body', 'endpoint', 'submit', 'url', 'api', 'mutation']
  for (const view of views) {
    for (const action of view.actions) {
      const where = `${view.key}/${action.id}`
      if (seen.has(action.id)) problems.push(`${where}: duplicate action id`)
      seen.add(action.id)
      for (const key of Object.keys(action)) {
        if (forbidden.includes(key.toLowerCase())) {
          problems.push(`${where}: action carries a write-capable field "${key}"`)
        }
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
