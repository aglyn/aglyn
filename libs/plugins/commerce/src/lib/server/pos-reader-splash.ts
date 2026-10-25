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

import { createHash } from 'node:crypto'
import { parseMediaCdnScope, type MediaCdnScope } from '@aglyn/aglyn/app-utils/media-cdn-scope'
import {
  formatMediaRef,
  isMediaCdnPath,
  MEDIA_CDN_ROUTE,
  mediaRefFromStorageUrl,
  parseMediaRef,
  resolveMediaSrc,
} from '@aglyn/aglyn/app-utils/media-ref'
import { checkEntitlement, resolveBrandingProfile } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  isPosReaderSplashChoice,
  POS_READER_SPLASH_DEVICE_TYPES,
  POS_READER_SPLASH_FAMILIES,
  POS_READER_SPLASH_SOURCE_MAX_BYTES,
  POS_READER_SPLASH_SOURCE_TYPES,
  posReaderSplashArtworkProblem,
  posReaderSplashEffectiveChoice,
  type PosReaderSplashChoice,
  type PosReaderSplashFamily,
  type PosReaderSplashFamilyId,
  type PosReaderSplashSetting,
  type PosReaderSplashStatus,
} from '../model/pos-reader-splash'
import { authorizePosStaff, posRequestBody } from './pos-auth'
import {
  PosReaderSplashRenderError,
  posReaderSplashImageFacts,
  renderPosReaderSplash,
  type RenderedPosReaderSplash,
} from './pos-reader-splash-render'
import { POS_STRIPE_VERSION, posTerminalAvailable } from './pos-stripe'
import { savePosReaderConfiguration } from './pos-terminal'

/*==========================================
 * A STORE'S CARD READERS SHOW ITS START-UP SCREEN (AGL-4048).
 *
 * ## Where it lives
 *
 * Readers and Locations are the PLATFORM's (the destination-charge model,
 * `pos-terminal.ts`), one Location per site. The screen is set on that
 * site's one Terminal Configuration, the one reader tipping already uses,
 * per device type (`stripe_s700`, `stripe_s710`, `bbpos_wisepos_e`), from a
 * File uploaded to Stripe with purpose `terminal_reader_splashscreen`.
 *
 * The platform's account-default configuration is NEVER given a screen. A
 * Location without an override inherits it, so an account default would put
 * the platform's brand on a white-label store's readers, which is the one
 * thing the white-label rule forbids. Staff's default screen is applied per
 * Location instead, to the stores that use it.
 *
 * ## What is applied
 *
 * `hosts/{hostId}/terminal/config.splash` holds the store's choice
 * (`model/pos-reader-splash.ts`); the screen applied is described by a KEY
 * built from cheap metadata only: the choice, the platform default's
 * version, the logo's address and its asset's content digest, the picked
 * image's. `splashAppliedKey` records the last key that reached Stripe, so
 * applying again with nothing changed makes no Stripe call at all, and a
 * changed logo, a new staff default or a new choice makes exactly one round
 * of uploads. Every upload and the first configuration write are keyed by
 * content, so a retried apply never makes a second file or configuration.
 *
 * ## When it is applied
 *
 *   - when the store's Location is created (its first reader);
 *   - when the POS devices card saves a choice, or opens and finds the key
 *     stale (a logo changed since);
 *   - when staff change the default, for every store with a Location
 *     (`pos-reader-splash-admin.ts`).
 *
 * Never on the payment path: drawing and uploading takes a second or two,
 * and a reader with an older screen still takes the payment.
 *
 * ## Test mode first
 *
 * Gated by `posTerminalAvailable()`: always in test mode, in live mode only
 * once `STRIPE_TERMINAL_LIVE_ENABLED` is on, like every reader control.
 *=========================================*/

/** Raised when the drawing or the Location changes how keys are built. */
const RENDER_VERSION = 'v1'

/** `platformSettings/posReaderSplash`: staff's default screen. */
export const POS_READER_SPLASH_SETTINGS_ID = 'posReaderSplash'

/** One family's default screen, as staff uploaded it. */
export interface PlatformSplashImage {
  storagePath: string
  sha256: string
  contentType: 'image/png' | 'image/jpeg'
  bytes: number
  uploadedAtMs: number
  uploadedBy?: string
}

