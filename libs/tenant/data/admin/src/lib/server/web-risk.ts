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


/*==========================================
 * GOOGLE WEB RISK (AGL-3451): the lookup behind the link reputation screen.
 *
 * `@aglyn/shared-util-email/link-reputation` decides which hosts are foreign
 * and turns a listing into a strong `web-risk-link` signal. This is the store
 * half: the `uris.search` client, the cache, the switches.
 *
 * ## The client
 *
 * {@link WebRiskClient} is the contract: one URI in, the threat types it is
 * listed for and how long that answer may be kept. The default
 * implementation calls `webrisk.googleapis.com/v1/uris:search` for
 * SOCIAL_ENGINEERING, MALWARE and UNWANTED_SOFTWARE as the platform's own
 * service account — the firebase-admin credential every other server-side
 * Google call here already uses (`client-error-report.ts`), so there is no
 * key of its own. What is sent depends on the lookup mode, below.
 *
 * ## The lookup mode (AGL-3459)
 *
 * `platformSettings/webRisk.lookupMode`:
 *
 * - `'host'` — the default, and anything that is not `'url'`. Only
 *   `https://<host>/` is ever sent.
 * - `'url'` — the host first, from the cache or a call; then, for a host
 *   that is not itself listed, each of its links' addresses as
 *   `normalizeReputationLink` reduced them: scheme, host and path, never a
 *   query string, a fragment or a `user:password@`. A listed address is a
 *   hit on a clean host, so a kit at a path on a compromised site holds the
 *   page. At most `MAX_REPUTATION_URLS_PER_LOOKUP` addresses per lookup,
 *   inside the same deadline as the hosts.
 *
 * `'url'` sends more than a host to Google, so it stays off until the
 * Subprocessors page names that purpose — see the `webrisk.googleapis.com`
 * entry in `apps/console/constants/subprocessor-inventory.ts`.
 *
 * ## Not evidence when it fails
 *
 * A call is given {@link WEB_RISK_TIMEOUT_MS}, and a whole lookup
 * {@link WEB_RISK_DEADLINE_MS} — hosts and addresses together. A host or an
 * address whose answer did not arrive, or whose call failed, is UNKNOWN: it
 * holds nothing and logs a warning. A credential the API refuses (the API is
 * not enabled on a self-hosted project, say) backs the lookup off for a
 * quarter of an hour, so a misconfiguration is one log line rather than one
 * per page.
 *
 * ## The cache
 *
 * Per host and per address, in two layers, with the same rules for both:
 *
 * - this process's memory — a listing until the answer's `expireTime`,
 *   which Web Risk sets and which may not be exceeded; a clean answer for
 *   {@link WEB_RISK_MEMORY_CLEAN_TTL_MS}, short so a listing the daily
 *   re-check writes reaches every warm render within minutes. Capped at
 *   {@link WEB_RISK_MEMORY_MAX_ENTRIES}, then started again;
 * - the store, server-only, a clean answer kept {@link WEB_RISK_CLEAN_TTL_MS}:
 *   `webRiskVerdicts/{host}`, bounded by the number of distinct foreign
 *   hosts and rewritten in place; and `webRiskUrlVerdicts/{sha256(address)}`,
 *   whose answers the daily re-check deletes a day after they expire
 *   ({@link reapExpiredWebRiskUrlVerdicts}), because addresses are many more
 *   than hosts and a path is worth keeping no longer than it is used.
 *
 * Read in one `getAll` per lookup, so a page's hosts and addresses cost one
 * round trip, and nothing at all once they are in memory.
 *
 * ## The kill switch
 *
 * `platformSettings/webRisk` `{ enabled: false }` stops every lookup within a
 * minute — every host reads unknown, so nothing holds on it — without a
 * deploy. Absent or anything else means on.
 *=========================================*/

