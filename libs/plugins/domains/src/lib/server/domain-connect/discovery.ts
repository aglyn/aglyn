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

import { registrableDomain } from '@aglyn/shared-util-email/outbound-phishing-screen'
import type { ConfiguredUrlReadResult } from '@aglyn/tenant-data-admin/server/configured-url-fetch'
import type { DnsLookupResult } from '@aglyn/tenant-data-admin/server/dns-probe'
import {
  DOMAIN_CONNECT_SERVICES,
  type DomainConnectTemplate,
} from '../../model/domain-connect'

/*
 * FINDING A DOMAIN'S DNS PROVIDER, AND WHETHER IT TAKES OUR TEMPLATE
 * (AGL-3963).
 *
 * The Domain Connect discovery, in its three steps:
 *
 * 1. `_domainconnect.<zone root>` TXT names the provider's API prefix — a
 *    host and maybe a path, no scheme.
 * 2. `GET https://<prefix>/v2/<root>/settings` answers who the provider is
 *    and where its apply page (`urlSyncUX`) and its API (`urlAPI`) are. A 404
 *    is a provider that does not host this zone.
 * 3. `GET <urlAPI>/v2/domainTemplates/providers/<ours>/services/<service>` —
 *    a 2xx means the provider has onboarded the template.
 *
 * Every step is somebody else's DNS and somebody else's server, and the
 * answer feeds a button that only ever helps. So the rules are:
 *
 * - **It never throws and never errors.** Anything that goes wrong is
 *   `{ supported: false }`: the button stays away and the printed records
 *   remain the way to connect.
 * - **It is bounded.** The TXT lookup and each request carry a timeout, each
 *   reply a byte ceiling, and the answer is cached per zone for ten minutes
 *   so a customer typing does not become a request per keystroke.
 * - **It only reaches public servers.** The prefix is whatever the domain's
 *   owner published, so the two requests go through
 *   `readConfiguredPublicUrl`: https only, the name resolved to public
 *   addresses and pinned there, no redirect followed. A TXT naming the cloud
 *   metadata address is a refusal, not a request.
 * - **Only the zone root is sent.** No account, no site and no person.
 */

/** Where a typed domain sits in its zone, and the template that writes it. */
export interface DomainConnectZone {
  /** The zone root, `example.com` or `example.co.uk`. */
  root: string
  /** The name under the root the template is applied to; empty for the root. */
  host: string
  template: DomainConnectTemplate
  serviceId: string
  /**
   * The `www.`/apex partner the apex template also writes, connected as the
   * redirect twin. Null for a subdomain.
   */
  twin: string | null
}

/**
 * The zone of a validated, lowercased domain.
 *
 * The root and its `www.` take the apex template, applied at the root, so
 * both names are written and whichever was typed is the primary. Anything
 * else takes the subdomain template at its own name.
 */
export function domainConnectZoneOf(domain: string): DomainConnectZone | null {
  const name = domain.trim().toLowerCase().replace(/\.+$/, '')
  const root = registrableDomain(name)
  if (!root || !root.includes('.')) return null
  const host = name === root ? '' : name.endsWith(`.${root}`) ? name.slice(0, -(root.length + 1)) : null
  if (host === null) return null
  if (host === '' || host === 'www') {
    return {
      root,
      host: '',
      template: 'apex',
      serviceId: DOMAIN_CONNECT_SERVICES.apex,
      twin: host === '' ? `www.${root}` : root,
    }
  }
  return {
    root,
    host,
    template: 'subdomain',
    serviceId: DOMAIN_CONNECT_SERVICES.subdomain,
    twin: null,
  }
}

/** A DNS provider's Domain Connect settings, as the start route uses them. */
export interface DomainConnectProvider {
  providerId: string
  /** What the button calls it: `providerDisplayName`, else `providerName`. */
  providerName: string
  urlSyncUX: string
  urlAPI: string
  width: number
  height: number
}

export type DomainConnectDiscovery =
  | { supported: false; reason: string }
  | { supported: true; zone: DomainConnectZone; provider: DomainConnectProvider }

export interface DomainConnectDiscoveryDeps {
  lookupTxt(name: string): Promise<DnsLookupResult<string>>
  read(
    url: string,
    init: Omit<RequestInit, 'redirect'>,
    options: { maxBytes: number },
  ): Promise<ConfiguredUrlReadResult>
  now(): number
}

/** How long one answer is reused for a zone. */
export const DISCOVERY_CACHE_MS = 10 * 60 * 1000
/** Zones remembered at once; the oldest is dropped past this. */
const CACHE_LIMIT = 500
/** The TXT lookup's budget. */
const TXT_TIMEOUT_MS = 3_000
/** Each request's budget. */
const REQUEST_TIMEOUT_MS = 5_000
/** A settings document is a few hundred bytes. */
const MAX_REPLY_BYTES = 32 * 1024
/** Popup bounds a provider may ask for, and the spec's default. */
const DEFAULT_POPUP = 750
const MIN_POPUP = 300
const MAX_POPUP = 1600