export interface PlatformSplashDoc {
  families?: Partial<Record<PosReaderSplashFamilyId, PlatformSplashImage>>
  updatedAtMs?: number
}

const firestore = () => firebaseAdmin.app().firestore()

function terminalConfigRef(hostId: string) {
  return firestore().collection('hosts').doc(hostId).collection('terminal').doc('config')
}

export function platformSplashRef() {
  return firestore().collection('platformSettings').doc(POS_READER_SPLASH_SETTINGS_ID)
}

export function posReaderSplashBucket() {
  return firebaseAdmin
    .app()
    .storage()
    .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || undefined)
}

export async function readPlatformSplash(): Promise<PlatformSplashDoc> {
  const snapshot = await platformSplashRef().get()
  return (snapshot.exists ? snapshot.data() : {}) as PlatformSplashDoc
}

/** The default is usable once the S700/S710 screen is uploaded; the smaller one is drawn from it if absent. */
export function platformSplashReady(doc: PlatformSplashDoc): boolean {
  return Boolean(doc.families?.['portrait-large']?.storagePath)
}

function platformSplashVersion(doc: PlatformSplashDoc): string {
  return POS_READER_SPLASH_FAMILIES.map((family) => doc.families?.[family.id]?.sha256 ?? '-').join('.')
}

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

const cleanString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/*==========================================
 * READING A SOURCE IMAGE.
 *
 * A media value is read from STORAGE, never fetched, when it names this
 * site's library or its org's: the document must be live, not private,
 * visible to this site, its scope not locked and the asset not quarantined,
 * and the object path inside the scope's media prefix (the rules the media
 * CDN serves by). An https address outside the libraries is fetched only from
 * a public address, pinned against DNS rebinding, with no redirects, a
 * timeout and a size cap.
 *=========================================*/

interface LocatedAsset {
  kind: 'asset'
  scope: MediaCdnScope
  scopeSegment: string
  mediaId: string
  doc: Record<string, unknown>
  /** What changes when the asset's bytes do. */
  version: string
}

interface LocatedUrl {
  kind: 'url'
  url: string
  version: string
}

type LocatedSource = LocatedAsset | LocatedUrl