import { createHash } from 'crypto'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import {
  LINK_THREAT_TYPES,
  type LinkReputationAnswer,
  type LinkThreatType,
  MAX_REPUTATION_HOSTS_PER_LOOKUP,
  MAX_REPUTATION_URLS_PER_LOOKUP,
  normalizeReputationHost,
  normalizeReputationLink,
  pickReputationUrls,
  setLinkReputationLookup,
} from '@aglyn/shared-util-email/link-reputation'
import { getApp } from 'firebase-admin/app'
import firebaseAdmin from './firebase-admin'

export const WEB_RISK_SEARCH_ENDPOINT = 'https://webrisk.googleapis.com/v1/uris:search'
/** One answer per host. */
export const WEB_RISK_CACHE_COLLECTION = 'webRiskVerdicts'
/** One answer per address, in `'url'` mode (AGL-3459), keyed by the address's SHA-256. */
export const WEB_RISK_URL_CACHE_COLLECTION = 'webRiskUrlVerdicts'
/**
 * The switches: `{ enabled: false }` turns every lookup off;
 * `lookupMode: 'url'` looks up links' addresses as well as their hosts.
 */
export const WEB_RISK_SETTINGS_COLLECTION = 'platformSettings'
export const WEB_RISK_SETTINGS_DOC = 'webRisk'

/** What a lookup sends: the host only (the default), or the address too. */
export type WebRiskLookupMode = 'host' | 'url'

/** One call's budget. */
export const WEB_RISK_TIMEOUT_MS = 1_000
/** One lookup's budget, however many hosts and addresses it asks about. */
export const WEB_RISK_DEADLINE_MS = 1_200
/** How long a clean answer is kept in the store. */
export const WEB_RISK_CLEAN_TTL_MS = 12 * 60 * 60_000
/** How long a clean answer is trusted from this process's memory. */
export const WEB_RISK_MEMORY_CLEAN_TTL_MS = 10 * 60_000
/** A listing whose answer named no `expireTime` is kept this long. */
export const WEB_RISK_LISTED_FALLBACK_TTL_MS = 5 * 60_000
/** The most answers this process remembers before it starts again. */
export const WEB_RISK_MEMORY_MAX_ENTRIES = 20_000
/** How long past its expiry an address's stored answer is deleted. */
export const WEB_RISK_URL_VERDICT_GRACE_MS = 24 * 60 * 60_000
/** How long the switches' answer is trusted. */
const SWITCH_TTL_MS = 60_000
/** How long a refused credential stops the lookup. */
const REFUSED_BACKOFF_MS = 15 * 60_000
/** How long a rate limit stops the lookup. */
const THROTTLED_BACKOFF_MS = 60_000
/** At most one warning per this long, so an outage is not a log flood. */
const WARN_EVERY_MS = 60_000

/** What `uris.search` answered for one URI. */
export interface WebRiskSearchResult {
  /** The lists it is on; empty when it is on none. */
  threats: LinkThreatType[]
  /** Until when the answer may be kept, when the API said. */
  expireTimeMs: number | null
}

/** The contract: one URI, its listing. Throws on anything but an answer. */
export interface WebRiskClient {
  searchUri(uri: string): Promise<WebRiskSearchResult>
}

/** The API answered with a status that is not an answer. */
export class WebRiskHttpError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Web Risk answered ${status}: ${detail.slice(0, 200)}`)
    this.name = 'WebRiskHttpError'
  }
}

/** There is no credential to call with. */
export class WebRiskUnavailableError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'WebRiskUnavailableError'
  }
}

/** `uris.search`'s body, read defensively: an empty object is "not listed". */
export function parseWebRiskSearch(body: unknown): WebRiskSearchResult {
  const threat = (body as { threat?: { threatTypes?: unknown; expireTime?: unknown } } | null)
    ?.threat
  if (!threat || typeof threat !== 'object') return { threats: [], expireTimeMs: null }
  const listed = Array.isArray(threat.threatTypes) ? threat.threatTypes : []
  const threats = LINK_THREAT_TYPES.filter((type) => listed.includes(type))
  const expireTimeMs =
    typeof threat.expireTime === 'string' ? Date.parse(threat.expireTime) : Number.NaN
  return { threats, expireTimeMs: Number.isFinite(expireTimeMs) ? expireTimeMs : null }
}

/** The URI a host is looked up as. Only the host: never a path or a query. */
export function webRiskUriForHost(host: string): string {
  return `https://${host}/`
}

