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
import { holdsSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import { orgPermissionLabel } from '@aglyn/aglyn/app-utils/org-permissions'
import { SCREEN_ROOT_PATH } from '@aglyn/aglyn/app-utils/screen-route'
import {
  GA_MEASUREMENT_ID_PATTERN,
  GOOGLE_ADS_ID_PATTERN,
  GTM_CONTAINER_ID_PATTERN,
  LINKEDIN_PARTNER_ID_PATTERN,
  META_PIXEL_ID_PATTERN,
  PINTEREST_TAG_ID_PATTERN,
  TIKTOK_PIXEL_ID_PATTERN,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import type { PluginAiCapabilityArgsSchema, PluginAiCapabilityInputField } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
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
 * The `tracking` step (AGL-3751): the site's analytics and advertising tags,
 * as the console's Setup → Tracking card sets them — Google Analytics, Google
 * Tag Manager, and the Meta, Google Ads, LinkedIn, TikTok and Pinterest tags —
 * as a first-class build operation, so "connect Google Analytics G-4R7KX2PQ9Z"
 * is one item on Assist's plan card.
 *
 * NO MODEL. The planner already wrote the ids as the item's arguments; this
 * holds each to the pattern the card's field (and the tenant's loader) holds
 * it to and writes it, so it costs no credits.
 *
 * ── Only the card's own fields, and only public ids ──────────────────────
 *
 * Every field written is one the Tracking card writes, under the same name:
 * `analytics.gaMeasurementId`, `analytics.gtmContainerId` and
 * `analytics.adTags.{meta,google-ads,linkedin,tiktok,pinterest}`, each tested
 * by the same expression (`GA_MEASUREMENT_ID_PATTERN` and its siblings in
 * `visitor-consent.ts`). Each is an id that is printed in every page's HTML
 * anyway, never a credential. Removing one deletes the field, as the card's
 * cleared box does (`CLEARABLE_TRACKING_PATHS`).
 *
 * NEVER: the consent banner (`consent.*` — turning it off, its mode, or the
 * advertising question), search indexing, verification tokens, and anything
 * that needs a secret the person pastes — the Ad conversions card's access
 * tokens, Zapier, order webhooks' signing secrets. Those are not arguments.
 * The tags load only where the consent banner lets them, exactly as a tag the
 * card saved does: the tenant gates on the stored ids, not on who wrote them.
 *
 * ── Live on confirm, who may, idempotent ─────────────────────────────────
 *
 * As the `settings` step (AGL-3748): a tag has no draft, so the plan card's
 * confirm is the agreement and the write is live. One transaction re-reads
 * the host, re-checks the role, writes only what differs with a site-wide
 * publish outbox entry, and the site's cached pages are dropped after. The
 * gate is the Firestore rules' for the host document (`canWriteHostContent`,
 * `hostWritesFrozen`): an admin, editor or author, while no lockdown freezes
 * the site, its org or the platform.
 */

export const AI_TRACKING_KIND = 'tracking' as const

/** ASSUMED: the least time the step needs — the site, the org and one transaction. */
export const AI_JOB_TRACKING_STEP_MINIMUM_MS = 5_000

export const AI_TRACKING_NO_SITE_COPY = 'Open the site whose tracking should change.'
/** Names "Edit site content" (`site.edit`, AGL-4047), never a role. */
export const AI_TRACKING_ROLE_COPY = `Changing the site’s tracking needs the "${orgPermissionLabel('site.edit')}" permission on this site — ask an organization admin.`
export const AI_TRACKING_LOCKED_COPY = 'This site is not accepting changes right now.'
export const AI_TRACKING_NOTHING_COPY = 'The request named no tracking id this could set or remove.'

/** Where a person finds what the op changed: the card that edits it. */
export const AI_TRACKING_WHERE = 'Setup → Tracking'

/** The output's fixed id: one site's tracking, whatever changed. */
export const AI_TRACKING_OUTPUT_ID = 'tracking'