async function locateMediaAsset(
  scopeSegment: string,
  mediaId: string,
  hostId: string,
  orgId: string,
): Promise<LocatedAsset | null> {
  const scope = parseMediaCdnScope(scopeSegment)
  if (!scope || !/^[A-Za-z0-9_-]{1,64}$/.test(mediaId)) return null
  const owned = scope.isOrg ? scope.scopeId === orgId : scope.scopeId === hostId
  if (!owned) return null
  const snapshot = await firestore()
    .collection(scope.isOrg ? 'orgs' : 'hosts')
    .doc(scope.scopeId)
    .collection('media')
    .doc(mediaId)
    .get()
  const doc = (snapshot.exists ? snapshot.data() : null) as Record<string, unknown> | null
  if (!doc || doc['deletedAt'] || doc['private']) return null
  if (scope.isOrg && !visibleToHost(doc['visibleTo'] as string[] | undefined, hostId)) return null
  if (!/^image\//.test(String(doc['contentType'] ?? ''))) return null
  if (typeof doc['sizeBytes'] === 'number' && doc['sizeBytes'] > POS_READER_SPLASH_SOURCE_MAX_BYTES) return null
  const version =
    cleanString(doc['contentSha256']) ||
    cleanString(doc['contentHash']) ||
    String(doc['updatedAtMs'] ?? doc['sizeBytes'] ?? '')
  return { kind: 'asset', scope, scopeSegment, mediaId, doc, version }
}

/** Where a stored logo or image value lives, or null when it cannot be read. */
async function locateSource(value: string, hostId: string, orgId: string): Promise<LocatedSource | null> {
  const stored = parseMediaRef(value) ? value : mediaRefFromStorageUrl(value)
  const ref = stored ? parseMediaRef(stored) : null
  if (ref) return locateMediaAsset(ref.scope, ref.mediaId, hostId, orgId)
  if (isMediaCdnPath(value)) {
    const rest = value.slice(`${MEDIA_CDN_ROUTE}/`.length).split('?')[0]
    const slash = rest.indexOf('/')
    if (slash <= 0) return null
    return locateMediaAsset(rest.slice(0, slash), rest.slice(slash + 1), hostId, orgId)
  }
  // `isMediaCdnPath` narrows a string it refuses to `never`; the value is still the string.
  const address: string = value as string
  if (/^https:\/\//.test(address) && address.length <= 2000) return { kind: 'url', url: address, version: address }
  return null
}

async function readAssetBytes(asset: LocatedAsset): Promise<Buffer | null> {
  const { mediaCdnServeBlock, mediaStoragePathInScope } = await import('./pos-reader-splash-server')
  const blocked = await mediaCdnServeBlock(asset.scope, {
    contentSha256: typeof asset.doc['contentSha256'] === 'string' ? (asset.doc['contentSha256'] as string) : undefined,
    contentHash: typeof asset.doc['contentHash'] === 'string' ? (asset.doc['contentHash'] as string) : undefined,
    scopeSegment: asset.scopeSegment,
    mediaId: asset.mediaId,
  })
  if (blocked) return null
  const objectPath = mediaStoragePathInScope({
    storagePath: asset.doc['storagePath'],
    base: `${asset.scope.isOrg ? 'orgs' : 'hosts'}/${asset.scope.scopeId}`,
    mediaId: asset.mediaId,
  })
  const [buffer] = (await posReaderSplashBucket().file(objectPath).download()) as [Buffer]
  return buffer.length > POS_READER_SPLASH_SOURCE_MAX_BYTES ? null : buffer
}

const FETCH_TIMEOUT_MS = 8000

async function fetchPublicImage(url: string): Promise<Buffer | null> {
  const { createPinnedDispatcher, resolvePublicIp } = await import('./pos-reader-splash-server')
  const pinnedIp = await resolvePublicIp(new URL(url).hostname)
  if (!pinnedIp) return null
  const dispatcher = createPinnedDispatcher(pinnedIp)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const init = { redirect: 'error' as const, signal: controller.signal, dispatcher }
    const response = await fetch(url, init as RequestInit)
    if (!response.ok) return null
    if (!/^image\//.test(response.headers.get('content-type') ?? '')) return null
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > POS_READER_SPLASH_SOURCE_MAX_BYTES) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.length > POS_READER_SPLASH_SOURCE_MAX_BYTES ? null : buffer
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    ;(dispatcher as { close?: () => Promise<void> }).close?.().catch(() => undefined)
  }
}

async function readSourceBytes(source: LocatedSource): Promise<Buffer | null> {
  return source.kind === 'asset' ? readAssetBytes(source) : fetchPublicImage(source.url)
}

/*==========================================
 * WHAT A STORE SHOWS.
 *=========================================*/

/**
 * The workspace's own logo: a white-label workspace's brand logo first,
 * then the logo on its organization profile. Never the platform's: the
 * resolved brand profile falls back to the platform's own logo for a
 * workspace without a brand, so its `logoUrl` is not read here.
 */
export function workspaceLogoValue(org: Record<string, any> | null, whiteLabel: boolean): string | null {
  const brand = whiteLabel ? cleanString(org?.['brandingProfile']?.['logoUrl']) : ''
  return brand || cleanString(org?.['logoUrl']) || null
}

type SplashSource =
  | { mode: 'platform'; doc: PlatformSplashDoc }
  | { mode: 'logo' | 'artwork'; located: LocatedSource }

export interface PosReaderSplashPlan {
  choice: PosReaderSplashChoice | null
  effectiveChoice: PosReaderSplashChoice
  whiteLabel: boolean
  productName: string
  platformReady: boolean
  logoValue: string | null
  image: { mediaScope: string; mediaId: string } | null
  /** `none` when the readers show Stripe's standard screen. */
  key: string
  problem: string | null
  source: SplashSource | null
}

const NO_LOGO = 'Add a logo to your organization profile to show it on your card readers.'
const NO_IMAGE = 'The image picked for your card readers is no longer in your media library. Choose another.'

export async function planPosReaderSplash(
  hostId: string,
  org: Record<string, any> | null,
  config: Record<string, any> | undefined,
  platform?: PlatformSplashDoc,
): Promise<PosReaderSplashPlan> {
  const orgId = String(org?.['id'] ?? '')
  const whiteLabel = checkEntitlement(org as any, 'whiteLabel')
  const productName = resolveBrandingProfile(org as any).productName
  const setting = (config?.['splash'] ?? null) as PosReaderSplashSetting | null
  const choice = isPosReaderSplashChoice(setting?.choice) ? setting.choice : null
  const effectiveChoice = posReaderSplashEffectiveChoice(choice, whiteLabel)
  const doc = platform ?? (await readPlatformSplash())
  const logoValue = workspaceLogoValue(org, whiteLabel)
  const image =
    setting?.mediaScope && setting?.mediaId ? { mediaScope: setting.mediaScope, mediaId: setting.mediaId } : null
  const base = {
    choice,
    effectiveChoice,
    whiteLabel,
    productName,
    platformReady: platformSplashReady(doc),
    logoValue,
    image,
  }
  if (effectiveChoice === 'platform') {
    // The white-label rule is in `posReaderSplashEffectiveChoice`; this is
    // the guard behind it, because this branch is the platform's brand.
    if (whiteLabel || !platformSplashReady(doc)) return { ...base, key: 'none', problem: null, source: null }
    return {
      ...base,
      key: `platform:${RENDER_VERSION}:${platformSplashVersion(doc)}`,
      problem: null,
      source: { mode: 'platform', doc },
    }
  }
  if (effectiveChoice === 'logo') {
    const located = logoValue ? await locateSource(logoValue, hostId, orgId) : null
    if (!located) return { ...base, key: 'none', problem: NO_LOGO, source: null }
    return {
      ...base,
      key: `logo:${RENDER_VERSION}:${digest(`${logoValue}|${located.version}`).slice(0, 24)}`,
      problem: null,
      source: { mode: 'logo', located },
    }
  }
  const located = image ? await locateMediaAsset(image.mediaScope, image.mediaId, hostId, orgId) : null
  if (!located) return { ...base, key: 'none', problem: NO_IMAGE, source: null }
  return {
    ...base,
    key: `image:${RENDER_VERSION}:${digest(`${image?.mediaScope}/${image?.mediaId}|${located.version}`).slice(0, 24)}`,
    problem: null,
    source: { mode: 'artwork', located },
  }
}

async function loadSharpFactory(): Promise<any> {
  const { loadSharp } = await import('./pos-reader-splash-server')
  return loadSharp()
}

/** Each family's screen for the plan, ready for Stripe. */
async function drawScreens(
  source: SplashSource,
): Promise<Record<PosReaderSplashFamilyId, RenderedPosReaderSplash>> {
  const sharp = await loadSharpFactory()
  const screens = {} as Record<PosReaderSplashFamilyId, RenderedPosReaderSplash>
  if (source.mode === 'platform') {
    const bucket = posReaderSplashBucket()
    const read = async (image: PlatformSplashImage) =>
      ((await bucket.file(image.storagePath).download()) as [Buffer])[0]
    const large = source.doc.families?.['portrait-large'] as PlatformSplashImage
    const largeBody = await read(large)
    for (const family of POS_READER_SPLASH_FAMILIES) {
      const own = source.doc.families?.[family.id]
      // Staff's own screen for the family is sent as uploaded: it was checked
      // against Stripe's rules for exactly this family then. A family staff
      // left empty is drawn from the S700/S710 screen, the same 9:16.
      screens[family.id] = own?.storagePath
        ? { body: own === large ? largeBody : await read(own), contentType: own.contentType }
        : await renderPosReaderSplash({ source: largeBody, family, mode: 'artwork', sharp })
    }
    return screens
  }
  const bytes = await readSourceBytes(source.located)
  if (!bytes) throw new PosReaderSplashRenderError('That image could not be read.')
  if (source.mode === 'artwork') {
    const facts = await posReaderSplashImageFacts(sharp, bytes)
    const problem = posReaderSplashArtworkProblem({
      contentType: facts?.contentType || null,
      bytes: bytes.length,
      width: facts?.width ?? 0,
      height: facts?.height ?? 0,
    })
    if (problem) throw new PosReaderSplashRenderError(problem)
  }
  for (const family of POS_READER_SPLASH_FAMILIES) {
    screens[family.id] = await renderPosReaderSplash({ source: bytes, family, mode: source.mode, sharp })
  }
  return screens
}

/** One screen uploaded to Stripe, keyed by its content so a retry makes no second file. */
async function uploadSplashFile(
  hostId: string,
  family: PosReaderSplashFamily,
  screen: RenderedPosReaderSplash,
): Promise<string> {
  const form = new FormData()
  form.append('purpose', 'terminal_reader_splashscreen')
  const extension = screen.contentType === 'image/png' ? 'png' : 'jpg'
  form.append('file', new Blob([new Uint8Array(screen.body)], { type: screen.contentType }), `start-up-${family.id}.${extension}`)
  const response = await fetch('https://files.stripe.com/v1/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Stripe-Version': POS_STRIPE_VERSION,
      'Idempotency-Key': `pos-splash-file:${hostId}:${family.id}:${digest(screen.body).slice(0, 32)}`,
    },
    body: form,
  })
  const body = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
  if (!response.ok || !body.id) {
    throw new PosReaderSplashRenderError(body.error?.message || 'Stripe did not accept the start-up screen.')
  }
  return String(body.id)
}

