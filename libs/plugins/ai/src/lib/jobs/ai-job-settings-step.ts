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

import { supportedTimeZones } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { holdsSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import { orgPermissionLabel } from '@aglyn/aglyn/app-utils/org-permissions'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { inheritedMediaAlt } from '@aglyn/aglyn/app-utils/media-metadata'
import { mediaNodeSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { SCREEN_ROOT_PATH } from '@aglyn/aglyn/app-utils/screen-route'
import { siteLanguageCode } from '@aglyn/aglyn/app-utils/seo-locale'
import { isSeoTitleVariable } from '@aglyn/aglyn/app-utils/seo-title-variables'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import type { PluginAiCapabilityArgsSchema } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { changesProjectedHostFields, syncHostProjectionForMembers } from '@aglyn/tenant-data-admin/server/host-memberships'
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
 * The `settings` step (AGL-3748): a change to what a member can change in the
 * site's settings — its name, its search defaults, its favicon, logo and
 * social image from the media library, its language, its time zone, its
 * contact details and its consent banner's mode — as a first-class build
 * operation, so "rename my site to Juniper Clay Studio", "make the site
 * Spanish" or "set the SEO description" is one item on Assist's plan card.
 *
 * NO MODEL. The planner already wrote the values as the item's arguments;
 * this checks each against the rule the console's own control holds it to
 * and writes it, so it costs no credits.
 *
 * ── Only the console's own fields ────────────────────────────────────────
 *
 * Every field written is one a settings card or form writes, under the same
 * name and to the same limit: `displayName` (Admin → General, 30), `seo.title`
 * (60), `seo.description` (155), `seo.separator` (3), `seo.titlePattern`
 * (120, its own variables only), `seo.entity.name`, `seo.entity.description`
 * (300), `seo.entity.telephone`, `business.supportEmail` and
 * `business.address` (the Business details card), `locales`/`defaultLocale`
 * (the Languages card), `timeZone` (one of the zones the console offers),
 * `consent.mode` (the consent banner card), and `seo.favicon`, `logoUrl` and
 * `seo.image` (with its size and alt) written as the media pickers write
 * them, through `mediaNodeSrc`.
 *
 * NEVER: the address (subdomain, domains), plugins, members and roles,
 * billing, lockdown, deletion, search engine indexing, analytics and
 * advertising ids, verification tokens, or turning the consent banner off.
 * Those are not arguments, so the planner cannot ask for them.
 *
 * ── Live on confirm ──────────────────────────────────────────────────────
 *
 * A setting has no draft: the console saves it straight to the host
 * document, and the tenant renders it from there. So does this, once the
 * person confirms the plan (Zach, 2026-10-12: live on confirm). The write
 * drops the site's cached pages as the console's door does
 * (`host-document-writes.ts`), with a site-wide publish outbox entry in the
 * same transaction for the drain to fire if the drop does not land.
 *
 * ── Who may ──────────────────────────────────────────────────────────────
 *
 * The Firestore rules' own for these keys (`canWriteHostContent` and
 * `hostWritesFrozen`): a member with a write role on the site (admin, editor
 * or author), while no lockdown freezes the site, its org or the platform.
 * Asked at the door, again before the write, and the role once more inside
 * the transaction that writes.
 *
 * ── Idempotent ───────────────────────────────────────────────────────────
 *
 * The transaction compares each value with what is stored and writes only
 * what differs, so a pass asked again writes nothing and announces nothing.
 */

export const AI_SETTINGS_KIND = 'settings' as const

/**
 * ASSUMED: the least time the step needs — the site, the org, up to three
 * media lookups in two libraries, and the one transaction that writes. No
 * model, so it fits an inline door.
 */
export const AI_JOB_SETTINGS_STEP_MINIMUM_MS = 5_000

export const AI_SETTINGS_NO_SITE_COPY = 'Open the site whose settings should change.'
/** Names "Edit site content" (`site.edit`, AGL-4047), never a role. */
export const AI_SETTINGS_ROLE_COPY = `Changing the site’s settings needs the "${orgPermissionLabel('site.edit')}" permission on this site — ask an organization admin.`
export const AI_SETTINGS_LOCKED_COPY = 'This site is not accepting changes right now.'
export const AI_SETTINGS_NOTHING_COPY = 'The request named no site setting this could change.'

/** Where a person finds what the op changed, as the build's notes name it. */
export const AI_SETTINGS_WHERE = 'the site’s Settings'

/** The output's fixed id: one site's settings, whatever changed. */
export const AI_SETTINGS_OUTPUT_ID = 'site'

/** The console's own limits, each from the control that edits the field. */
export const AI_SETTINGS_LIMITS = {
  /** Admin → General, Display name. */
  name: 30,
  /** Setup → SEO, Title. */
  seoTitle: 60,
  /** Setup → SEO, Description. */
  seoDescription: 155,
  /** Setup → SEO, Separator. */
  separator: 3,
  /** Setup → SEO, Title pattern. */
  titlePattern: 120,
  /** Setup → SEO, the publisher's description. */
  businessDescription: 300,
  businessName: 100,
  telephone: 40,
  supportEmail: 254,
  address: 200,
} as const

/** The consent banner card's two modes; turning the banner off is not offered. */
export const AI_SETTINGS_CONSENT_MODES = ['geo', 'strict'] as const

/** The media a setting may name, and the field each is written to. */
export const AI_SETTINGS_MEDIA_ARGS = ['favicon', 'logo', 'socialImage'] as const
export type AiSettingsMediaArg = (typeof AI_SETTINGS_MEDIA_ARGS)[number]

const MEDIA_ARG_NOUNS: Readonly<Record<AiSettingsMediaArg, string>> = {
  favicon: 'favicon',
  logo: 'logo',
  socialImage: 'social image',
}

/** The item's arguments, as the planner fills them in. Every one optional. */
export const AI_SETTINGS_ARGS_SCHEMA: PluginAiCapabilityArgsSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'The site’s name as the console lists it. Visitors see the search title, not this.',
      maxLength: AI_SETTINGS_LIMITS.name,
    },
    seoTitle: {
      type: 'string',
      description: 'The search title pages fall back to, usually the business’s name.',
      maxLength: AI_SETTINGS_LIMITS.seoTitle,
    },
    seoDescription: {
      type: 'string',
      description: 'The search description pages fall back to: one or two plain sentences.',
      maxLength: AI_SETTINGS_LIMITS.seoDescription,
    },
    separator: {
      type: 'string',
      description: 'The character between a page’s name and the site title, such as | or ·.',
      maxLength: AI_SETTINGS_LIMITS.separator,
    },
    titlePattern: {
      type: 'string',
      description: 'How an untitled page is titled, using only {{page.name}}, {{site.separator}} and {{site.name}}.',
      maxLength: AI_SETTINGS_LIMITS.titlePattern,
    },
    businessName: {
      type: 'string',
      description: 'The business’s name as search engines and AI assistants are told it.',
      maxLength: AI_SETTINGS_LIMITS.businessName,
    },
    businessDescription: {
      type: 'string',
      description: 'What the business is, in one sentence (its tagline), as search engines and AI assistants are told it.',
      maxLength: AI_SETTINGS_LIMITS.businessDescription,
    },
    telephone: {
      type: 'string',
      description: 'The business’s phone number, exactly as the person gave it.',
      maxLength: AI_SETTINGS_LIMITS.telephone,
    },
    supportEmail: {
      type: 'string',
      description: 'The contact email pages and emails show, exactly as the person gave it.',
      maxLength: AI_SETTINGS_LIMITS.supportEmail,
    },
    address: {
      type: 'string',
      description: 'The business’s address on one line, exactly as the person gave it.',
      maxLength: AI_SETTINGS_LIMITS.address,
    },
    language: {
      type: 'string',
      description: 'The language the site is in, as a code such as en, es, fr or pt-BR. It does not translate the pages.',
      maxLength: 10,
    },
    timeZone: {
      type: 'string',
      description: 'The site’s time zone as an IANA name, such as America/Chicago.',
      maxLength: 64,
    },
    consentMode: {
      type: 'string',
      description: 'The cookie banner’s mode: geo (asks only where the law requires) or strict (asks every visitor).',
      enum: AI_SETTINGS_CONSENT_MODES,
    },
    favicon: {
      type: 'string',
      description: 'An image already in the media library, by its id or exact file name, for the browser tab icon.',
      maxLength: 200,
    },
    logo: {
      type: 'string',
      description: 'An image already in the media library, by its id or exact file name, for the site’s logo.',
      maxLength: 200,
    },
    socialImage: {
      type: 'string',
      description: 'An image already in the media library, by its id or exact file name, for the card shown when a page is shared.',
      maxLength: 200,
    },
  },
  additionalProperties: false,
}