/** One tag the card sets: its argument, its stored field, its name, and its pattern. */
export interface AiTrackingTag {
  arg: string
  path: string
  label: string
  pattern: RegExp
  /** What the card's field says the id looks like. */
  shape: string
  /** The id's name, as a field asking for it is labeled (AGL-3978): it names the provider. */
  field: string
  /** Asked when a request names this tag and no usable id, from the card's helper text. */
  ask: string
  /** Words that name this tag in an item's name. */
  named: RegExp
}

/** The Tracking card's fields, in its order (`trackingSchema`, host-settings-scope.tsx). */
export const AI_TRACKING_TAGS: readonly AiTrackingTag[] = [
  {
    arg: 'googleAnalytics',
    path: 'analytics.gaMeasurementId',
    label: 'Google Analytics',
    pattern: GA_MEASUREMENT_ID_PATTERN,
    shape: 'G-XXXXXXXXXX',
    field: 'Google Analytics measurement ID',
    ask: 'What’s your Google Analytics measurement ID? It looks like G-XXXXXXXXXX.',
    named: /google analytics|\bga4?\b|\banalytics\b/i,
  },
  {
    arg: 'googleTagManager',
    path: 'analytics.gtmContainerId',
    label: 'Google Tag Manager',
    pattern: GTM_CONTAINER_ID_PATTERN,
    shape: 'GTM-XXXXXXX',
    field: 'Google Tag Manager container ID',
    ask: 'What’s your Google Tag Manager container ID? It looks like GTM-XXXXXXX.',
    named: /tag manager|\bgtm\b/i,
  },
  {
    arg: 'metaPixel',
    path: 'analytics.adTags.meta',
    label: 'the Meta pixel',
    pattern: META_PIXEL_ID_PATTERN,
    shape: '8–20 digits',
    field: 'Meta pixel ID',
    ask: 'What’s your Meta pixel ID? It’s the number (8–20 digits) shown for your pixel in Meta Events Manager.',
    named: /\bmeta\b|facebook|instagram/i,
  },
  {
    arg: 'googleAds',
    path: 'analytics.adTags.google-ads',
    label: 'the Google Ads tag',
    pattern: GOOGLE_ADS_ID_PATTERN,
    shape: 'AW-123456789',
    field: 'Google Ads conversion ID',
    ask: 'What’s your Google Ads conversion ID? It looks like AW-123456789, from Google Ads.',
    named: /google ads|adwords/i,
  },
  {
    arg: 'linkedinInsight',
    path: 'analytics.adTags.linkedin',
    label: 'the LinkedIn Insight Tag',
    pattern: LINKEDIN_PARTNER_ID_PATTERN,
    shape: '4–10 digits',
    field: 'LinkedIn partner ID',
    ask: 'What’s your LinkedIn partner ID? It’s the number (4–10 digits) in LinkedIn Campaign Manager.',
    named: /linkedin/i,
  },
  {
    arg: 'tiktokPixel',
    path: 'analytics.adTags.tiktok',
    label: 'the TikTok pixel',
    pattern: TIKTOK_PIXEL_ID_PATTERN,
    shape: '16–24 capital letters and digits',
    field: 'TikTok pixel code',
    ask: 'What’s your TikTok pixel code? It’s in TikTok Ads Manager → Events, like C4ABCDEFGH1234567890.',
    named: /tiktok/i,
  },
  {
    arg: 'pinterestTag',
    path: 'analytics.adTags.pinterest',
    label: 'the Pinterest tag',
    pattern: PINTEREST_TAG_ID_PATTERN,
    shape: '10–16 digits',
    field: 'Pinterest tag ID',
    ask: 'What’s your Pinterest tag ID? It’s the number (10–16 digits) in Pinterest Ads → Conversions.',
    named: /pinterest/i,
  },
]

/** Asked when an item names no tag at all. */
export const AI_TRACKING_WHICH_COPY =
  'Which tag should be connected, and what is its ID? Google Analytics, Google Tag Manager, the Meta pixel, Google Ads, LinkedIn, TikTok or Pinterest.'

