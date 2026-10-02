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
 * half: the `uris.search` client, the cache, the kill switch.
 *
 * ## The client
 *
 * {@link WebRiskClient} is the contract: one URI in, the threat types it is
 * listed for and how long that answer may be kept. The default
 * implementation calls `webrisk.googleapis.com/v1/uris:search` for
 * SOCIAL_ENGINEERING, MALWARE and UNWANTED_SOFTWARE as the platform's own
 * service account — the firebase-admin credential every other server-side
 * Google call here already uses (`client-error-report.ts`), so there is no
 * key of its own. Only `https://<host>/` is ever sent: see the module header
 * of `link-reputation.ts`.
 *
 * ## Not evidence when it fails
 *
 * A call is given {@link WEB_RISK_TIMEOUT_MS}, and a whole lookup
 * {@link WEB_RISK_DEADLINE_MS}. A host whose answer did not arrive, or whose
 * call failed, is UNKNOWN: it holds nothing and logs a warning. A credential
 * the API refuses (the API is not enabled on a self-hosted project, say) backs
 * the lookup off for a quarter of an hour, so a misconfiguration is one log
 * line rather than one per page.
 *
 * ## The cache
 *
 * Per host, in two layers:
 *
 * - this process's memory — a listed host until the answer's `expireTime`,
 *   which Web Risk sets and which may not be exceeded; a clean one for
 *   {@link WEB_RISK_MEMORY_CLEAN_TTL_MS}, short so a listing the daily
 *   re-check writes reaches every warm render within minutes;
 * - `webRiskVerdicts/{host}` — server-only, one document per host, a clean
 *   answer kept {@link WEB_RISK_CLEAN_TTL_MS}. Bounded by the number of
 *   distinct foreign hosts and rewritten in place, so it needs no TTL policy.
 *
 * Read in one `getAll` per lookup, so a page's twenty hosts cost one round
 * trip, and nothing at all once they are in memory.
 *
 * ## The kill switch
 *
 * `platformSettings/webRisk` `{ enabled: false }` stops every lookup within a
 * minute — every host reads unknown, so nothing holds on it — without a
 * deploy. Absent or anything else means on.
 *=========================================*/

import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import {
  LINK_THREAT_TYPES,
  type LinkReputationAnswer,
  type LinkThreatType,
  MAX_REPUTATION_HOSTS_PER_LOOKUP,
  normalizeReputationHost,
  setLinkReputationLookup,
} from '@aglyn/shared-util-email/link-reputation'
import { getApp } from 'firebase-admin/app'
import firebaseAdmin from './firebase-admin'

export const WEB_RISK_SEARCH_ENDPOINT = 'https://webrisk.googleapis.com/v1/uris:search'
export const WEB_RISK_CACHE_COLLECTION = 'webRiskVerdicts'
/** The kill switch: `{ enabled: false }` turns every lookup off. */
export const WEB_RISK_SETTINGS_COLLECTION = 'platformSettings'
export const WEB_RISK_SETTINGS_DOC = 'webRisk'

/** One call's budget. */
export const WEB_RISK_TIMEOUT_MS = 1_000
/** One lookup's budget, however many hosts it asks about. */
export const WEB_RISK_DEADLINE_MS = 1_200
/** How long a clean answer is kept in the store. */
export const WEB_RISK_CLEAN_TTL_MS = 12 * 60 * 60_000
/** How long a clean answer is trusted from this process's memory. */
export const WEB_RISK_MEMORY_CLEAN_TTL_MS = 10 * 60_000
/** A listing whose answer named no `expireTime` is kept this long. */
export const WEB_RISK_LISTED_FALLBACK_TTL_MS = 5 * 60_000
/** How long the switch's answer is trusted. */
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

const memory = new Map<string, Verdict & { memoryUntilMs: number }>()
let switchMemo: { off: boolean; atMs: number } | null = null
let backoffUntilMs = 0
let lastWarnAtMs = 0

/** Test seam: forget the caches, the switch, the back-off; optionally stand in a client. */
export function resetWebRiskForTests(client?: WebRiskClient | null): void {
  memory.clear()
  switchMemo = null
  backoffUntilMs = 0
  lastWarnAtMs = 0
  clientOverride = client
  defaultClient = null
}

function warn(nowMs: number, message: string, error?: unknown): void {
  if (nowMs - lastWarnAtMs < WARN_EVERY_MS) return
  lastWarnAtMs = nowMs
  console.warn(`[web-risk] ${message} — the host reads unknown, which is not evidence`, error ?? '')
}