/** What an item asks, each value read and held to the console's rule. */
export interface AiSettingsRequest {
  name?: string
  seoTitle?: string
  seoDescription?: string
  separator?: string
  titlePattern?: string
  businessName?: string
  businessDescription?: string
  telephone?: string
  supportEmail?: string
  address?: string
  /** A language code the Languages card would accept. */
  language?: string
  timeZone?: string
  consentMode?: (typeof AI_SETTINGS_CONSENT_MODES)[number]
  favicon?: string
  logo?: string
  socialImage?: string
}

export interface AiSettingsRead {
  request: AiSettingsRequest
  /** A sentence per value that could not be used, so the rest still are. */
  problems: string[]
}

const text = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TELEPHONE = /^[+()0-9][0-9 ()+.\-/]{4,38}[0-9)]$/
const PATTERN_VARIABLE = /\{\{\s*([^}]*?)\s*\}\}/g

/** Whether a title pattern names only the variables the renderer knows. */
export function aiSettingsTitlePatternOk(pattern: string): boolean {
  if (/[{}]/.test(pattern.replace(PATTERN_VARIABLE, ''))) return false
  return [...pattern.matchAll(PATTERN_VARIABLE)].every((match) => isSeoTitleVariable(match[1]))
}

/** The item's arguments read: what may be written, and a sentence for each that may not. */
export function aiSettingsRequestOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiSettingsRead {
  const request: AiSettingsRequest = {}
  const problems: string[] = []
  const bounded = (key: keyof typeof AI_SETTINGS_LIMITS, noun: string) => {
    const value = text(inputs?.[key])
    if (!value) return
    if (value.length > AI_SETTINGS_LIMITS[key]) {
      problems.push(`The ${noun} is longer than ${AI_SETTINGS_LIMITS[key]} characters.`)
      return
    }
    request[key] = value
  }
  bounded('name', 'site name')
  bounded('seoTitle', 'search title')
  bounded('seoDescription', 'search description')
  bounded('separator', 'title separator')
  bounded('businessName', 'business name')
  bounded('businessDescription', 'business description')
  bounded('address', 'address')
  bounded('titlePattern', 'title pattern')
  if (request.titlePattern && !aiSettingsTitlePatternOk(request.titlePattern)) {
    problems.push('The title pattern may use only {{page.name}}, {{site.separator}} and {{site.name}}.')
    delete request.titlePattern
  }
  bounded('telephone', 'phone number')
  if (request.telephone && !TELEPHONE.test(request.telephone)) {
    problems.push(`“${request.telephone}” is not a phone number.`)
    delete request.telephone
  }
  bounded('supportEmail', 'contact email')
  if (request.supportEmail && !EMAIL.test(request.supportEmail)) {
    problems.push(`“${request.supportEmail}” is not an email address.`)
    delete request.supportEmail
  }
  const language = text(inputs?.['language'])
  if (language) {
    const locale = siteLanguageCode(language)
    if (locale) request.language = locale
    else problems.push(`“${language}” is not a language code such as es or pt-BR.`)
  }
  const timeZone = text(inputs?.['timeZone'])
  if (timeZone) {
    if (supportedTimeZones().includes(timeZone)) request.timeZone = timeZone
    else problems.push(`“${timeZone}” is not a time zone the site settings offer.`)
  }
  const consentMode = text(inputs?.['consentMode'])
  if (consentMode) {
    if ((AI_SETTINGS_CONSENT_MODES as readonly string[]).includes(consentMode)) {
      request.consentMode = consentMode as AiSettingsRequest['consentMode']
    } else problems.push('The cookie banner’s mode is geo or strict.')
  }
  for (const key of AI_SETTINGS_MEDIA_ARGS) {
    const value = text(inputs?.[key])
    if (value) request[key] = value.slice(0, 200)
  }
  return { request, problems }
}