const TAG_ARGS = AI_TRACKING_TAGS.map((tag) => tag.arg)

const ID_RULE = 'Exactly as the person gave it; leave it out unless the request states the id — never make one up.'

/** The item's arguments, as the planner fills them in. Every one optional. */
export const AI_TRACKING_ARGS_SCHEMA: PluginAiCapabilityArgsSchema = {
  type: 'object',
  properties: {
    googleAnalytics: { type: 'string', description: `The Google Analytics 4 measurement ID, like G-XXXXXXXXXX. ${ID_RULE}`, maxLength: 24 },
    googleTagManager: { type: 'string', description: `The Google Tag Manager container ID, like GTM-XXXXXXX. ${ID_RULE}`, maxLength: 24 },
    metaPixel: { type: 'string', description: `The Meta (Facebook) pixel ID, 8–20 digits. ${ID_RULE}`, maxLength: 24 },
    googleAds: { type: 'string', description: `The Google Ads conversion ID, like AW-123456789. ${ID_RULE}`, maxLength: 24 },
    linkedinInsight: { type: 'string', description: `The LinkedIn Insight Tag partner ID, 4–10 digits. ${ID_RULE}`, maxLength: 24 },
    tiktokPixel: { type: 'string', description: `The TikTok pixel code, like C4ABCDEFGH1234567890. ${ID_RULE}`, maxLength: 32 },
    pinterestTag: { type: 'string', description: `The Pinterest tag ID, 10–16 digits. ${ID_RULE}`, maxLength: 24 },
    remove: {
      type: 'array',
      description: 'The tags the person asked to take off the site.',
      items: { type: 'string', enum: TAG_ARGS },
      maxItems: AI_TRACKING_TAGS.length,
    },
  },
  additionalProperties: false,
}

/** What an item asks: ids to set by field, and fields to clear. */
export interface AiTrackingRequest {
  set: Record<string, string>
  remove: string[]
}