const cache = new Map<string, { atMs: number; answer: DomainConnectDiscovery }>()

/** Test seam: forget every cached answer. */
export function resetDomainConnectDiscoveryCache(): void {
  cache.clear()
}

/** A TXT value that names an API prefix: a hostname, optionally a path. */
const API_PREFIX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/[A-Za-z0-9._~%/-]*)?$/i

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    work.catch(() => fallback),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** An absolute https URL with no credentials, trailing slashes removed; else null. */
function httpsBase(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

function popupSize(value: unknown): number {
  const size = Math.round(Number(value))
  if (!Number.isFinite(size) || size <= 0) return DEFAULT_POPUP
  return Math.min(MAX_POPUP, Math.max(MIN_POPUP, size))
}

/** The provider fields of a settings document, or null when it lacks one we need. */
export function parseDomainConnectSettings(body: unknown): DomainConnectProvider | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const settings = body as Record<string, unknown>
  const providerId = typeof settings['providerId'] === 'string' ? settings['providerId'].trim() : ''
  const displayName =
    typeof settings['providerDisplayName'] === 'string' ? settings['providerDisplayName'].trim() : ''
  const name = typeof settings['providerName'] === 'string' ? settings['providerName'].trim() : ''
  const urlAPI = httpsBase(settings['urlAPI'])
  // No `urlSyncUX` is a provider without the synchronous flow, which is the
  // only one this plugin speaks.
  const urlSyncUX = httpsBase(settings['urlSyncUX'])
  const providerName = (displayName || name).slice(0, 80)
  if (!providerId || !providerName || !urlAPI || !urlSyncUX) return null
  return {
    providerId,
    providerName,
    urlSyncUX,
    urlAPI,
    width: popupSize(settings['width']),
    height: popupSize(settings['height']),
  }
}

async function readJson(
  deps: DomainConnectDiscoveryDeps,
  url: string,
): Promise<{ status: number; json: unknown } | null> {
  const read = await deps
    .read(
      url,
      { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      { maxBytes: MAX_REPLY_BYTES },
    )
    .catch(() => null)
  if (!read || !read.ok || read.body === null) return null
  let json: unknown
  try {
    json = read.body ? JSON.parse(read.body) : null
  } catch {
    json = null
  }
  return { status: read.status, json }
}

async function discoverUncached(
  zone: DomainConnectZone,
  providerIdOfOurs: string,
  deps: DomainConnectDiscoveryDeps,
): Promise<DomainConnectDiscovery> {
  const txt = await withTimeout(
    deps.lookupTxt(`_domainconnect.${zone.root}`),
    TXT_TIMEOUT_MS,
    { answered: false, records: [] },
  )
  const prefix = txt.records
    .map((record) => record.trim().replace(/^https:\/\//i, '').replace(/\/+$/, ''))
    .find((record) => API_PREFIX.test(record))
  if (!prefix) return { supported: false, reason: txt.answered ? 'no-provider' : 'dns-unreachable' }

  const settings = await readJson(deps, `https://${prefix}/v2/${encodeURIComponent(zone.root)}/settings`)
  if (!settings || settings.status < 200 || settings.status >= 300) {
    return { supported: false, reason: 'no-settings' }
  }
  const provider = parseDomainConnectSettings(settings.json)
  if (!provider) return { supported: false, reason: 'no-sync-flow' }

  const template = await readJson(
    deps,
    `${provider.urlAPI}/v2/domainTemplates/providers/${encodeURIComponent(providerIdOfOurs)}` +
      `/services/${encodeURIComponent(zone.serviceId)}`,
  )
  if (!template || template.status < 200 || template.status >= 300) {
    return { supported: false, reason: 'no-template' }
  }
  return { supported: true, zone, provider }
}

/**
 * Whether the DNS provider of `domain` can apply our template for it.
 * `domain` is validated and lowercased. Never throws.
 */
export async function discoverDomainConnect(
  domain: string,
  providerIdOfOurs: string,
  deps: DomainConnectDiscoveryDeps,
): Promise<DomainConnectDiscovery> {
  const zone = domainConnectZoneOf(domain)
  if (!zone) return { supported: false, reason: 'not-a-zone' }
  // The template differs between the root and a subdomain, so the answer is
  // per zone AND service; the zone's part of it is what a name inside the
  // same zone shares.
  const key = `${zone.root}|${zone.serviceId}|${providerIdOfOurs}`
  const nowMs = deps.now()
  const hit = cache.get(key)
  if (hit && nowMs - hit.atMs < DISCOVERY_CACHE_MS) {
    return hit.answer.supported ? { ...hit.answer, zone } : hit.answer
  }
  let answer: DomainConnectDiscovery
  try {
    answer = await discoverUncached(zone, providerIdOfOurs, deps)
  } catch {
    answer = { supported: false, reason: 'error' }
  }
  cache.delete(key)
  cache.set(key, { atMs: nowMs, answer })
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return answer
}