/** Whether a read request asks for anything at all. */
export function aiSettingsRequestEmpty(request: AiSettingsRequest): boolean {
  return Object.keys(request).length === 0
}

// ── Media ─────────────────────────────────────────────────────────────────

/** A media library row, as a setting may name it. */
export interface AiSettingsMediaRow {
  id: string
  fileName: string
  contentType: string
  url: string | null
  cdnPath: string | null
  contentHash: string | null
  private: boolean
  deleted: boolean
  /** The org library's sites; `undefined` on the site's own library. */
  visibleTo?: readonly string[] | null
  width: number | null
  height: number | null
  alt: string
}

/** The image a setting names, as written to the host. */
export interface AiSettingsMedia {
  src: string
  width: number | null
  height: number | null
  alt: string
  fileName: string
}

function mediaRowOf(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot, org: boolean): AiSettingsMediaRow {
  const data = (doc.data() ?? {}) as Record<string, unknown>
  const number = (value: unknown) => (typeof value === 'number' && value > 0 ? value : null)
  return {
    id: doc.id,
    fileName: String(data['fileName'] ?? ''),
    contentType: String(data['contentType'] ?? ''),
    url: typeof data['url'] === 'string' ? data['url'] : null,
    cdnPath: typeof data['cdnPath'] === 'string' ? data['cdnPath'] : null,
    contentHash: typeof data['contentHash'] === 'string' ? data['contentHash'] : null,
    private: data['private'] === true,
    deleted: data['deletedAt'] != null,
    ...(org ? { visibleTo: Array.isArray(data['visibleTo']) ? (data['visibleTo'] as string[]) : null } : {}),
    width: number(data['width']),
    height: number(data['height']),
    alt: typeof data['alt'] === 'string' ? data['alt'] : '',
  }
}