export interface AiTrackingRead {
  request: AiTrackingRequest
  /** A sentence per value that could not be used, so the rest still are. */
  problems: string[]
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The item's arguments read: what may be written, and a sentence for each that may not. */
export function aiTrackingRequestOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiTrackingRead {
  const set: Record<string, string> = {}
  const problems: string[] = []
  const removing = new Set(Array.isArray(inputs?.['remove']) ? (inputs?.['remove'] as unknown[]).map((one) => String(one)) : [])
  const remove: string[] = []
  for (const tag of AI_TRACKING_TAGS) {
    const value = text(inputs?.[tag.arg])
    if (value && removing.has(tag.arg)) {
      problems.push(`${capitalized(tag.label)} was both set and removed, so it was left as it is.`)
      continue
    }
    if (removing.has(tag.arg)) {
      remove.push(tag.path)
      continue
    }
    if (!value) continue
    // The card's own test, and the loader's: an id of any other shape is
    // saved by nobody, since it would never load.
    if (tag.pattern.test(value)) set[tag.path] = value
    else problems.push(`“${value.slice(0, 40)}” is not an ID for ${tag.label}, which looks like ${tag.shape}.`)
  }
  return { request: { set, remove }, problems }
}

function capitalized(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * The question a planned tracking change asks the person, or `null` when it
 * sets or removes something (AGL-3751). An item with no usable id — the
 * planner kept "add my Meta pixel" with no id, or an id of the wrong shape —
 * is never built: it asks for the id of the tag its arguments or its name
 * name, in the card's own words, and says why an id given was not one.
 */
export function aiTrackingMissingInput(item: AiTrackingItem): string | null {
  const read = aiTrackingRequestOf(item.args)
  if (!aiTrackingRequestEmpty(read.request)) return null
  const named = aiTrackingTagsAsked(item)
  const asks = named.length ? named.map((tag) => tag.ask) : [AI_TRACKING_WHICH_COPY]
  return [...read.problems, ...asks].join(' ')
}

type AiTrackingItem = { name?: string; why?: string; args: Readonly<Record<string, unknown>> }

/** The tags an item asks about: those its arguments tried to set, else the ones its name or reason names. */
function aiTrackingTagsAsked(item: AiTrackingItem): AiTrackingTag[] {
  const tried = AI_TRACKING_TAGS.filter((tag) => text(item.args[tag.arg]))
  const naming = (words: string | undefined) => AI_TRACKING_TAGS.filter((tag) => tag.named.test(words ?? ''))
  const byName = naming(item.name)
  return tried.length ? tried : byName.length ? byName : naming(item.why)
}

/**
 * The fields a planned tracking change with no usable id waits for (AGL-3978):
 * one per tag it asks about, labeled with the provider's id and held to the
 * card's pattern, so the build pauses in `needs_input` for the person to give
 * it. Empty when the item can be built, or names no tag at all.
 */
export function aiTrackingInputFields(item: AiTrackingItem): PluginAiCapabilityInputField[] {
  if (!aiTrackingMissingInput(item)) return []
  return aiTrackingTagsAsked(item).map((tag) => ({ arg: tag.arg, label: tag.field, shape: tag.shape, pattern: tag.pattern }))
}

/** Whether a read request asks for anything at all. */
export function aiTrackingRequestEmpty(request: AiTrackingRequest): boolean {
  return Object.keys(request.set).length === 0 && request.remove.length === 0
}

// ── The write ─────────────────────────────────────────────────────────────

const getPath = (data: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined), data)

/** One change to the host document, with the sentence that says it was made. */
export interface AiTrackingChange {
  path: string
  /** The id to store, or `null` to delete the field. */
  value: string | null
  said: string
}

/** Every change the request asks, in the card's order, before comparing with what is stored. */
export function aiTrackingChanges(request: AiTrackingRequest): AiTrackingChange[] {
  const changes: AiTrackingChange[] = []
  for (const tag of AI_TRACKING_TAGS) {
    const value = request.set[tag.path]
    if (value) changes.push({ path: tag.path, value, said: `${capitalized(tag.label)} is connected (${value}).` })
    else if (request.remove.includes(tag.path)) changes.push({ path: tag.path, value: null, said: `${capitalized(tag.label)} is removed.` })
  }
  return changes
}

/**
 * What the person should know about the tags the site now carries, in the
 * card's own words: where the consent banner is off, nothing of ours gates
 * them; and a container beside a direct Google tag counts everything twice.
 */
export function aiTrackingWarnings(host: Record<string, unknown>): string[] {
  const warnings: string[] = []
  const has = (path: string) => {
    const value = getPath(host, path)
    return typeof value === 'string' && value !== ''
  }
  const any = AI_TRACKING_TAGS.some((tag) => has(tag.path))
  if (any && getPath(host, 'consent.disabled') === true) {
    warnings.push('This site’s cookie banner is turned off because it uses its own consent tool, so that tool decides when these load.')
  }
  if (has('analytics.gtmContainerId') && (has('analytics.gaMeasurementId') || has('analytics.adTags.google-ads'))) {
    warnings.push('Do not also put an Analytics or Google Ads tag in the Tag Manager container: that loads the same measurement twice and counts every visit and conversion twice.')
  }
  return warnings
}

export type AiTrackingWrite =
  | { ok: true; done: string[]; changed: string[]; warnings: string[]; outboxId: string | null }
  | { ok: false; error: string }

/**
 * The tags written, in one transaction that reads the host as it is stored
 * NOW: the member still holds a write role, and only the values that differ
 * from what is stored are written, with a site-wide publish outbox entry
 * beside them so the live site's cached pages are dropped.
 */
export async function writeAiSiteTracking(
  firestore: Firestore,
  input: { hostId: string; uid: string; request: AiTrackingRequest; now: Date },
): Promise<AiTrackingWrite> {
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  return firestore.runTransaction(async (tx): Promise<AiTrackingWrite> => {
    const host = await tx.get(hostRef)
    if (!host.exists) return { ok: false, error: 'Unknown site' }
    if (!holdsSiteKey(host, input.uid, 'site.edit')) return { ok: false, error: AI_TRACKING_ROLE_COPY }
    const data = (host.data() ?? {}) as Record<string, unknown>
    const changes = aiTrackingChanges(input.request)
    const changed = changes.filter((change) => {
      const stored = getPath(data, change.path)
      return change.value === null ? stored != null && stored !== '' : stored !== change.value
    })
    // What the site carries once this lands, for the warnings.
    // Only the two maps the warnings read; both are plain strings and flags.
    const after: Record<string, unknown> = JSON.parse(JSON.stringify({ analytics: data['analytics'] ?? {}, consent: data['consent'] ?? {} }))
    for (const change of changed) {
      const keys = change.path.split('.')
      const leaf = keys.pop() as string
      let node = after as Record<string, unknown>
      for (const key of keys) {
        if (!node[key] || typeof node[key] !== 'object') node[key] = {}
        node = node[key] as Record<string, unknown>
      }
      if (change.value === null) delete node[leaf]
      else node[leaf] = change.value
    }
    const done = changes.map((change) => change.said)
    const warnings = aiTrackingWarnings(after)
    if (!changed.length) return { ok: true, done, changed: [], warnings, outboxId: null }
    const updates: Record<string, unknown> = { updatedAt: input.now }
    for (const change of changed) updates[change.path] = change.value === null ? FieldValue.delete() : change.value
    tx.update(hostRef, updates)
    // The tags are in every page's head, so every cached page is stale.
    const outboxRef = firestore.collection('publishOutbox').doc(createResourceUid())
    tx.set(outboxRef, {
      hostId: input.hostId,
      paths: [SCREEN_ROOT_PATH],
      entireHost: true,
      createdAt: FieldValue.serverTimestamp(),
      attempts: 0,
    })
    return { ok: true, done, changed: changed.map((change) => change.path), warnings, outboxId: outboxRef.id }
  })
}

// ── The step ──────────────────────────────────────────────────────────────

/** Why this member may not change this site's tracking now, or `null`. */
export async function aiTrackingAccessRefusal(
  input: { host: FirebaseFirestore.DocumentSnapshot; uid: string; org: object | null },
  deps: { lockdown?: typeof getLockdownVerdict } = {},
): Promise<string | null> {
  if (!input.host.exists) return 'Unknown site'
  if (!holdsSiteKey(input.host, input.uid, 'site.edit')) return AI_TRACKING_ROLE_COPY
  const locked = await (deps.lockdown ?? getLockdownVerdict)({
    staff: false,
    uid: input.uid,
    org: input.org as never,
    host: input.host.data() as never,
    intent: 'write',
  })
  return locked ? AI_TRACKING_LOCKED_COPY : null
}

/** The output's note: what changed, that it is live, how consent gates it, and what was not done. */
export function aiTrackingOutputNote(done: readonly string[], warnings: readonly string[], notDone: readonly string[], changedAny: boolean): string {
  const did = done.length
    ? `${done.join(' ')} Live now, in ${AI_TRACKING_WHERE}.${changedAny ? '' : ' It already was, so nothing was written.'}`
    : 'Nothing needed changing.'
  // The card's own promise, true of a tag whoever saved it.
  const consent = done.length ? ' Tags load only where a visitor’s cookie consent allows them.' : ''
  const warn = warnings.length ? ` ${warnings.join(' ')}` : ''
  const not = notDone.length ? ` Not done: ${notDone.join(' ')}` : ''
  return `${did}${consent}${warn}${not}`.slice(0, 1_000)
}

export interface AiJobTrackingStepDeps {
  write?: typeof writeAiSiteTracking
  lockdown?: typeof getLockdownVerdict
  dropCache?: typeof dropPluginSiteCache
}

export function createAiJobTrackingStep(deps: AiJobTrackingStepDeps = {}): AiJobStepRunner {
  const write = deps.write ?? writeAiSiteTracking
  const dropCache = deps.dropCache ?? dropPluginSiteCache
  return async ({ job, now, firestore, org, modelFor }): Promise<AiJobStepOutcome> => {
    // No model is asked: the outcome records the edit step's at no cost.
    const model = modelFor?.('job.edit') ?? aiJobEditModel()
    const unspent = (failure: string): AiJobStepOutcome => ({ ...aiUnspentOutcome(model), failure })
    const hostId = job.hostId
    if (!hostId) return unspent(AI_TRACKING_NO_SITE_COPY)
    const read = aiTrackingRequestOf(job.inputs)
    if (aiTrackingRequestEmpty(read.request)) return unspent([AI_TRACKING_NOTHING_COPY, ...read.problems].join(' '))
    const orgData = (org ?? ((await firestore.collection('orgs').doc(job.orgId).get()).data() ?? null)) as Record<string, unknown> | null
    const host = await firestore.collection('hosts').doc(hostId).get()
    const refused = await aiTrackingAccessRefusal({ host, uid: job.createdBy, org: orgData }, { lockdown: deps.lockdown })
    if (refused) return aiUnspentOutcome(model, { review: aiLimitReview(refused) })
    const written = await write(firestore, { hostId, uid: job.createdBy, request: read.request, now })
    if (written.ok === false) return unspent(written.error)
    if (written.outboxId) {
      // The live site's cached pages go now; the outbox entry stays for the
      // drain unless the drop certainly happened.
      const dropped = await dropCache({ hostIds: [hostId], reason: 'AI build changed site tracking' }).catch(() => ({ complete: false }))
      if (dropped.complete) await firestore.collection('publishOutbox').doc(written.outboxId).delete().catch(() => undefined)
    }
    const output: AiJobOutput = {
      resource: 'tracking',
      id: AI_TRACKING_OUTPUT_ID,
      hostId,
      hostSubdomain: (typeof host.get('subdomain') === 'string' && host.get('subdomain')) || null,
      label: 'Site tracking',
      note: aiTrackingOutputNote(written.done, written.warnings, read.problems, written.changed.length > 0),
    }
    return aiUnspentOutcome(model, { outputs: [output] })
  }
}

export const runAiJobTrackingStep = createAiJobTrackingStep()

// ── Admission ─────────────────────────────────────────────────────────────

export interface AiTrackingJobAdmissionDeps {
  ownerOf?: typeof resolveOrgIdForHost
  lockdown?: typeof getLockdownVerdict
}

/**
 * A tracking change is admitted on a site of the job's own org, for a member
 * who may write its settings now, where the request names at least one tag
 * this can set or remove. Refused in those words before anything is written.
 */
export function createAiTrackingJobAdmission(deps: AiTrackingJobAdmissionDeps = {}): AiJobAdmission {
  const ownerOf = deps.ownerOf ?? resolveOrgIdForHost
  return async (context): Promise<AiJobAdmissionRefusal | null> => {
    if (!context.hostId) return { status: 400, error: AI_TRACKING_NO_SITE_COPY }
    const owner = await ownerOf(context.hostId)
    if (!owner || owner !== context.orgId) return { status: 404, error: 'Unknown site' }
    const host = await context.firestore.collection('hosts').doc(context.hostId).get()
    const refused = await aiTrackingAccessRefusal({ host, uid: context.uid ?? '', org: context.org }, { lockdown: deps.lockdown })
    if (refused) return { status: 403, error: refused }
    const read = aiTrackingRequestOf(context.inputs as Record<string, unknown>)
    return aiTrackingRequestEmpty(read.request) ? { status: 400, error: [AI_TRACKING_NOTHING_COPY, ...read.problems].join(' ') } : null
  }
}

export const aiTrackingJobAdmission = createAiTrackingJobAdmission()

/** Registers the tracking step and its door (AGL-3751). */
export function registerAiTrackingJob(): void {
  registerAiJobStep(AI_TRACKING_KIND, runAiJobTrackingStep, { minimumMs: AI_JOB_TRACKING_STEP_MINIMUM_MS })
  registerAiJobAdmission(AI_TRACKING_KIND, aiTrackingJobAdmission)
}
