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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import { aiAddonName, checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { SCREEN_ROOT_PATH } from '@aglyn/aglyn/app-utils/screen-route'
import { HostScreenVisibility } from '@aglyn/aglyn/foundation/definitions/platform.types'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import type { PluginAiCapabilityArgsSchema } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { getLockdownVerdict } from '@aglyn/tenant-data-admin/server/lockdown'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { AiJobOutput } from '../model/ai-jobs.types'
import { registerAiJobAdmission, type AiJobAdmission, type AiJobAdmissionRefusal } from './ai-job-admission'
import { aiJobEditModel } from './ai-job-edit-step'
import { aiLimitReview, aiUnspentOutcome } from './ai-job-generation'
import type { AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

/**
 * The `privacy` step (AGL-4033): who can see the site, as the console's own
 * three controls set it — maintenance mode (Admin → Error pages), the
 * Discourage search engines switch (Setup → SEO) and a page's Visibility
 * (its Page Access card) — as a first-class build operation, so "make my site
 * private until launch" or "hide the pricing page" is one item on Assist's
 * plan card. The docs page it mirrors is Site Protection → Make your site
 * private.
 *
 * NO MODEL. The planner already wrote the choices as the item's arguments;
 * this checks each against the rule the console's own control holds it to and
 * writes it, so it costs no credits.
 *
 * ── Only the controls' own fields ────────────────────────────────────────
 *
 * `maintenance` (true, or deleted on the way off, as the Error pages card
 * writes it), `seo.discourageSearchEngines` (likewise, as the Search engines
 * card does), and a page's `visibility` as Public, Unlisted or Members only.
 * Leaving password mode drops the page's stored hash, as the Page Access card
 * does, so protection never lingers on a page that no longer asks for it.
 *
 * NEVER: a page password. Setting one would put the password in the chat and
 * the plan, so it is not an argument; the note sends the person to the Page
 * Access card instead. Nor layouts, emails or record templates, which have no
 * Page Access card, nor the error pages themselves.
 *
 * ── Who may ──────────────────────────────────────────────────────────────
 *
 * Search indexing and page visibility: the Firestore rules' own for those
 * keys, a member with a write role on the site (admin, editor or author)
 * while no lockdown freezes it. Maintenance mode takes every page of the site
 * offline for every visitor, so, as the console keeps its card in the Admin
 * area, only a site ADMIN may change it here. A non-admin's request still
 * makes the rest of its changes and says why that one was not made.
 *
 * Members only is made only where the plan has content gating (Business and
 * above): the tenant serves gated pages nowhere else, so on a lower plan the
 * write would close the page to everyone, and the note says why it was not.
 *
 * ── Live on confirm, idempotent ──────────────────────────────────────────
 *
 * As the `settings` and `tracking` steps: none of these has a draft, so the
 * plan card's confirm is the agreement and the write is live. One transaction
 * re-reads the host and each page, re-checks the role, writes only what
 * differs, and queues a site-wide publish outbox entry, because visibility
 * changes navigation and the sitemap and both switches change every page.
 */

export const AI_PRIVACY_KIND = 'privacy' as const

/** ASSUMED: the least time the step needs — the site, the org, the pages named and one transaction. */
export const AI_JOB_PRIVACY_STEP_MINIMUM_MS = 5_000

export const AI_PRIVACY_NO_SITE_COPY = 'Open the site whose privacy should change.'
export const AI_PRIVACY_ROLE_COPY = 'Changing who can see the site needs the admin, editor or author role on this site.'
export const AI_PRIVACY_ADMIN_COPY = 'Only a site admin can turn maintenance mode on or off, so it was left as it is.'
export const AI_PRIVACY_LOCKED_COPY = 'This site is not accepting changes right now.'
export const AI_PRIVACY_NOTHING_COPY = 'The request named no privacy change this could make.'
export const AI_PRIVACY_PASSWORD_COPY =
  `To put a page behind a password, set it in that page’s Page Access card; ${aiAddonName()} never handles passwords.`

/** The most pages one item may change. */
export const AI_PRIVACY_MAX_PAGES = 20

/** The visibilities a build may set, by the Page Access card's labels. */
export const AI_PRIVACY_VISIBILITIES = ['public', 'unlisted', 'members'] as const
export type AiPrivacyVisibility = (typeof AI_PRIVACY_VISIBILITIES)[number]

const VISIBILITY_VALUES: Readonly<Record<AiPrivacyVisibility, HostScreenVisibility>> = {
  public: HostScreenVisibility.PUBLIC,
  unlisted: HostScreenVisibility.UNLISTED,
  members: HostScreenVisibility.AUTHENTICATED,
}

const VISIBILITY_LABELS: Readonly<Record<AiPrivacyVisibility, string>> = {
  public: 'Public',
  unlisted: 'Unlisted',
  members: 'Members only',
}

/** Where a person finds each change, as the output links and notes name it. */
export const AI_PRIVACY_OUTPUTS = {
  maintenance: { id: 'maintenance', label: 'Maintenance mode', where: 'Admin → Error pages' },
  search: { id: 'search', label: 'Search engines', where: 'Setup → SEO' },
  pages: { id: 'pages', label: 'Page access', where: 'each page’s Page Access card' },
} as const

/** Where the operation's changes are made, as the build's notes name it. */
export const AI_PRIVACY_WHERE = 'the site’s privacy settings'

/** The item's arguments, as the planner fills them in. Every one optional. */
export const AI_PRIVACY_ARGS_SCHEMA: PluginAiCapabilityArgsSchema = {
  type: 'object',
  properties: {
    maintenance: {
      type: 'boolean',
      description:
        'true takes the whole site offline: every address shows its 503 page to every visitor, including anyone with a link, until it is turned off. false brings the site back. Leave it out unless the person asked to take the whole site offline, keep it from everyone until launch, or bring it back.',
    },
    discourageSearchEngines: {
      type: 'boolean',
      description:
        'true asks search engines not to index any page of the site (it stays open to anyone with a link); false lets them index it again. Leave it out unless the person asked about search engines or Google.',
    },
    publicPages: {
      type: 'array',
      description: 'Pages to make Public: anyone can open them, and they are offered to search engines. Each by its id from the site inventory.',
      items: { type: 'string', maxLength: 64 },
      maxItems: AI_PRIVACY_MAX_PAGES,
    },
    unlistedPages: {
      type: 'array',
      description: 'Pages to make Unlisted: anyone with the link can open them, kept out of search results, the sitemap and navigation. Each by its id from the site inventory.',
      items: { type: 'string', maxLength: 64 },
      maxItems: AI_PRIVACY_MAX_PAGES,
    },
    membersPages: {
      type: 'array',
      description: 'Pages to make Members only: only visitors signed in to the site can open them (Business plan and above). Each by its id from the site inventory.',
      items: { type: 'string', maxLength: 64 },
      maxItems: AI_PRIVACY_MAX_PAGES,
    },
  },
  additionalProperties: false,
}

/** Each visibility's argument, as the planner lists the pages for it. */
const VISIBILITY_ARGS: Readonly<Record<AiPrivacyVisibility, string>> = {
  public: 'publicPages',
  unlisted: 'unlistedPages',
  members: 'membersPages',
}

/** What an item asks: each switch to set, and each page's new visibility. */
export interface AiPrivacyRequest {
  maintenance: boolean | null
  discourageSearchEngines: boolean | null
  pages: { page: string; visibility: AiPrivacyVisibility }[]
}

export interface AiPrivacyRead {
  request: AiPrivacyRequest
  /** A sentence per value that could not be used, so the rest still are. */
  problems: string[]
}

const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null)

/** A page id as the site inventory gives it: one document id, never a path. */
const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The item's arguments read: what may be written, and a sentence for each that may not. */
export function aiPrivacyRequestOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiPrivacyRead {
  const problems: string[] = []
  const pages: AiPrivacyRequest['pages'] = []
  const asked = new Map<string, Set<AiPrivacyVisibility>>()
  for (const visibility of AI_PRIVACY_VISIBILITIES) {
    const listed = inputs?.[VISIBILITY_ARGS[visibility]]
    for (const entry of Array.isArray(listed) ? listed : []) {
      const page = typeof entry === 'string' ? entry.trim() : ''
      if (PAGE_ID.test(page)) asked.set(page, (asked.get(page) ?? new Set()).add(visibility))
    }
  }
  for (const [page, visibilities] of asked) {
    // A page asked to be two things is left alone rather than guessed at.
    if (visibilities.size > 1) problems.push('A page was asked to be two things at once, so it was left as it is.')
    else pages.push({ page, visibility: [...visibilities][0] })
  }
  if (pages.length > AI_PRIVACY_MAX_PAGES) {
    pages.splice(AI_PRIVACY_MAX_PAGES)
    problems.push(`Only the first ${AI_PRIVACY_MAX_PAGES} pages were changed; ask again for the rest.`)
  }
  return {
    request: {
      maintenance: flag(inputs?.['maintenance']),
      discourageSearchEngines: flag(inputs?.['discourageSearchEngines']),
      pages,
    },
    problems,
  }
}

/** Whether a read request asks for anything at all. */
export function aiPrivacyRequestEmpty(request: AiPrivacyRequest): boolean {
  return request.maintenance === null && request.discourageSearchEngines === null && request.pages.length === 0
}

// ── The write ─────────────────────────────────────────────────────────────

export type AiPrivacyWrite =
  | {
      ok: true
      /** A sentence per change asked, made now or already so, by output id. */
      done: { output: keyof typeof AI_PRIVACY_OUTPUTS; said: string }[]
      /** A sentence per part that was not made, and why. */
      notDone: string[]
      changedAny: boolean
      outboxId: string | null
    }
  | { ok: false; error: string }

/**
 * The changes written, in one transaction that reads the host and each named
 * page as they are stored NOW: the member still holds a write role (and is an
 * admin, for maintenance), each page exists and is a page, and only what
 * differs from what is stored is written, with a site-wide publish outbox
 * entry beside it so the live site's cached pages are dropped.
 */
export async function writeAiSitePrivacy(
  firestore: Firestore,
  input: { hostId: string; uid: string; request: AiPrivacyRequest; contentGating: boolean; now: Date },
): Promise<AiPrivacyWrite> {
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  const screens = hostRef.collection('screens')
  return firestore.runTransaction(async (tx): Promise<AiPrivacyWrite> => {
    const host = await tx.get(hostRef)
    if (!host.exists) return { ok: false, error: 'Unknown site' }
    const role = ((host.get('memberRoles') ?? {}) as Record<string, unknown>)[input.uid]
    if (!hostRoleCanWrite(role)) return { ok: false, error: AI_PRIVACY_ROLE_COPY }
    const pageDocs = await Promise.all(input.request.pages.map((one) => tx.get(screens.doc(one.page))))

    const done: { output: keyof typeof AI_PRIVACY_OUTPUTS; said: string }[] = []
    const notDone: string[] = []
    const hostUpdates: Record<string, unknown> = {}
    const pageUpdates: { ref: FirebaseFirestore.DocumentReference; update: Record<string, unknown> }[] = []

    const { maintenance, discourageSearchEngines } = input.request
    if (maintenance !== null) {
      if (role !== 'admin') {
        notDone.push(AI_PRIVACY_ADMIN_COPY)
      } else {
        if ((host.get('maintenance') === true) !== maintenance) {
          hostUpdates['maintenance'] = maintenance || FieldValue.delete()
        }
        const assigned = !!(host.get('errorScreens') as Record<string, unknown> | undefined)?.['unavailable']
        done.push({
          output: 'maintenance',
          said: maintenance
            ? `Maintenance mode is on: every address shows ${assigned ? 'your 503 page' : `${PLATFORM_BRAND_NAME}’s plain “undergoing maintenance” notice, because no 503 page is assigned yet`} to every visitor.`
            : 'Maintenance mode is off: the site is open to visitors again.',
        })
      }
    }
    if (discourageSearchEngines !== null) {
      const stored = (host.get('seo') as Record<string, unknown> | undefined)?.['discourageSearchEngines'] === true
      if (stored !== discourageSearchEngines) {
        hostUpdates['seo.discourageSearchEngines'] = discourageSearchEngines || FieldValue.delete()
      }
      done.push({
        output: 'search',
        said: discourageSearchEngines
          ? 'Search engines are asked not to index this site. Anyone with a link can still open it.'
          : 'Search engines may index this site again. They take days to come back.',
      })
    }
    input.request.pages.forEach((asked, index) => {
      const page = pageDocs[index]
      if (!page.exists || page.get('deletedAt') != null || page.get('kind')) {
        notDone.push('A page named is not one of this site’s pages, so it was left out.')
        return
      }
      const name = String(page.get('displayName') ?? '').trim() || 'A page'
      if (asked.visibility === 'members' && !input.contentGating) {
        // The tenant serves gated pages only on plans with content gating, so
        // writing it here would close the page to everyone.
        notDone.push(`“${name}” was not made Members only: members-only pages need the Business plan or above.`)
        return
      }
      const value = VISIBILITY_VALUES[asked.visibility]
      const update: Record<string, unknown> = {}
      if ((page.get('visibility') ?? HostScreenVisibility.PUBLIC) !== value) update['visibility'] = value
      const hadPassword = !!(page.get('protection') as Record<string, unknown> | undefined)?.['passwordHash']
      if (hadPassword) update['protection'] = FieldValue.delete()
      if (Object.keys(update).length) pageUpdates.push({ ref: page.ref, update: { ...update, updatedAt: input.now } })
      const extra = hadPassword ? ' Its page password was removed.' : ''
      done.push({ output: 'pages', said: `“${name}” is now ${VISIBILITY_LABELS[asked.visibility]}.${extra}` })
    })

    const changedAny = Object.keys(hostUpdates).length > 0 || pageUpdates.length > 0
    if (!changedAny) return { ok: true, done, notDone, changedAny, outboxId: null }
    if (Object.keys(hostUpdates).length) tx.update(hostRef, { ...hostUpdates, updatedAt: input.now })
    for (const { ref, update } of pageUpdates) tx.update(ref, update)
    // Both switches change every page, and a page's visibility changes the
    // navigation and the sitemap every other page carries.
    const outboxRef = firestore.collection('publishOutbox').doc(createResourceUid())
    tx.set(outboxRef, {
      hostId: input.hostId,
      paths: [SCREEN_ROOT_PATH],
      entireHost: true,
      createdAt: FieldValue.serverTimestamp(),
      attempts: 0,
    })
    return { ok: true, done, notDone, changedAny, outboxId: outboxRef.id }
  })
}

// ── The step ──────────────────────────────────────────────────────────────

/** Why this member may not change who can see this site now, or `null`. */
export async function aiPrivacyAccessRefusal(
  input: { host: FirebaseFirestore.DocumentSnapshot; uid: string; org: object | null; request: AiPrivacyRequest },
  deps: { lockdown?: typeof getLockdownVerdict } = {},
): Promise<string | null> {
  if (!input.host.exists) return 'Unknown site'
  const role = ((input.host.get('memberRoles') ?? {}) as Record<string, unknown>)[input.uid]
  if (!hostRoleCanWrite(role)) return AI_PRIVACY_ROLE_COPY
  // A request that is ONLY maintenance has nothing a non-admin may make.
  const onlyMaintenance =
    input.request.maintenance !== null && input.request.discourageSearchEngines === null && !input.request.pages.length
  if (onlyMaintenance && role !== 'admin') return AI_PRIVACY_ADMIN_COPY
  const locked = await (deps.lockdown ?? getLockdownVerdict)({
    staff: false,
    uid: input.uid,
    org: input.org as never,
    host: input.host.data() as never,
    intent: 'write',
  })
  return locked ? AI_PRIVACY_LOCKED_COPY : null
}

/** One output's note: what changed, that it is live, and what was not done. */
export function aiPrivacyOutputNote(said: readonly string[], where: string, notDone: readonly string[], changedAny: boolean): string {
  const did = said.length
    ? `${said.join(' ')} Live now, in ${where}.${changedAny ? '' : ' It already was, so nothing was written.'}`
    : 'Nothing needed changing.'
  const not = notDone.length ? ` Not done: ${notDone.join(' ')}` : ''
  return `${did}${not}`.slice(0, 1_000)
}

export interface AiJobPrivacyStepDeps {
  write?: typeof writeAiSitePrivacy
  lockdown?: typeof getLockdownVerdict
  dropCache?: typeof dropPluginSiteCache
}

export function createAiJobPrivacyStep(deps: AiJobPrivacyStepDeps = {}): AiJobStepRunner {
  const write = deps.write ?? writeAiSitePrivacy
  const dropCache = deps.dropCache ?? dropPluginSiteCache
  return async ({ job, now, firestore, org, modelFor }): Promise<AiJobStepOutcome> => {
    // No model is asked: the outcome records the edit step's at no cost.
    const model = modelFor?.('job.edit') ?? aiJobEditModel()
    const unspent = (failure: string): AiJobStepOutcome => ({ ...aiUnspentOutcome(model), failure })
    const hostId = job.hostId
    if (!hostId) return unspent(AI_PRIVACY_NO_SITE_COPY)
    const read = aiPrivacyRequestOf(job.inputs)
    if (aiPrivacyRequestEmpty(read.request)) return unspent([AI_PRIVACY_NOTHING_COPY, ...read.problems].join(' '))
    const orgData = (org ?? ((await firestore.collection('orgs').doc(job.orgId).get()).data() ?? null)) as Record<string, unknown> | null
    const host = await firestore.collection('hosts').doc(hostId).get()
    const refused = await aiPrivacyAccessRefusal({ host, uid: job.createdBy, org: orgData, request: read.request }, { lockdown: deps.lockdown })
    if (refused) return aiUnspentOutcome(model, { review: aiLimitReview(refused) })
    const written = await write(firestore, {
      hostId,
      uid: job.createdBy,
      request: read.request,
      contentGating: checkEntitlement(orgData as never, 'contentGating'),
      now,
    })
    if (written.ok === false) return unspent(written.error)
    if (written.outboxId) {
      // The live site's cached pages go now; the outbox entry stays for the
      // drain unless the drop certainly happened.
      const dropped = await dropCache({ hostIds: [hostId], reason: 'AI build changed site privacy' }).catch(() => ({ complete: false }))
      if (dropped.complete) await firestore.collection('publishOutbox').doc(written.outboxId).delete().catch(() => undefined)
    }
    const notDone = [...read.problems, ...written.notDone]
    const hostSubdomain = (typeof host.get('subdomain') === 'string' && host.get('subdomain')) || null
    const outputs: AiJobOutput[] = (Object.keys(AI_PRIVACY_OUTPUTS) as (keyof typeof AI_PRIVACY_OUTPUTS)[])
      .filter((key) => written.done.some((one) => one.output === key))
      .map((key, index) => ({
        resource: 'privacy',
        id: AI_PRIVACY_OUTPUTS[key].id,
        hostId,
        hostSubdomain,
        label: AI_PRIVACY_OUTPUTS[key].label,
        note: aiPrivacyOutputNote(
          written.done.filter((one) => one.output === key).map((one) => one.said),
          AI_PRIVACY_OUTPUTS[key].where,
          // What was not done is said once, on the first output.
          index === 0 ? notDone : [],
          written.changedAny,
        ),
      }))
    if (!outputs.length) return unspent([AI_PRIVACY_NOTHING_COPY, ...notDone].join(' '))
    return aiUnspentOutcome(model, { outputs })
  }
}

export const runAiJobPrivacyStep = createAiJobPrivacyStep()

// ── Admission ─────────────────────────────────────────────────────────────

export interface AiPrivacyJobAdmissionDeps {
  ownerOf?: typeof resolveOrgIdForHost
  lockdown?: typeof getLockdownVerdict
}

/**
 * A privacy change is admitted on a site of the job's own org, for a member
 * who may write it now, where the request names at least one change this can
 * make. Refused in those words before anything is written.
 */
export function createAiPrivacyJobAdmission(deps: AiPrivacyJobAdmissionDeps = {}): AiJobAdmission {
  const ownerOf = deps.ownerOf ?? resolveOrgIdForHost
  return async (context): Promise<AiJobAdmissionRefusal | null> => {
    if (!context.hostId) return { status: 400, error: AI_PRIVACY_NO_SITE_COPY }
    const owner = await ownerOf(context.hostId)
    if (!owner || owner !== context.orgId) return { status: 404, error: 'Unknown site' }
    const read = aiPrivacyRequestOf(context.inputs as Record<string, unknown>)
    if (aiPrivacyRequestEmpty(read.request)) return { status: 400, error: [AI_PRIVACY_NOTHING_COPY, ...read.problems].join(' ') }
    const host = await context.firestore.collection('hosts').doc(context.hostId).get()
    const refused = await aiPrivacyAccessRefusal(
      { host, uid: context.uid ?? '', org: context.org, request: read.request },
      { lockdown: deps.lockdown },
    )
    return refused ? { status: 403, error: refused } : null
  }
}

export const aiPrivacyJobAdmission = createAiPrivacyJobAdmission()

/** Registers the privacy step and its door (AGL-4033). */
export function registerAiPrivacyJob(): void {
  registerAiJobStep(AI_PRIVACY_KIND, runAiJobPrivacyStep, { minimumMs: AI_JOB_PRIVACY_STEP_MINIMUM_MS })
  registerAiJobAdmission(AI_PRIVACY_KIND, aiPrivacyJobAdmission)
}
