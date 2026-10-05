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
 * LINK REPUTATION (AGL-3451): what the phishing screen asks about a host
 * nobody's rules can judge.
 *
 * The screen's own rules catch a page or a message that LOOKS like a lure —
 * a brand's lookalike host, a password field, a brand beside a sign-in. The
 * 2026-10-01 harvesters linked to `temps-juenes.com` and
 * `conservascaorvi.com`, which wear no brand at all, so nothing held them.
 * A host already known to be bad anywhere is caught here instead: every
 * FOREIGN host a page, an email or a redirect points at is looked up against
 * a reputation list (Google Web Risk), and a listed one is a
 * `web-risk-link` signal — STRONG, so it holds for every workspace.
 *
 * Split like the send seam's gate: the pure half lives here (which hosts are
 * foreign, how a listing becomes a signal), and the lookup — a network call
 * and a cache — is installed by `@aglyn/tenant-data-admin`
 * (`web-risk.ts`) through {@link setLinkReputationLookup}. Nothing installed
 * means nothing looked up.
 *
 * ## Not evidence when it fails
 *
 * A lookup that errors or times out says nothing about the host. It never
 * holds by itself; the lookup reports the host as unknown and logs a warning.
 *
 * ## The host, and — only when switched on — the path
 *
 * By default (`platformSettings/webRisk.lookupMode: 'host'`) the lookup sees
 * `https://<host>/` and nothing else. A host is enough to catch a domain
 * that exists to harvest, and it is the least a third party can be told.
 *
 * A phishing kit as often sits at a path on a compromised site that is
 * otherwise legitimate, which a host lookup reads as clean. In `'url'` mode
 * (AGL-3459) each link's address is looked up too, as
 * {@link normalizeReputationLink} reduces it: scheme, host and path. Never
 * the query string or the fragment, which is where a recipient's address
 * and a session's token live; never a `user:password@`; and the path stops
 * before any segment that carries an email address or an unrendered merge
 * tag. Sending paths makes Google a recipient for a new purpose, so the
 * switch is flipped only once the Subprocessors page names it.
 *
 * ## The budget
 *
 * One page, message or redirect asks about at most
 * {@link MAX_REPUTATION_HOSTS_PER_LOOKUP} hosts and, in `'url'` mode, at most
 * {@link MAX_REPUTATION_URLS_PER_LOOKUP} addresses, deduplicated and taken a
 * host at a time ({@link pickReputationUrls}), so a long list of links to
 * one site cannot crowd out the one link to another.
 *=========================================*/

import type { PhishingScreenSignal } from './outbound-phishing-screen'
import {
  isAnyOfficialBrandDomain,
  isCommonLinkDomain,
  registrableDomain,
} from './outbound-phishing-screen'

/** The threat lists a host is looked up against. */
export type LinkThreatType = 'SOCIAL_ENGINEERING' | 'MALWARE' | 'UNWANTED_SOFTWARE'

export const LINK_THREAT_TYPES: readonly LinkThreatType[] = [
  'SOCIAL_ENGINEERING',
  'MALWARE',
  'UNWANTED_SOFTWARE',
]

/**
 * A host the list names, or one address on it, and what it names it for.
 * `url` is set when the listing is the address's, not the host's.
 */
export interface HostReputationHit {
  host: string
  threats: LinkThreatType[]
  /** The address the list names (scheme, host and path), when it is one page on a clean host. */
  url?: string
}

/** What one lookup answered, host by host and address by address. */
export interface LinkReputationAnswer {
  /** Hosts, and addresses, the list names. */
  hits: HostReputationHit[]
  /** Hosts and addresses the list does not name. */
  clean: string[]
  /** Hosts and addresses nobody could answer for: an error, a timeout, a switched-off lookup. */
  unknown: string[]
}

export interface LinkReputationLookupOptions {
  /** How long the caller will wait, overall. */
  deadlineMs?: number
  /**
   * The links' addresses, as {@link normalizeReputationLink} reduced them —
   * looked up only in `'url'` mode, and only on the hosts asked about.
   */
  urls?: readonly string[]
}

export type LinkReputationLookup = (
  hosts: readonly string[],
  options?: LinkReputationLookupOptions,
) => Promise<LinkReputationAnswer>

