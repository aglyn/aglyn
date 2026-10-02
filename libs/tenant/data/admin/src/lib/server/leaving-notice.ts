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
 * THE "YOU'RE LEAVING THIS SITE" NOTICE, SERVER HALF (AGL-3452).
 *
 * Who gets it, which hosts are exempt, and the signature that keeps the
 * notice route from becoming an open redirect. The client half — rewriting
 * an href, the click interceptor — is `@aglyn/aglyn/app-utils/leaving-notice`.
 *
 * ## Who
 *
 * A site whose workspace is on the FREE plan (the effective plan, so a dead
 * subscription counts as free, as it does for every entitlement) and in its
 * first {@link LEAVING_NOTICE_DAYS} days — the same window, read through the
 * same `isYoungWorkspaceAge`, as the soft phishing rules. Paid and older
 * workspaces are untouched, and a workspace whose creation date cannot be
 * read is an existing customer, never a new one.
 *
 * ## Why signed
 *
 * The notice lives on the site's own host and its Continue button goes
 * wherever `?to=` says. Unsigned, any site's notice would be a page that
 * vouches for any address anyone puts in a link — the hop this feature exists
 * to remove. So the server signs each outside address it finds on a page it
 * renders, bound to that site, and the route shows a Continue button only for
 * an address whose signature checks out. Everything else is refused.
 *
 * The signature carries no expiry on purpose. The route never redirects on
 * its own, so a signature that outlives its page buys nothing but one more
 * view of the same warning — while an expiring one would break the links an
 * ISR-cached page is still serving the moment the window closes.
 *=========================================*/

import { createHmac } from 'crypto'
import { DOCS_BASE_URL } from '@aglyn/aglyn/app-utils/docs-help'
import {
  type LeavingNoticeConfig,
  leavingDestination,
  normalizeLeavingDestination,
} from '@aglyn/aglyn/app-utils/leaving-notice'
import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  PLATFORM_HOME_URL,
  PLATFORM_SUPPORT_URL,
  platformConsoleOrigin,
} from '@aglyn/aglyn/app-utils/platform-brand'
import {
  type SiteReturnHost,
  siteOwnHosts,
} from '@aglyn/aglyn/app-utils/site-return-url'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import {
  isYoungWorkspaceAge,
  OUTBOUND_REVIEW_YOUNG_DAYS,
  registrableDomain,
} from '@aglyn/shared-util-email/outbound-phishing-screen'
import { tokenSigningSecret } from './media-signing'
import { orgAgeDays, orgCreatedMs } from './org-age'
import { safeEqual } from './safe-equal'

/** How long a new free workspace's sites carry the notice. */
export const LEAVING_NOTICE_DAYS = OUTBOUND_REVIEW_YOUNG_DAYS

const DAY_MS = 86_400_000

/**
 * The most outside addresses one page is signed for. A page with more is a
 * link farm, and the ones past the cap still go through the notice — which
 * refuses them — rather than around it.
 */
export const LEAVING_NOTICE_MAX_DESTINATIONS = 500

/** Deepest a page payload is walked; composed node maps sit far above it. */
const MAX_WALK_DEPTH = 64

/** Longest string scanned for embedded addresses (a long entry body). */
const MAX_SCANNED_STRING = 200_000

/**
 * When a workspace's notice window closes (epoch ms), or `null` when its
 * sites carry no notice: a paid plan, a workspace past its first
 * {@link LEAVING_NOTICE_DAYS} days, or one whose creation date is unreadable.
 *
 * Takes the org as loaded anywhere — a live document, or the render cache's
 * JSON copy, whose `createdAt` has lost its methods (`orgCreatedMs`).
 */
export function leavingNoticeEndsAt(
  org: unknown,
  nowMs: number = Date.now(),
): number | null {
  if (!org || typeof org !== 'object') return null
  if (resolveEffectivePlan(org as never) !== 'free') return null
  const createdAt = (org as { createdAt?: unknown }).createdAt
  if (!isYoungWorkspaceAge(orgAgeDays(createdAt, nowMs))) return null
  const createdMs = orgCreatedMs(createdAt)
  return createdMs === null ? null : createdMs + LEAVING_NOTICE_DAYS * DAY_MS
}

function hostnameOf(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * The hosts a link may reach without the notice: the site's own (its
 * subdomain, its custom domain and `www.` of it) and the platform's own — the
 * marketing site, console, support and docs, each with every name under its
 * registrable domain, plus the bare tenant apex.
 *
 * Other sites on the tenant apex are NOT exempt. They are other customers'
 * sites, and a chain of two new free sites is the same hop as one.
 */
export function leavingNoticeHosts(
  site: SiteReturnHost | null | undefined,
): string[] {
  const hosts = new Set<string>(siteOwnHosts(site))
  const apex = TENANT_APEX.toLowerCase()
  hosts.add(apex)
  const apexRegistrable = registrableDomain(apex)
  for (const raw of [
    PLATFORM_HOME_URL,
    platformConsoleOrigin(),
    PLATFORM_SUPPORT_URL,
    DOCS_BASE_URL,
  ]) {
    const hostname = hostnameOf(raw)
    if (!hostname) continue
    hosts.add(hostname)
    const registrable = registrableDomain(hostname)
    // A platform name under the tenant apex itself must not exempt the apex:
    // that would exempt every customer's site with it.
    if (registrable.includes('.') && registrable !== apexRegistrable) {
      hosts.add(`.${registrable}`)
    }
  }
  return [...hosts]
}