/**
 * The rows a media name could be, from the site's own library and then its
 * org's: the one whose id it is, else those whose file name it is.
 */
export async function readAiSettingsMediaRows(
  firestore: Firestore,
  input: { hostId: string; orgId: string; source: string },
): Promise<AiSettingsMediaRow[]> {
  const libraries = [
    { ref: firestore.collection('hosts').doc(input.hostId).collection('media'), org: false },
    { ref: firestore.collection('orgs').doc(input.orgId).collection('media'), org: true },
  ]
  const rows: AiSettingsMediaRow[] = []
  for (const library of libraries) {
    if (/^[A-Za-z0-9_-]{1,128}$/.test(input.source)) {
      const byId = await library.ref.doc(input.source).get()
      if (byId.exists) rows.push(mediaRowOf(byId, library.org))
    }
    const byName = await library.ref.where('fileName', '==', input.source).limit(5).get()
    for (const doc of byName.docs) if (!rows.some((row) => row.id === doc.id)) rows.push(mediaRowOf(doc, library.org))
  }
  return rows
}

/**
 * The image a setting names, chosen from the rows read: a public image of
 * this site's library, or of its org's that this site may use, never deleted.
 * Its id wins over a file name; two images of one name are refused in words.
 */
export function aiSettingsMediaOf(
  arg: AiSettingsMediaArg,
  source: string,
  rows: readonly AiSettingsMediaRow[],
  hostId: string,
): AiSettingsMedia | { error: string } {
  const noun = MEDIA_ARG_NOUNS[arg]
  const usable = rows.filter(
    (row) =>
      !row.deleted &&
      !row.private &&
      row.contentType.startsWith('image/') &&
      (row.visibleTo === undefined || visibleToHost(row.visibleTo, hostId)),
  )
  const byId = usable.find((row) => row.id === source)
  const named = usable.filter((row) => row.fileName === source)
  if (!byId && named.length > 1) return { error: `The media library has more than one image called “${source}”; name the one for the ${noun}.` }
  const row = byId ?? named[0]
  if (!row) return { error: `The media library has no image “${source}” this site can use for the ${noun}.` }
  const src = mediaNodeSrc({ url: row.url, cdnPath: row.cdnPath, contentHash: row.contentHash, private: row.private })
  if (!src) return { error: `The image “${source}” has no address the site can show.` }
  return { src, width: row.width, height: row.height, alt: row.alt, fileName: row.fileName || row.id }
}

// ── The write ─────────────────────────────────────────────────────────────

/** One change to the host document, with the sentence that says it was made. */
interface AiSettingsChange {
  path: string
  value: unknown
  said: string
}

const getPath = (data: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined), data)

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * The language change, as the Languages card would save it: a site with no
 * languages, or one, now publishes in this one; a multilingual site that
 * lists it makes it the default. A multilingual site that does not list it
 * is refused, because adding a language is the Languages card's decision.
 */