/** The org that owns the site, with its id on it (`planPosReaderSplash` reads it). */
export async function ownerOrgOf(hostId: string): Promise<Record<string, any> | null> {
  const owner = await getOrgForHost(hostId).catch(() => null)
  if (!owner?.org) return null
  return { ...(owner.org as Record<string, any>), id: String((owner.org as any).id ?? owner.orgId ?? '') }
}

export interface PosReaderSplashApplyResult {
  outcome: 'unchanged' | 'applied' | 'cleared' | 'skipped' | 'failed'
  plan: PosReaderSplashPlan | null
  problem: string | null
}

/**
 * Puts the store's start-up screen on its readers' configuration when it
 * changed since it was last applied. Never throws: a failure is recorded on
 * the store's terminal document and returned, and the readers keep their
 * previous screen.
 */
export async function applyPosReaderSplash(
  hostId: string,
  options: { org?: Record<string, any> | null; platform?: PlatformSplashDoc; force?: boolean } = {},
): Promise<PosReaderSplashApplyResult> {
  if (!posTerminalAvailable()) return { outcome: 'skipped', plan: null, problem: null }
  const ref = terminalConfigRef(hostId)
  const config = (await ref.get()).data() as Record<string, any> | undefined
  if (!config?.['stripeLocationId']) return { outcome: 'skipped', plan: null, problem: null }
  const org = options.org !== undefined ? options.org : await ownerOrgOf(hostId)
  const plan = await planPosReaderSplash(hostId, org, config, options.platform)
  const applied = typeof config['splashAppliedKey'] === 'string' ? (config['splashAppliedKey'] as string) : null
  // Nothing to show and nothing ever shown: the readers already show
  // Stripe's standard screen, and no Stripe call is needed to keep it.
  if (plan.key === 'none' && (applied === null || applied === 'none') && !options.force) {
    return { outcome: 'unchanged', plan, problem: plan.problem }
  }
  if (plan.key === applied && !options.force) return { outcome: 'unchanged', plan, problem: plan.problem }
  try {
    const params: Record<string, string> = {}
    if (plan.key === 'none' || !plan.source) {
      // An empty value unsets the device's screen on this configuration.
      for (const deviceType of POS_READER_SPLASH_DEVICE_TYPES) params[deviceType] = ''
    } else {
      const screens = await drawScreens(plan.source)
      for (const family of POS_READER_SPLASH_FAMILIES) {
        const fileId = await uploadSplashFile(hostId, family, screens[family.id])
        for (const deviceType of family.deviceTypes) params[`${deviceType}[splashscreen]`] = fileId
      }
    }
    const saved = await savePosReaderConfiguration(hostId, params, `splash:${digest(plan.key).slice(0, 24)}`)
    if (!saved.ok) throw new PosReaderSplashRenderError('Stripe did not accept the start-up screen. Try again.')
    await ref.set(
      {
        splashAppliedKey: plan.key,
        splashAppliedAtMs: Date.now(),
        splashProblem: firebaseAdmin.firestore.FieldValue.delete(),
      },
      { merge: true },
    )
    return { outcome: plan.key === 'none' ? 'cleared' : 'applied', plan, problem: plan.problem }
  } catch (error) {
    const problem =
      error instanceof PosReaderSplashRenderError ? error.message : 'The start-up screen could not be applied. Try again.'
    if (!(error instanceof PosReaderSplashRenderError)) console.error('[pos-reader-splash]', hostId, error)
    await ref.set({ splashProblem: problem, splashFailedAtMs: Date.now() }, { merge: true }).catch(() => undefined)
    return { outcome: 'failed', plan, problem }
  }
}