/** The most foreign hosts one page, message or redirect is looked up for. */
export const MAX_REPUTATION_HOSTS_PER_LOOKUP = 20
/**
 * The most link addresses (path included) one page, message or redirect is
 * looked up for in `'url'` mode, beside its hosts (AGL-3459). With the hosts,
 * at most forty calls, all inside the same per-page deadline.
 */
export const MAX_REPUTATION_URLS_PER_LOOKUP = 20
/**
 * The longest path an address keeps. Longer is cut back to the last `/`
 * within it, so what is looked up is still a path the link really starts
 * with — Web Risk lists a kit by its path prefix.
 */
export const MAX_REPUTATION_URL_PATH_LENGTH = 512

let installedLookup: LinkReputationLookup | null = null

/** Installs the lookup. Called once, from `@aglyn/tenant-data-admin`. */
export function setLinkReputationLookup(lookup: LinkReputationLookup | null): void {
  installedLookup = lookup
}

/** The installed lookup, or null. */
export function getLinkReputationLookup(): LinkReputationLookup | null {
  return installedLookup
}

/** Test seam: forget any installed lookup. */
export function resetLinkReputationLookupForTests(): void {
  installedLookup = null
}

const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/

/** A host as the lookup takes it, or null for anything that is not one. */
export function normalizeReputationHost(host: string): string | null {
  const value = String(host ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
  return value.length <= 253 && HOST_PATTERN.test(value) ? value : null
}

/** A link reduced to what may be looked up: its host, and its address without query or fragment. */
export interface ReputationLink {
  host: string
  /** `scheme://host[:port]/path` — never a query string, a fragment or a `user:password@`. */
  url: string
}

/** A path segment that carries an email address, or a merge tag nobody has filled in. */
const PRIVATE_SEGMENT = /@|%40|\{|%7b|\}|%7d/i

/**
 * A link reduced to what Web Risk may be asked about it (AGL-3459), or null
 * for anything that is not an `http(s)` link to a real host.
 *
 * - `www.…`, `//…` and a bare host are read as `https://`;
 * - the query string, the fragment and any `user:password@` are dropped —
 *   that is where a recipient's address and a session's token live;
 * - the host is lowercased, a default port dropped, and `.` and `..`
 *   segments resolved (WHATWG URL rules);
 * - the path stops before the first segment carrying an email address or an
 *   unrendered merge tag, and is cut back to a `/` within
 *   {@link MAX_REPUTATION_URL_PATH_LENGTH}.
 */
export function normalizeReputationLink(link: string): ReputationLink | null {
  let text = String(link ?? '').trim()
  if (!text) return null
  if (text.startsWith('//')) text = `https:${text}`
  else if (/^www\./i.test(text)) text = `https://${text}`
  else if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) {
    if (!/^https?:\/\//i.test(text)) return null
  } else text = `https://${text}`
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const host = normalizeReputationHost(parsed.hostname)
  if (!host) return null
  const kept: string[] = []
  for (const segment of parsed.pathname.split('/')) {
    if (PRIVATE_SEGMENT.test(segment)) {
      kept.push('')
      break
    }
    kept.push(segment)
  }
  let path = kept.join('/') || '/'
  if (path.length > MAX_REPUTATION_URL_PATH_LENGTH) {
    path = path.slice(0, path.lastIndexOf('/', MAX_REPUTATION_URL_PATH_LENGTH - 1) + 1)
  }
  const port = parsed.port ? `:${parsed.port}` : ''
  return { host, url: `${parsed.protocol}//${host}${port}${path}` }
}

/** Is this address a host's front door — nothing a host lookup did not already ask? */
export function isRootReputationUrl(url: string): boolean {
  return /^https?:\/\/[^/]+\/$/.test(url)
}

/**
 * The addresses worth asking about beside `hosts`: those on one of them
 * whose path is more than `/`, each once, taken a host at a time — every
 * host's first address, then every host's second — up to `max`
 * ({@link MAX_REPUTATION_URLS_PER_LOOKUP}). A link that does not normalize
 * is skipped.
 */
export function pickReputationUrls(
  links: readonly string[],
  hosts: readonly string[],
  max: number = MAX_REPUTATION_URLS_PER_LOOKUP,
): string[] {
  const byHost = new Map<string, string[]>(hosts.map((host) => [host, []]))
  const seen = new Set<string>()
  for (const raw of links) {
    const link = normalizeReputationLink(raw)
    if (!link || seen.has(link.url) || isRootReputationUrl(link.url)) continue
    const list = byHost.get(link.host)
    if (!list) continue
    seen.add(link.url)
    list.push(link.url)
  }
  const picked: string[] = []
  for (let round = 0; picked.length < max; round += 1) {
    const before = picked.length
    for (const list of byHost.values()) {
      if (round < list.length && picked.length < max) picked.push(list[round])
    }
    if (picked.length === before) break
  }
  return picked
}

/** The foreign hosts a set of links points at, and the addresses on them worth asking about. */
export interface ForeignReputationLinks {
  hosts: string[]
  urls: string[]
}

/**
 * {@link foreignHostsForReputation} over links — hosts or whole links — and
 * the addresses on those hosts ({@link pickReputationUrls}). The addresses
 * are only ever looked up in `'url'` mode; the lookup decides.
 */
export function foreignLinksForReputation(
  links: readonly string[],
  options: {
    ownDomains?: readonly (string | null | undefined)[]
    excludeDomains?: readonly (string | null | undefined)[]
    max?: number
    maxUrls?: number
  } = {},
): ForeignReputationLinks {
  const parsed = links
    .map((link) => normalizeReputationLink(link))
    .filter((link): link is ReputationLink => Boolean(link))
  const hosts = foreignHostsForReputation(
    parsed.map((link) => link.host),
    options,
  )
  return { hosts, urls: pickReputationUrls(parsed.map((link) => link.url), hosts, options.maxUrls) }
}

/**
 * The hosts worth asking about: foreign ones. Not the workspace's own, not
 * a domain under one of `excludeDomains` (the platform's own), not a listed
 * brand's own domain and not a common social, maps or review link — those
 * are judged by the screen's rules, and asking about them would only spend
 * lookups. Deduplicated, in the order found, at most
 * {@link MAX_REPUTATION_HOSTS_PER_LOOKUP} unless `max` says otherwise.
 */
export function foreignHostsForReputation(
  hosts: readonly string[],
  options: {
    ownDomains?: readonly (string | null | undefined)[]
    excludeDomains?: readonly (string | null | undefined)[]
    max?: number
  } = {},
): string[] {
  const under = (list: readonly (string | null | undefined)[] | undefined) =>
    (list ?? [])
      .map((domain) => normalizeReputationHost(String(domain ?? '')))
      .filter((domain): domain is string => Boolean(domain))
  const own = [...under(options.ownDomains), ...under(options.excludeDomains)]
  const max = options.max ?? MAX_REPUTATION_HOSTS_PER_LOOKUP
  const out: string[] = []
  for (const raw of hosts) {
    if (out.length >= max) break
    const host = normalizeReputationHost(raw)
    if (!host || out.includes(host)) continue
    if (own.some((domain) => host === domain || host.endsWith(`.${domain}`))) continue
    const registrable = registrableDomain(host)
    if (isAnyOfficialBrandDomain(registrable) || isCommonLinkDomain(registrable)) continue
    out.push(host)
  }
  return out
}

/** A listing, as the screen's signal. */
export function webRiskSignals(hits: readonly HostReputationHit[]): PhishingScreenSignal[] {
  return hits.map((hit) => ({
    code: 'web-risk-link' as const,
    host: hit.host,
    threats: [...new Set(hit.threats)].sort(),
    ...(hit.url ? { url: hit.url } : {}),
  }))
}

/**
 * Look the foreign links up through the installed lookup and answer the
 * signals they carry. `links` are hosts or whole links (`linkUrlsIn`): the
 * hosts are asked about, and their addresses too when the lookup is in
 * `'url'` mode. Nothing installed, nothing foreign, an error: no signals.
 * Never throws.
 */
export async function linkReputationSignals(
  links: readonly string[],
  options: {
    ownDomains?: readonly (string | null | undefined)[]
    excludeDomains?: readonly (string | null | undefined)[]
    deadlineMs?: number
  } = {},
): Promise<PhishingScreenSignal[]> {
  const lookup = installedLookup
  if (!lookup) return []
  const foreign = foreignLinksForReputation(links, options)
  if (!foreign.hosts.length) return []
  try {
    const answer = await lookup(foreign.hosts, { deadlineMs: options.deadlineMs, urls: foreign.urls })
    return webRiskSignals(
      answer.hits.filter(
        (hit) => foreign.hosts.includes(hit.host) && (!hit.url || foreign.urls.includes(hit.url)),
      ),
    )
  } catch (error) {
    console.warn('[link-reputation] the lookup failed — no signal', error)
    return []
  }
}