export function aiSettingsLanguageChanges(
  host: { locales?: unknown; defaultLocale?: unknown },
  language: string,
): AiSettingsChange[] | { error: string } {
  const locales = Array.isArray(host.locales) ? host.locales.filter((one): one is string => typeof one === 'string') : []
  const said = `The site’s language is now ${language}.`
  if (locales.length > 1) {
    if (!locales.includes(language)) {
      return { error: `This site publishes in ${locales.join(', ')}; add ${language} in Settings → Details → Languages first.` }
    }
    return [{ path: 'defaultLocale', value: language, said }]
  }
  return [
    { path: 'locales', value: [language], said },
    { path: 'defaultLocale', value: language, said },
  ]
}

/** Every change the request asks of this host, before comparing with what is stored. */
export function aiSettingsChanges(
  host: Record<string, unknown>,
  request: AiSettingsRequest,
  media: Partial<Record<AiSettingsMediaArg, AiSettingsMedia>>,
): { changes: AiSettingsChange[]; problems: string[] } {
  const changes: AiSettingsChange[] = []
  const problems: string[] = []
  const set = (path: string, value: unknown, said: string) => changes.push({ path, value, said })
  if (request.name) set('displayName', request.name, `The site is now called “${request.name}”.`)
  if (request.seoTitle) set('seo.title', request.seoTitle, `The search title is now “${request.seoTitle}”.`)
  if (request.seoDescription) set('seo.description', request.seoDescription, 'The search description is set.')
  if (request.separator) set('seo.separator', request.separator, `The title separator is now “${request.separator}”.`)
  if (request.titlePattern) set('seo.titlePattern', request.titlePattern, `Untitled pages are now titled “${request.titlePattern}”.`)
  if (request.businessName) set('seo.entity.name', request.businessName, `The business name is now “${request.businessName}”.`)
  if (request.businessDescription) set('seo.entity.description', request.businessDescription, 'The business description is set.')
  if (request.telephone) set('seo.entity.telephone', request.telephone, `The phone number is now ${request.telephone}.`)
  if (request.supportEmail) set('business.supportEmail', request.supportEmail, `The contact email is now ${request.supportEmail}.`)
  if (request.address) set('business.address', request.address, 'The address is set.')
  if (request.timeZone) set('timeZone', request.timeZone, `The site’s time zone is now ${request.timeZone}.`)
  if (request.consentMode) {
    set('consent.mode', request.consentMode, request.consentMode === 'strict' ? 'The cookie banner now asks every visitor.' : 'The cookie banner now asks where the law requires.')
  }
  if (request.language) {
    const language = aiSettingsLanguageChanges(host, request.language)
    if ('error' in language) problems.push(language.error)
    else changes.push(...language)
  }
  if (media.favicon) set('seo.favicon', media.favicon.src, `The favicon is now “${media.favicon.fileName}”.`)
  if (media.logo) set('logoUrl', media.logo.src, `The logo is now “${media.logo.fileName}”.`)
  if (media.socialImage) {
    const image = media.socialImage
    const said = `The social image is now “${image.fileName}”.`
    set('seo.image', image.src, said)
    // Its size and alt, as the Social image card copies them at pick time.
    set('seo.imageWidth', image.width ?? 0, said)
    set('seo.imageHeight', image.height ?? 0, said)
    const savedAlt = getPath(host, 'seo.imageAlt')
    set('seo.imageAlt', inheritedMediaAlt({ placementAlt: savedAlt, assetAlt: image.alt }) ?? (typeof savedAlt === 'string' ? savedAlt : ''), said)
  }
  return { changes, problems }
}

export type AiSettingsWrite =
  | { ok: true; done: string[]; notDone: string[]; changed: string[]; outboxId: string | null }
  | { ok: false; error: string }

/**
 * The settings written, in one transaction that reads the host as it is
 * stored NOW: the member still holds a write role, and only the values that
 * differ from what is stored are written, with a site-wide publish outbox
 * entry beside them so the live site's cached pages are dropped.
 */