/** The default client: `uris.search` over HTTPS with a bearer token. */
export function createWebRiskHttpClient(options: {
  accessToken: () => Promise<string | null>
  fetch?: typeof fetch
  timeoutMs?: number
  endpoint?: string
}): WebRiskClient {
  const request = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? WEB_RISK_TIMEOUT_MS
  return {
    async searchUri(uri: string): Promise<WebRiskSearchResult> {
      const token = await options.accessToken()
      if (!token) throw new WebRiskUnavailableError('no service-account credential')
      const url = new URL(options.endpoint ?? WEB_RISK_SEARCH_ENDPOINT)
      for (const type of LINK_THREAT_TYPES) url.searchParams.append('threatTypes', type)
      url.searchParams.set('uri', uri)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await request(url.toString(), {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new WebRiskHttpError(response.status, await response.text().catch(() => ''))
        }
        return parseWebRiskSearch(await response.json())
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/**
 * The platform service account's access token, or null when this deployment
 * has none — the same credential `client-error-report.ts` writes logs with.
 */
async function serviceAccountAccessToken(): Promise<string | null> {
  try {
    const credential = getApp().options.credential
    if (!credential) return null
    return (await credential.getAccessToken())?.access_token ?? null
  } catch {
    return null
  }
}

let defaultClient: WebRiskClient | null = null
let clientOverride: WebRiskClient | null | undefined

function activeClient(): WebRiskClient | null {
  if (clientOverride !== undefined) return clientOverride
  defaultClient ??= createWebRiskHttpClient({ accessToken: serviceAccountAccessToken })
  return defaultClient
}

interface Verdict {
  threats: LinkThreatType[]
  checkedAtMs: number
  /** When the answer stops being good, in the store. */
  expiresAtMs: number
}

/** Hosts and addresses share one memory: an address always holds `://`, a host never does. */
const memory = new Map<string, Verdict & { memoryUntilMs: number }>()
let settingsMemo: { off: boolean; mode: WebRiskLookupMode; atMs: number } | null = null
let backoffUntilMs = 0
let lastWarnAtMs = 0

/** Test seam: forget the caches, the switches, the back-off; optionally stand in a client. */
export function resetWebRiskForTests(client?: WebRiskClient | null): void {
  memory.clear()
  settingsMemo = null
  backoffUntilMs = 0
  lastWarnAtMs = 0
  clientOverride = client
  defaultClient = null
}

function warn(nowMs: number, message: string, error?: unknown): void {
  if (nowMs - lastWarnAtMs < WARN_EVERY_MS) return
  lastWarnAtMs = nowMs
  console.warn(`[web-risk] ${message} — it reads unknown, which is not evidence`, error ?? '')
}

/**
 * The switches, read at most once a minute. An unreadable document is on,
 * in `'host'` mode; a mode that is not exactly `'url'` is `'host'`.
 */
async function webRiskSettings(nowMs: number): Promise<{ off: boolean; mode: WebRiskLookupMode }> {
  if (settingsMemo && nowMs - settingsMemo.atMs < SWITCH_TTL_MS) return settingsMemo
  const settings = await firebaseAdmin
    .app()
    .firestore()
    .collection(WEB_RISK_SETTINGS_COLLECTION)
    .doc(WEB_RISK_SETTINGS_DOC)
    .get()
    .then(
      (snapshot) => ({
        off: snapshot.get('enabled') === false,
        mode: snapshot.get('lookupMode') === 'url' ? ('url' as const) : ('host' as const),
      }),
      () => ({ off: false, mode: 'host' as const }),
    )
  settingsMemo = { ...settings, atMs: nowMs }
  return settings
}

/**
 * The lookup mode in force (AGL-3459): `'url'` only while the lookup is on
 * and `platformSettings/webRisk.lookupMode` is exactly `'url'`.
 */
export async function webRiskLookupMode(nowMs: number = Date.now()): Promise<WebRiskLookupMode> {
  const settings = await webRiskSettings(nowMs)
  return settings.off ? 'host' : settings.mode
}

/**
 * Hosts that are the platform's own: every site's subdomain on the tenant
 * apex. Never looked up — a neighbour's site is screened on its own page.
 */
export function platformReputationExclusions(): string[] {
  return [TENANT_APEX].filter(Boolean)
}

function isPlatformHost(host: string): boolean {
  return platformReputationExclusions().some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  )
}

/** An address's document id in {@link WEB_RISK_URL_CACHE_COLLECTION}: an address holds `/`, a hash does not. */
export function webRiskUrlVerdictId(url: string): string {
  return createHash('sha256').update(url).digest('hex')
}

function isAddress(key: string): boolean {
  return key.includes('://')
}

/** A stored answer, or null. An address's must name the address it was asked for. */
function verdictFrom(data: Record<string, unknown> | undefined, url?: string): Verdict | null {
  if (!data) return null
  if (url !== undefined && data['url'] !== url) return null
  const threats = Array.isArray(data['threats'])
    ? LINK_THREAT_TYPES.filter((type) => (data['threats'] as unknown[]).includes(type))
    : []
  const checkedAtMs = Number(data['checkedAtMs'])
  const expiresAtMs = Number(data['expiresAtMs'])
  if (!Number.isFinite(checkedAtMs) || !Number.isFinite(expiresAtMs)) return null
  return { threats, checkedAtMs, expiresAtMs }
}

function remember(key: string, verdict: Verdict, nowMs: number): void {
  if (memory.size >= WEB_RISK_MEMORY_MAX_ENTRIES && !memory.has(key)) memory.clear()
  memory.set(key, {
    ...verdict,
    memoryUntilMs: verdict.threats.length
      ? verdict.expiresAtMs
      : Math.min(verdict.expiresAtMs, nowMs + WEB_RISK_MEMORY_CLEAN_TTL_MS),
  })
}

function fromMemory(key: string, nowMs: number): Verdict | null {
  const known = memory.get(key)
  return known && nowMs < known.memoryUntilMs ? known : null
}

export interface HostReputationLookupOptions {
  /** How long the caller will wait, overall. */
  deadlineMs?: number
  /** The most hosts asked about; the rest read unknown. */
  maxHosts?: number
  /**
   * The links' addresses, looked up on the hosts asked about in `'url'`
   * mode (AGL-3459) and ignored in `'host'` mode. Normalized again here, so
   * a query string handed in is still never sent.
   */
  urls?: readonly string[]
  /** The most addresses asked about ({@link MAX_REPUTATION_URLS_PER_LOOKUP}); the rest are not asked about. */
  maxUrls?: number
  nowMs?: number
}

/** What a lookup answered, and how many calls it made to the API. */
export interface HostReputationLookupResult extends LinkReputationAnswer {
  looked: number
}

/**
 * The reputation of each host — and, in `'url'` mode, of each address on a
 * host that is not itself listed: listed, clean, or unknown. Platform hosts
 * are clean without asking. Never throws, and never waits on the API longer
 * than the deadline: a call still running then finishes in the background
 * and fills the caches for the next asker.
 */
export async function lookupLinkReputation(
  hosts: readonly string[],
  options: HostReputationLookupOptions = {},
): Promise<HostReputationLookupResult> {
  const nowMs = options.nowMs ?? Date.now()
  const result: HostReputationLookupResult = { hits: [], clean: [], unknown: [], looked: 0 }
  const wanted: string[] = []
  for (const raw of hosts) {
    const host = normalizeReputationHost(raw)
    if (!host || wanted.includes(host) || result.clean.includes(host)) continue
    if (isPlatformHost(host)) result.clean.push(host)
    else if (wanted.length < (options.maxHosts ?? MAX_REPUTATION_HOSTS_PER_LOOKUP)) wanted.push(host)
    else result.unknown.push(host)
  }
  if (!wanted.length) return result
  let urls = options.urls?.length
    ? pickReputationUrls(options.urls, wanted, options.maxUrls ?? MAX_REPUTATION_URLS_PER_LOOKUP)
    : []
  const hostOf = new Map(urls.map((url) => [url, normalizeReputationLink(url)?.host ?? '']))

  // What is known before the API is asked, host or address.
  const known = new Map<string, Verdict>()
  const unknownTo = (keys: readonly string[]) =>
    keys.filter((key) => {
      const verdict = fromMemory(key, nowMs)
      if (verdict) known.set(key, verdict)
      return !verdict
    })

  // 1. This process's memory, for the hosts.
  let missingHosts = unknownTo(wanted)
  let missingUrls: string[] = []
  let mayAsk = true

  // 2. The switches — read only when a host is left to ask about, or
  //    addresses wait on the mode. Off reads everything left as unknown.
  if (missingHosts.length || urls.length) {
    const settings = await webRiskSettings(nowMs)
    if (settings.off || settings.mode !== 'url') urls = []
    if (settings.off) mayAsk = false
    // An address on a host already known to be listed adds nothing.
    urls = urls.filter((url) => !known.get(hostOf.get(url) ?? '')?.threats.length)
    // 1b. This process's memory, for the addresses.
    missingUrls = unknownTo(urls)
  }

  // 3. The store, hosts and addresses in one round trip.
  const firestore = firebaseAdmin.app().firestore()
  const hostCollection = firestore.collection(WEB_RISK_CACHE_COLLECTION)
  const urlCollection = firestore.collection(WEB_RISK_URL_CACHE_COLLECTION)
  if (mayAsk && (missingHosts.length || missingUrls.length)) {
    const keys = [...missingHosts, ...missingUrls]
    try {
      const snapshots = await firestore.getAll(
        ...keys.map((key) =>
          isAddress(key) ? urlCollection.doc(webRiskUrlVerdictId(key)) : hostCollection.doc(key),
        ),
      )
      snapshots.forEach((snapshot, index) => {
        const key = keys[index]
        const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined
        const verdict = verdictFrom(data, isAddress(key) ? key : undefined)
        if (!verdict || nowMs >= verdict.expiresAtMs) return
        remember(key, verdict, nowMs)
        known.set(key, verdict)
      })
      missingHosts = missingHosts.filter((host) => !known.has(host))
      missingUrls = missingUrls.filter((url) => !known.has(url))
    } catch (error) {
      warn(nowMs, 'the verdict cache could not be read', error)
    }
  }

  // 4. The API, everything left at once, within the deadline: each host
  //    first, then — unless the host itself is listed — its addresses.
  const answered = new Map<string, Verdict>()
  const client = activeClient()
  if (mayAsk && client && nowMs >= backoffUntilMs && (missingHosts.length || missingUrls.length)) {
    let looked = 0
    const ask = async (key: string): Promise<Verdict | null> => {
      if (Date.now() < backoffUntilMs) return null
      looked += 1
      try {
        const answer = await client.searchUri(isAddress(key) ? key : webRiskUriForHost(key))
        const checkedAtMs = Date.now()
        const verdict: Verdict = {
          threats: answer.threats,
          checkedAtMs,
          expiresAtMs: answer.threats.length
            ? (answer.expireTimeMs ?? checkedAtMs + WEB_RISK_LISTED_FALLBACK_TTL_MS)
            : checkedAtMs + WEB_RISK_CLEAN_TTL_MS,
        }
        answered.set(key, verdict)
        remember(key, verdict, checkedAtMs)
        const document = isAddress(key)
          ? urlCollection
              .doc(webRiskUrlVerdictId(key))
              .set({ host: hostOf.get(key) ?? '', url: key, ...verdict, listed: verdict.threats.length > 0 })
          : hostCollection.doc(key).set({ host: key, ...verdict, listed: verdict.threats.length > 0 })
        await document.catch((error: unknown) => warn(checkedAtMs, 'a verdict could not be cached', error))
        return verdict
      } catch (error) {
        if (error instanceof WebRiskHttpError && [401, 403, 404].includes(error.status)) {
          backoffUntilMs = Date.now() + REFUSED_BACKOFF_MS
          console.error('[web-risk] the API refused the credential — lookups paused for 15 minutes', error)
        } else if (error instanceof WebRiskHttpError && error.status === 429) {
          backoffUntilMs = Date.now() + THROTTLED_BACKOFF_MS
          warn(Date.now(), 'the API is rate limiting', error)
        } else if (error instanceof WebRiskUnavailableError) {
          backoffUntilMs = Date.now() + REFUSED_BACKOFF_MS
          warn(Date.now(), 'no credential to call the API with', error)
        } else {
          warn(Date.now(), `the lookup of ${key} failed or timed out`, error)
        }
        return null
      }
    }
    const pipelines = wanted.map(async (host) => {
      const hostVerdict = known.get(host) ?? (missingHosts.includes(host) ? await ask(host) : null)
      if (hostVerdict?.threats.length) return
      await Promise.all(missingUrls.filter((url) => hostOf.get(url) === host).map((url) => ask(url)))
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.allSettled(pipelines),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, options.deadlineMs ?? WEB_RISK_DEADLINE_MS)
      }),
    ])
    if (timer) clearTimeout(timer)
    result.looked = looked
    const late = [...missingHosts, ...missingUrls].filter((key) => !answered.has(key)).length
    if (late) warn(Date.now(), `${late} host(s) or address(es) had no answer within the deadline`)
  }

  // 5. The answer. An address on a listed host is not reported: the host's
  //    listing already names it.
  const verdictOf = (key: string) => known.get(key) ?? answered.get(key)
  for (const host of wanted) {
    const verdict = verdictOf(host)
    if (!verdict) result.unknown.push(host)
    else if (verdict.threats.length) result.hits.push({ host, threats: verdict.threats })
    else result.clean.push(host)
  }
  for (const url of urls) {
    const host = hostOf.get(url) ?? ''
    if (verdictOf(host)?.threats.length) continue
    const verdict = verdictOf(url)
    if (!verdict) result.unknown.push(url)
    else if (verdict.threats.length) result.hits.push({ host, url, threats: verdict.threats })
    else result.clean.push(url)
  }
  return result
}

