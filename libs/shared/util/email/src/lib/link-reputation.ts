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
 * ## Only the host
 *
 * The lookup sees `https://<host>/` and nothing else: never the path, the
 * query, the page or the message. A host is enough to catch a domain that
 * exists to harvest, and it is the least a third party can be told.
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

/** A host the list names, and what it names it for. */
export interface HostReputationHit {
  host: string
  threats: LinkThreatType[]
}

/** What one lookup answered, host by host. */
export interface LinkReputationAnswer {
  /** Hosts the list names. */
  hits: HostReputationHit[]
  /** Hosts the list does not name. */
  clean: string[]
  /** Hosts nobody could answer for: an error, a timeout, a switched-off lookup. */
  unknown: string[]
}

export interface LinkReputationLookupOptions {
  /** How long the caller will wait, overall. */
  deadlineMs?: number
}

export type LinkReputationLookup = (
  hosts: readonly string[],
  options?: LinkReputationLookupOptions,
) => Promise<LinkReputationAnswer>

/** The most foreign hosts one page, message or redirect is looked up for. */
export const MAX_REPUTATION_HOSTS_PER_LOOKUP = 20

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
  }))
}

/**
 * Look the foreign hosts up through the installed lookup and answer the
 * signals they carry. Nothing installed, nothing foreign, an error: no
 * signals. Never throws.
 */
export async function linkReputationSignals(
  hosts: readonly string[],
  options: {
    ownDomains?: readonly (string | null | undefined)[]
    excludeDomains?: readonly (string | null | undefined)[]
    deadlineMs?: number
  } = {},
): Promise<PhishingScreenSignal[]> {
  const lookup = installedLookup
  if (!lookup) return []
  const foreign = foreignHostsForReputation(hosts, options)
  if (!foreign.length) return []
  try {
    const answer = await lookup(foreign, { deadlineMs: options.deadlineMs })
    return webRiskSignals(answer.hits.filter((hit) => foreign.includes(hit.host)))
  } catch (error) {
    console.warn('[link-reputation] the lookup failed — no signal', error)
    return []
  }
}