export async function writeAiSiteSettings(
  firestore: Firestore,
  input: {
    hostId: string
    uid: string
    request: AiSettingsRequest
    media: Partial<Record<AiSettingsMediaArg, AiSettingsMedia>>
    now: Date
  },
): Promise<AiSettingsWrite> {
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  return firestore.runTransaction(async (tx): Promise<AiSettingsWrite> => {
    const host = await tx.get(hostRef)
    if (!host.exists) return { ok: false, error: 'Unknown site' }
    if (!holdsSiteKey(host, input.uid, 'site.edit')) return { ok: false, error: AI_SETTINGS_ROLE_COPY }
    const data = (host.data() ?? {}) as Record<string, unknown>
    const { changes, problems } = aiSettingsChanges(data, input.request, input.media)
    const changed = changes.filter((change) => !sameValue(getPath(data, change.path), change.value))
    const done = [...new Set(changes.map((change) => change.said))]
    if (!changed.length) return { ok: true, done, notDone: problems, changed: [], outboxId: null }
    const updates: Record<string, unknown> = { updatedAt: input.now }
    for (const change of changed) updates[change.path] = change.value
    tx.update(hostRef, updates)
    // The announce, written down in the save's own transaction: a setting
    // has no address, so it asks for the whole site, as the console's does.
    const outboxRef = firestore.collection('publishOutbox').doc(createResourceUid())
    tx.set(outboxRef, {
      hostId: input.hostId,
      paths: [SCREEN_ROOT_PATH],
      entireHost: true,
      createdAt: FieldValue.serverTimestamp(),
      attempts: 0,
    })
    return { ok: true, done, notDone: problems, changed: changed.map((change) => change.path), outboxId: outboxRef.id }
  })
}

// ── The step ──────────────────────────────────────────────────────────────

/** Why this member may not change this site's settings now, or `null`. */
export async function aiSettingsAccessRefusal(
  input: { host: FirebaseFirestore.DocumentSnapshot; uid: string; org: object | null },
  deps: { lockdown?: typeof getLockdownVerdict } = {},
): Promise<string | null> {
  if (!input.host.exists) return 'Unknown site'
  if (!holdsSiteKey(input.host, input.uid, 'site.edit')) return AI_SETTINGS_ROLE_COPY
  const locked = await (deps.lockdown ?? getLockdownVerdict)({
    staff: false,
    uid: input.uid,
    org: input.org as never,
    host: input.host.data() as never,
    intent: 'write',
  })
  return locked ? AI_SETTINGS_LOCKED_COPY : null
}

/** The output's note: what changed, that it is live, and what was not done. */
export function aiSettingsOutputNote(done: readonly string[], notDone: readonly string[], language: boolean): string {
  // The build's own wording for an item with no draft state (AGL-3745).
  const did = done.length ? `${done.join(' ')} Live now, in ${AI_SETTINGS_WHERE}.` : 'Nothing needed changing.'
  const translate = language ? ' The pages keep the words they have: changing the language does not translate them.' : ''
  const not = notDone.length ? ` Not done: ${notDone.join(' ')}` : ''
  return `${did}${translate}${not}`.slice(0, 1_000)
}

export interface AiJobSettingsStepDeps {
  readMedia?: typeof readAiSettingsMediaRows
  write?: typeof writeAiSiteSettings
  lockdown?: typeof getLockdownVerdict
  dropCache?: typeof dropPluginSiteCache
  syncMemberships?: typeof syncHostProjectionForMembers
}

/** Each media argument resolved to its image, or a sentence for each that cannot be. */
async function mediaOf(
  firestore: Firestore,
  input: { hostId: string; orgId: string; request: AiSettingsRequest },
  readMedia: typeof readAiSettingsMediaRows,
): Promise<{ media: Partial<Record<AiSettingsMediaArg, AiSettingsMedia>>; problems: string[] }> {
  const media: Partial<Record<AiSettingsMediaArg, AiSettingsMedia>> = {}
  const problems: string[] = []
  for (const arg of AI_SETTINGS_MEDIA_ARGS) {
    const source = input.request[arg]
    if (!source) continue
    const rows = await readMedia(firestore, { hostId: input.hostId, orgId: input.orgId, source })
    const found = aiSettingsMediaOf(arg, source, rows, input.hostId)
    if ('error' in found) problems.push(found.error)
    else media[arg] = found
  }
  return { media, problems }
}