/** Is the lookup switched off? Read at most once a minute; an unreadable switch is on. */
async function switchedOff(nowMs: number): Promise<boolean> {
  if (switchMemo && nowMs - switchMemo.atMs < SWITCH_TTL_MS) return switchMemo.off
  const off = await firebaseAdmin
    .app()
    .firestore()
    .collection(WEB_RISK_SETTINGS_COLLECTION)
    .doc(WEB_RISK_SETTINGS_DOC)
    .get()
    .then(
      (snapshot) => snapshot.get('enabled') === false,
      () => false,
    )
  switchMemo = { off, atMs: nowMs }
  return off
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

function verdictFrom(data: Record<string, unknown> | undefined): Verdict | null {
  if (!data) return null
  const threats = Array.isArray(data['threats'])
    ? LINK_THREAT_TYPES.filter((type) => (data['threats'] as unknown[]).includes(type))
    : []
  const checkedAtMs = Number(data['checkedAtMs'])
  const expiresAtMs = Number(data['expiresAtMs'])
  if (!Number.isFinite(checkedAtMs) || !Number.isFinite(expiresAtMs)) return null
  return { threats, checkedAtMs, expiresAtMs }
}

function remember(host: string, verdict: Verdict, nowMs: number): void {
  memory.set(host, {
    ...verdict,
    memoryUntilMs: verdict.threats.length
      ? verdict.expiresAtMs
      : Math.min(verdict.expiresAtMs, nowMs + WEB_RISK_MEMORY_CLEAN_TTL_MS),
  })
}

export interface HostReputationLookupOptions {
  /** How long the caller will wait, overall. */
  deadlineMs?: number
  /** The most hosts asked about; the rest read unknown. */
  maxHosts?: number
  nowMs?: number
}

/** What a lookup answered, and how many hosts it had to ask the API about. */
export interface HostReputationLookupResult extends LinkReputationAnswer {
  looked: number
}

/**
 * The reputation of each host: listed, clean, or unknown. Platform hosts are
 * clean without asking. Never throws, and never waits longer than the
 * deadline: a call still running then finishes in the background and fills
 * the caches for the next asker.
 *
 * "Never throws" covers the store as well as the API: a missing app, a
 * settings read that fails before it is a promise, or a cache reference
 * that cannot be built all read every host as unknown. The page review
 * calls this before its own fail-closed `try`, so a throw here would take
 * down every page with a link off the site.
 */
export async function lookupHostReputation(
  hosts: readonly string[],
  options: HostReputationLookupOptions = {},
): Promise<HostReputationLookupResult> {
  try {
    return await lookupHostReputationOrThrow(hosts, options)
  } catch (error) {
    warn(options.nowMs ?? Date.now(), 'a lookup failed before it could answer', error)
    const unknown = [
      ...new Set(
        hosts
          .map((raw) => normalizeReputationHost(raw))
          .filter((host): host is string => Boolean(host)),
      ),
    ]
    return { hits: [], clean: [], unknown, looked: 0 }
  }
}

async function lookupHostReputationOrThrow(
  hosts: readonly string[],
  options: HostReputationLookupOptions,
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

  const settle = (host: string, verdict: Verdict) => {
    if (verdict.threats.length) result.hits.push({ host, threats: verdict.threats })
    else result.clean.push(host)
  }

  // 1. This process's memory.
  let missing = wanted.filter((host) => {
    const known = memory.get(host)
    if (known && nowMs < known.memoryUntilMs) {
      settle(host, known)
      return false
    }
    return true
  })
  if (!missing.length) return result

  // 2. The switch. Off reads every remaining host as unknown.
  if (await switchedOff(nowMs)) {
    result.unknown.push(...missing)
    return result
  }

  // 3. The store, in one round trip.
  const firestore = firebaseAdmin.app().firestore()
  const collection = firestore.collection(WEB_RISK_CACHE_COLLECTION)
  try {
    const snapshots = await firestore.getAll(...missing.map((host) => collection.doc(host)))
    const stored = new Map<string, Verdict>()
    for (const snapshot of snapshots) {
      const verdict = verdictFrom(snapshot.exists ? (snapshot.data() as Record<string, unknown>) : undefined)
      if (verdict && nowMs < verdict.expiresAtMs) stored.set(snapshot.id, verdict)
    }
    missing = missing.filter((host) => {
      const verdict = stored.get(host)
      if (!verdict) return true
      remember(host, verdict, nowMs)
      settle(host, verdict)
      return false
    })
  } catch (error) {
    warn(nowMs, 'the verdict cache could not be read', error)
  }
  if (!missing.length) return result

  // 4. The API, every remaining host at once, within the deadline.
  const client = activeClient()
  if (!client || nowMs < backoffUntilMs) {
    result.unknown.push(...missing)
    return result
  }
  result.looked = missing.length
  const answers = new Map<string, Verdict>()
  const calls = missing.map(async (host) => {
    try {
      const answer = await client.searchUri(webRiskUriForHost(host))
      const checkedAtMs = Date.now()
      const verdict: Verdict = {
        threats: answer.threats,
        checkedAtMs,
        expiresAtMs: answer.threats.length
          ? (answer.expireTimeMs ?? checkedAtMs + WEB_RISK_LISTED_FALLBACK_TTL_MS)
          : checkedAtMs + WEB_RISK_CLEAN_TTL_MS,
      }
      answers.set(host, verdict)
      remember(host, verdict, checkedAtMs)
      await collection
        .doc(host)
        .set({ host, ...verdict, listed: verdict.threats.length > 0 })
        .catch((error: unknown) => warn(checkedAtMs, 'a verdict could not be cached', error))
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
        warn(Date.now(), `the lookup of ${host} failed or timed out`, error)
      }
    }
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.allSettled(calls),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, options.deadlineMs ?? WEB_RISK_DEADLINE_MS)
    }),
  ])
  if (timer) clearTimeout(timer)
  const late = missing.filter((host) => !answers.has(host))
  for (const host of missing) {
    const verdict = answers.get(host)
    if (verdict) settle(host, verdict)
  }
  result.unknown.push(...late)
  if (late.length) warn(Date.now(), `${late.length} host(s) had no answer within the deadline`)
  return result
}

/**
 * Puts this lookup behind the shared screen's reputation seam, so the send
 * seam (`screenTenantMessage`) asks it. Called by
 * `installOutboundScreenGate`, at that module's load.
 */
export function installLinkReputationLookup(): void {
  if (typeof setLinkReputationLookup !== 'function') return
  setLinkReputationLookup((hosts, options) =>
    lookupHostReputation(hosts, { deadlineMs: options?.deadlineMs }),
  )
}