/**
 * Delete the addresses' stored answers that expired more than
 * {@link WEB_RISK_URL_VERDICT_GRACE_MS} ago (AGL-3459), at most `limit` at a
 * time. The daily re-check calls it once per walk. A host's answers are not
 * reaped: they are few and rewritten in place. Never throws.
 */
export async function reapExpiredWebRiskUrlVerdicts(
  options: { nowMs?: number; limit?: number; firestore?: FirebaseFirestore.Firestore } = {},
): Promise<number> {
  const nowMs = options.nowMs ?? Date.now()
  const firestore = options.firestore ?? firebaseAdmin.app().firestore()
  try {
    const stale = await firestore
      .collection(WEB_RISK_URL_CACHE_COLLECTION)
      .where('expiresAtMs', '<', nowMs - WEB_RISK_URL_VERDICT_GRACE_MS)
      .limit(options.limit ?? 500)
      .get()
    await Promise.all(stale.docs.map((snapshot) => snapshot.ref.delete()))
    return stale.docs.length
  } catch (error) {
    console.warn('[web-risk] expired address verdicts could not be deleted', error)
    return 0
  }
}

/**
 * Puts this lookup behind the shared screen's reputation seam, so the send
 * seam (`screenTenantMessage`) asks it. Called by
 * `installOutboundScreenGate`, at that module's load.
 */
export function installLinkReputationLookup(): void {
  if (typeof setLinkReputationLookup !== 'function') return
  setLinkReputationLookup((hosts, options) =>
    lookupLinkReputation(hosts, { deadlineMs: options?.deadlineMs, urls: options?.urls }),
  )
}