export function createAiJobSettingsStep(deps: AiJobSettingsStepDeps = {}): AiJobStepRunner {
  const readMedia = deps.readMedia ?? readAiSettingsMediaRows
  const write = deps.write ?? writeAiSiteSettings
  const dropCache = deps.dropCache ?? dropPluginSiteCache
  const syncMemberships = deps.syncMemberships ?? syncHostProjectionForMembers
  return async ({ job, now, firestore, org, modelFor }): Promise<AiJobStepOutcome> => {
    // No model is asked: the outcome records the edit step's at no cost.
    const model = modelFor?.('job.edit') ?? aiJobEditModel()
    const unspent = (failure: string): AiJobStepOutcome => ({ ...aiUnspentOutcome(model), failure })
    const hostId = job.hostId
    if (!hostId) return unspent(AI_SETTINGS_NO_SITE_COPY)
    const read = aiSettingsRequestOf(job.inputs)
    if (aiSettingsRequestEmpty(read.request)) return unspent([AI_SETTINGS_NOTHING_COPY, ...read.problems].join(' '))
    const orgData = (org ?? ((await firestore.collection('orgs').doc(job.orgId).get()).data() ?? null)) as Record<string, unknown> | null
    const host = await firestore.collection('hosts').doc(hostId).get()
    const refused = await aiSettingsAccessRefusal({ host, uid: job.createdBy, org: orgData }, { lockdown: deps.lockdown })
    if (refused) return aiUnspentOutcome(model, { review: aiLimitReview(refused) })
    const found = await mediaOf(firestore, { hostId, orgId: job.orgId, request: read.request }, readMedia)
    const written = await write(firestore, { hostId, uid: job.createdBy, request: read.request, media: found.media, now })
    if (written.ok === false) return unspent(written.error)
    const notDone = [...read.problems, ...found.problems, ...written.notDone]
    if (!written.done.length) return unspent([AI_SETTINGS_NOTHING_COPY, ...notDone].join(' '))
    if (written.outboxId) {
      // The live site's cached pages go now; the outbox entry stays for the
      // drain unless the drop certainly happened.
      const dropped = await dropCache({ hostIds: [hostId], reason: 'AI build changed site settings' }).catch(() => ({ complete: false }))
      if (dropped.complete) await firestore.collection('publishOutbox').doc(written.outboxId).delete().catch(() => undefined)
    }
    if (changesProjectedHostFields(written.changed)) {
      // Every site list reads the name and favicon members' rows carry, so a
      // new favicon owes the re-fan as much as a new name does (AGL-3972).
      await syncMemberships(job.orgId, hostId).catch((error: unknown) => {
        console.error('ai settings: membership projection not synced', { hostId, jobId: job.$id, error })
      })
    }
    const output: AiJobOutput = {
      resource: 'settings',
      id: AI_SETTINGS_OUTPUT_ID,
      hostId,
      hostSubdomain: (typeof host.get('subdomain') === 'string' && host.get('subdomain')) || null,
      label: 'Site settings',
      note: aiSettingsOutputNote(written.done, notDone, Boolean(read.request.language)),
    }
    return aiUnspentOutcome(model, { outputs: [output] })
  }
}

export const runAiJobSettingsStep = createAiJobSettingsStep()

// ── Admission ─────────────────────────────────────────────────────────────

export interface AiSettingsJobAdmissionDeps {
  ownerOf?: typeof resolveOrgIdForHost
  lockdown?: typeof getLockdownVerdict
}

/**
 * A settings change is admitted on a site of the job's own org, for a member
 * who may write its settings now, where the request names at least one
 * setting this can change. Refused in those words before anything is written.
 */
export function createAiSettingsJobAdmission(deps: AiSettingsJobAdmissionDeps = {}): AiJobAdmission {
  const ownerOf = deps.ownerOf ?? resolveOrgIdForHost
  return async (context): Promise<AiJobAdmissionRefusal | null> => {
    if (!context.hostId) return { status: 400, error: AI_SETTINGS_NO_SITE_COPY }
    const owner = await ownerOf(context.hostId)
    if (!owner || owner !== context.orgId) return { status: 404, error: 'Unknown site' }
    const host = await context.firestore.collection('hosts').doc(context.hostId).get()
    const refused = await aiSettingsAccessRefusal({ host, uid: context.uid ?? '', org: context.org }, { lockdown: deps.lockdown })
    if (refused) return { status: 403, error: refused }
    const read = aiSettingsRequestOf(context.inputs as Record<string, unknown>)
    return aiSettingsRequestEmpty(read.request) ? { status: 400, error: [AI_SETTINGS_NOTHING_COPY, ...read.problems].join(' ') } : null
  }
}

export const aiSettingsJobAdmission = createAiSettingsJobAdmission()

/** Registers the settings step and its door (AGL-3748). */
export function registerAiSettingsJob(): void {
  registerAiJobStep(AI_SETTINGS_KIND, runAiJobSettingsStep, { minimumMs: AI_JOB_SETTINGS_STEP_MINIMUM_MS })
  registerAiJobAdmission(AI_SETTINGS_KIND, aiSettingsJobAdmission)
}