/*==========================================
 * `POST /api/commerce/pos-reader-splash`: the POS devices card's setting.
 *
 *   status  the store's choice and what it shows (re-applies a stale one)
 *   save    { choice, mediaScope?, mediaId? } — store and apply
 *
 * Gated like a sale (`authorizePosStaff`), as every reader control is.
 *=========================================*/

function statusOf(
  plan: PosReaderSplashPlan | null,
  config: Record<string, any> | undefined,
  hostId: string,
  problem: string | null,
): PosReaderSplashStatus {
  return {
    available: posTerminalAvailable(),
    choice: plan?.choice ?? null,
    effectiveChoice: plan?.effectiveChoice ?? 'platform',
    whiteLabel: plan?.whiteLabel ?? false,
    productName: plan?.productName ?? '',
    platformReady: plan?.platformReady ?? false,
    logoUrl: plan?.logoValue ? resolveMediaSrc(plan.logoValue, { hostId }) ?? null : null,
    image: plan?.image
      ? { ...plan.image, url: resolveMediaSrc(formatMediaRef(plan.image.mediaScope, plan.image.mediaId), { hostId }) ?? null }
      : null,
    locationReady: Boolean(config?.['stripeLocationId']),
    appliedAtMs: typeof config?.['splashAppliedAtMs'] === 'number' ? config['splashAppliedAtMs'] : null,
    problem: problem ?? (typeof config?.['splashProblem'] === 'string' ? config['splashProblem'] : null),
  }
}