/** An address as it appears in text: scheme, then anything a URL may hold. */
const EMBEDDED_URL = /https?:\/\/[^\s"'<>()[\]{}\\^`|]+/gi

/** Characters prose puts after an address that the address does not own. */
const TRAILING_PROSE = /[.,;:!?'"*_~]+$/

/** A whole value shaped like an absolute or protocol-relative address. */
const ADDRESS_SHAPE = /^\s*(?:https?:|[\\/]{2})/i

/**
 * Every outside address a rendered page could link to: each string in the
 * payload that is one, and each one embedded in a string (Markdown, rich
 * text HTML, a plain sentence). Over-collecting is harmless — a signature
 * nobody follows is never read — and under-collecting only sends a link to a
 * refusal, never around the notice.
 *
 * Returned normalized, the spelling the client looks signatures up by.
 */
export function collectLeavingDestinations(
  value: unknown,
  hosts: readonly string[],
  limit: number = LEAVING_NOTICE_MAX_DESTINATIONS,
): string[] {
  const found = new Set<string>()
  const consider = (candidate: string) => {
    if (found.size >= limit) return
    const destination = leavingDestination(candidate, hosts)
    if (destination) found.add(destination)
  }
  const scan = (text: string) => {
    if (ADDRESS_SHAPE.test(text)) consider(text)
    if (!text.includes('http')) return
    const scanned =
      text.length > MAX_SCANNED_STRING ? text.slice(0, MAX_SCANNED_STRING) : text
    for (const match of scanned.matchAll(EMBEDDED_URL)) {
      const raw = match[0]
      consider(raw)
      const trimmed = raw.replace(TRAILING_PROSE, '')
      if (trimmed !== raw) consider(trimmed)
      // An href inside stored HTML is entity-encoded; the DOM decodes it.
      if (trimmed.includes('&amp;')) consider(trimmed.replace(/&amp;/g, '&'))
    }
  }
  const walk = (node: unknown, depth: number) => {
    if (found.size >= limit || depth > MAX_WALK_DEPTH) return
    if (typeof node === 'string') {
      scan(node)
    } else if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
    } else if (node && typeof node === 'object') {
      for (const item of Object.values(node)) walk(item, depth + 1)
    }
  }
  walk(value, 0)
  return [...found]
}

function leavingSignature(hostId: string, destination: string): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`leaving-notice:v1:${hostId}:${destination}`)
    .digest('base64url')
}

/**
 * The signature for one destination on one site. Throws when the deployment
 * has no signing secret, like every signer of it.
 */
export function signLeavingDestination(
  hostId: string,
  destination: string,
): string {
  const normalized = normalizeLeavingDestination(destination)
  if (!hostId || !normalized) {
    throw new Error('A leaving-notice signature needs a site and an address')
  }
  return leavingSignature(hostId, normalized)
}

/**
 * Whether `signature` was issued for `destination` on this site. False for
 * anything else — another site's signature, an edited address, a missing
 * secret (fail closed).
 */
export function verifyLeavingDestination(
  hostId: string,
  destination: unknown,
  signature: unknown,
): boolean {
  if (!hostId || typeof signature !== 'string' || signature.length > 128) {
    return false
  }
  const normalized = normalizeLeavingDestination(destination)
  if (!normalized) return false
  let expected: string
  try {
    expected = leavingSignature(hostId, normalized)
  } catch {
    return false
  }
  return safeEqual(signature, expected)
}

/** Signs a page's destinations for one site. */
export function signLeavingDestinations(
  hostId: string,
  destinations: readonly string[],
): Record<string, string> {
  const sigs: Record<string, string> = {}
  for (const destination of destinations) {
    sigs[destination] = leavingSignature(hostId, destination)
  }
  return sigs
}

/** Whether this deployment can sign at all. */
function canSign(): boolean {
  try {
    tokenSigningSecret()
    return true
  } catch {
    return false
  }
}

/**
 * What a published page of this site carries, or `null` when the site is not
 * in its window.
 *
 * `content` is everything the page renders from — its props, its nodes —
 * walked for outside addresses to sign.
 *
 * A deployment with no signing secret gets no notice, loudly. The route
 * could verify nothing there and would refuse every link on every new free
 * site; an outage of every outbound link is not a safer failure than the
 * links working as they did before this existed.
 */
export function leavingNoticeConfig(options: {
  hostId: string | null | undefined
  site: SiteReturnHost | null | undefined
  org: unknown
  content?: unknown
  nowMs?: number
}): LeavingNoticeConfig | null {
  const { hostId, site, org, content } = options
  if (!hostId || !site) return null
  const until = leavingNoticeEndsAt(org, options.nowMs)
  if (until === null) return null
  if (!canSign()) {
    console.error(
      '[leaving-notice] TOKEN_SIGNING_SECRET is not configured; the notice is off',
    )
    return null
  }
  const hosts = leavingNoticeHosts(site)
  return {
    until,
    hosts,
    sigs: signLeavingDestinations(
      hostId,
      collectLeavingDestinations(content, hosts),
    ),
  }
}

/**
 * Only the signatures, for a payload that arrives after its page — a gated
 * screen's nodes (`enrichGatedScreenPage`). `null` outside the window.
 */
export function leavingNoticeSignatures(options: {
  hostId: string | null | undefined
  site: SiteReturnHost | null | undefined
  org: unknown
  content: unknown
  nowMs?: number
}): Record<string, string> | null {
  const config = leavingNoticeConfig(options)
  return config && Object.keys(config.sigs).length ? config.sigs : null
}