async function currentStatus(hostId: string, org: Record<string, any> | null): Promise<PosReaderSplashStatus> {
  const result = await applyPosReaderSplash(hostId, { org })
  const config = (await terminalConfigRef(hostId).get()).data() as Record<string, any> | undefined
  const plan = result.plan ?? (await planPosReaderSplash(hostId, org, config))
  return statusOf(plan, config, hostId, result.outcome === 'failed' ? result.problem : plan.problem)
}

export const posReaderSplashHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = posRequestBody(req)
  const hostId = String(body['hostId'] ?? '')
  const gate = await authorizePosStaff(req, hostId)
  if ('error' in gate) return res.status(gate.status).json({ error: gate.error })
  const staff = gate.staff
  const org = staff.org ? { ...staff.org, id: staff.orgId } : null
  const action = String(body['action'] ?? '')
  try {
    if (action === 'status') return res.status(200).json(await currentStatus(hostId, org))
    if (action !== 'save') return res.status(400).json({ error: 'Unknown action' })
    if (!posTerminalAvailable()) return res.status(409).json({ error: 'Card readers are not available yet.' })
    const choice = body['choice']
    if (!isPosReaderSplashChoice(choice)) return res.status(400).json({ error: 'Choose what your readers show.' })
    const whiteLabel = checkEntitlement(staff.org as any, 'whiteLabel')
    if (choice === 'platform' && whiteLabel) {
      return res.status(400).json({ error: 'Choose your logo or your own image.' })
    }
    const setting: PosReaderSplashSetting = { choice, updatedAtMs: Date.now(), updatedBy: staff.uid }
    if (choice === 'image') {
      const mediaScope = String(body['mediaScope'] ?? '')
      const mediaId = String(body['mediaId'] ?? '')
      const located = await locateMediaAsset(mediaScope, mediaId, hostId, staff.orgId)
      if (!located) return res.status(400).json({ error: 'Choose an image from your media library.' })
      const contentType = String(located.doc['contentType'] ?? '')
      if (!POS_READER_SPLASH_SOURCE_TYPES.includes(contentType)) {
        return res.status(400).json({ error: 'Choose a PNG, JPEG or WebP image.' })
      }
      setting.mediaScope = mediaScope
      setting.mediaId = mediaId
    }
    await terminalConfigRef(hostId).set({ splash: setting }, { merge: true })
    return res.status(200).json(await currentStatus(hostId, org))
  } catch (error) {
    console.error('[pos-reader-splash]', action, error)
    return res.status(500).json({ error: 'The start-up screen could not be updated' })
  }
}
