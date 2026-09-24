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

import {
  normalizeSendingDomain,
  SENDING_TRACKING_SUBDOMAIN,
  sendingTrackingHost,
  trackingRecords,
  validateSendingDomain,
  type SendingDnsRecord,
  type SendingDomainStatus,
} from './sending-domain'

/**
 * A CLICK-TRACKING HOST THIS DEPLOYMENT SERVES ITSELF — policy half.
 *
 * ## The same process as a sending domain's, with our redirector
 *
 * Campaign mail leaves through the mail provider, which rewrites every link to
 * `links.<sending domain>` and redirects from there: the customer publishes a
 * CNAME to the provider's host and the provider holds the certificate
 * (`trackingRecords` in `sending-domain.ts`).
 *
 * Mail that leaves any other way — a sequence, sent as plain text through the
 * member's own Gmail — never passes the provider, so the provider cannot
 * rewrite or redirect its links. Its redirector is ours. What stays the same is
 * everything a customer sees: the label ({@link SENDING_TRACKING_SUBDOMAIN}),
 * the host (`links.<the mailbox's domain>`), a CNAME to publish, and a check
 * that says when it is live. Only the CNAME's target differs — this
 * deployment instead of the provider.
 *
 * ## Serving the name is a driver's job
 *
 * Attaching `links.<domain>` to the deployment and getting it a certificate is
 * the domain driver's (`AGLYN_DOMAIN_PROVIDER`, `domain-provider.ts`), the
 * same seam a workspace subdomain goes through: Vercel attaches it to the
 * console project; `none` leaves it to the operator's DNS and proxy. Either
 * way the host is served by the console app itself — the middleware answers
 * only this module's paths on it ({@link trackingHostPath}) — so it works on
 * any deployment, not just one vendor's edge.
 *
 * ## Verified by asking the host, not by reading a zone
 *
 * A zone can serve the name without the literal CNAME we print — a wildcard,
 * an ALIAS, a proxy that terminates TLS itself — and a zone can carry the
 * CNAME while nothing answers on it yet. So the check is end to end: fetch
 * {@link TRACKING_HOST_PROBE_PATH} over HTTPS on the host and require this
 * app's answer ({@link readTrackingHostProbe}). A valid certificate, working
 * DNS and the routing all have to be true for that to succeed, and nothing
 * less than all three is a host a link should point at.
 *
 * ## Only a verified host is ever used
 *
 * {@link trackingHostLinkOrigin} answers `null` for anything short of
 * `verified`, and the caller falls back to the app's own address — so an
 * install with no host set up, or one half set up, sends exactly the links it
 * always did.
 */

/**
 * The path the host answers its verification probe on.
 *
 * Not under `/.well-known/`, which the console refuses wholesale (AGL-3016),
 * and not shaped like a link id, so the two can never be confused.
 */
export const TRACKING_HOST_PROBE_PATH = '/_aglyn/link-host'

/** What the probe's JSON names itself, so a stray 200 is not mistaken for it. */
export const TRACKING_HOST_PROBE_SERVICE = 'aglyn-link-host'

/**
 * The console route a tracking host's ids resolve on.
 *
 * Sequences' short-link redirector (AGL-3297) — the only mail this deployment
 * rewrites links for itself. A link `https://links.<domain>/<id>` is answered
 * exactly as `<console>/api/outreach/l/<id>` is, by the same handler.
 */
export const TRACKING_HOST_LINK_ROUTE = '/api/outreach/l'

/**
 * A link id as the host accepts one in its path: a single segment of letters
 * and digits. The redirector checks its own exact shape; this only keeps
 * every other path off it.
 */
const LINK_ID_PATH = /^\/([A-Za-z0-9]{6,32})$/

/** What the host does with one request path. */
export type TrackingHostRoute =
  | { kind: 'link'; rewrite: string }
  | { kind: 'probe' }
  | { kind: 'not-found' }

/**
 * Whether a hostname is shaped like a tracking host: `links.` over a valid
 * domain. Shape only — whether this deployment serves it is the driver's and
 * the probe's to say.
 */
export function isTrackingHostName(hostname: string | null | undefined): boolean {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/\.$/, '')
  const prefix = `${SENDING_TRACKING_SUBDOMAIN}.`
  if (!host.startsWith(prefix)) return false
  return sendingTrackingHost(host.slice(prefix.length)) === host
}

/**
 * What a tracking host answers for a path: a link id is rewritten to the
 * redirector, the probe is answered, and everything else is a 404 — no
 * console page, no API route, nothing but links.
 */
export function trackingHostPath(pathname: string): TrackingHostRoute {
  if (pathname === TRACKING_HOST_PROBE_PATH) return { kind: 'probe' }
  const id = LINK_ID_PATH.exec(pathname)?.[1]
  return id ? { kind: 'link', rewrite: `${TRACKING_HOST_LINK_ROUTE}/${id}` } : { kind: 'not-found' }
}

/** The probe's answer on `host`. */
export function trackingHostProbeBody(host: string): { service: string; host: string } {
  return { service: TRACKING_HOST_PROBE_SERVICE, host: String(host ?? '').toLowerCase() }
}

/** Whether a probe response body is this app answering for `host`. */
export function readTrackingHostProbe(body: unknown, host: string): boolean {
  if (!body || typeof body !== 'object') return false
  const record = body as Record<string, unknown>
  return (
    record['service'] === TRACKING_HOST_PROBE_SERVICE &&
    String(record['host'] ?? '').toLowerCase() === String(host ?? '').toLowerCase()
  )
}

/*==========================================
  The record
==========================================*/

/**
 * The stored record, one per sending domain per org, at
 * `orgs/{orgId}/trackingHosts/{domain}`.
 *
 * `status` is the sending domain's lifecycle, reused so a surface reads both
 * the same way: `requested` (asked, but the driver could not attach the
 * name), `records-issued` (attached; DNS or the certificate still to come),
 * `verified` (the probe answered over HTTPS), `failed` (we looked, and it did
 * not).
 */
export interface TrackingHostRecord {
  /** The sending domain, normalized. Also the document id. */
  domain: string
  /** `links.<domain>`. */
  host: string
  status: SendingDomainStatus
  /** The CNAME target the member is shown, or `null` when the deployment names none. */
  target?: string | null
  /** The domain driver that attached the host (`vercel`, `none`, …). */
  provider?: string | null
  /**
   * Records the driver needs before it will serve the name — Vercel's
   * ownership TXT for a domain another account holds, for instance.
   */
  verification?: Array<{ type: string; domain: string; value: string; reason?: string }> | null
  /** Why it is not verified, from {@link TRACKING_HOST_DETAIL}'s vocabulary. */
  lastDetail?: string | null
  createdAtMs?: number | null
  verifiedAtMs?: number | null
  lastCheckedAtMs?: number | null
}

/**
 * What setting up, checking or removing a host answers. Both keys always
 * present, one always null — `strictNullChecks` is off.
 */
export interface TrackingHostResult {
  record: TrackingHostRecord | null
  error: string | null
  /** The HTTP status a route should answer with. */
  status: number
}

/** Why a host is not verified, as a person reads it. Keys are what is stored. */
export const TRACKING_HOST_DETAIL = {
  'attach-failed': "This deployment could not add the link domain. Try again, or ask your administrator.",
  'provider-tracked':
    'This domain already sends campaign mail with click tracking, so its link domain belongs to the mail provider. Sequence links keep the app address.',
  'ownership-pending': 'Add the verification record below, then check again.',
  'dns-misconfigured': 'The DNS record is missing or points somewhere else.',
  'certificate-pending': 'The DNS record is in place and the certificate is being issued. Check again in a few minutes.',
  unreachable: 'The link domain did not answer over HTTPS yet. DNS can take a while to spread; check again later.',
  'not-this-app': 'The link domain answered, but not from this app. Point it at this deployment.',
} as const

export type TrackingHostDetail = keyof typeof TRACKING_HOST_DETAIL

/**
 * The CNAME target a customer is told to point `links.<domain>` at, or `null`
 * when the deployment names none.
 *
 * `AGLYN_LINK_HOST_TARGET` wins — a self-hoster's proxy hostname. Without it,
 * the Vercel driver's documented target; any other driver has no default to
 * guess, and the card says to point the name at this app instead.
 */
export function trackingHostTarget(providerId: string | null | undefined): string | null {
  const configured = String(process.env['AGLYN_LINK_HOST_TARGET'] ?? '').trim().replace(/\.$/, '')
  if (configured) return configured
  return providerId === 'vercel' ? 'cname.vercel-dns.com' : null
}

/**
 * The CA that issues a self-served tracking host's certificate — Let's
 * Encrypt, which is what Vercel, Caddy and Traefik use by default. Only ever
 * printed in the CAA row, which only matters to a zone that already
 * publishes CAA.
 */
export function trackingHostCertAuthority(): string {
  return String(process.env['AGLYN_LINK_HOST_CA'] ?? '').trim() || 'letsencrypt.org'
}

/**
 * The records a member publishes for a tracking host: the same tracking rows
 * a sending domain prints, pointed at this deployment, then any the driver
 * asked for.
 */
export function trackingHostDnsRecords(
  record: Pick<TrackingHostRecord, 'domain' | 'target' | 'verification'>,
): SendingDnsRecord[] {
  const domain = normalizeSendingDomain(record?.domain ?? '')
  const rows = trackingRecords(domain, record?.target, trackingHostCertAuthority())
  for (const entry of record?.verification ?? []) {
    const type = String(entry?.type ?? '').toUpperCase()
    if (type !== 'TXT' && type !== 'CNAME') continue
    rows.push({
      type,
      name: String(entry.domain ?? ''),
      value: String(entry.value ?? ''),
      purpose: 'tracking',
      required: true,
      note: 'Proves to the hosting provider that you own this name. It can be removed once the link domain is verified.',
    })
  }
  return rows
}

/**
 * The origin links should use for mail from `domain` — `https://links.<domain>`
 * — or `null` for a record that is absent or not verified, which means "use
 * the app's own address".
 */
export function trackingHostLinkOrigin(record: TrackingHostRecord | null | undefined): string | null {
  if (!record || record.status !== 'verified') return null
  const host = sendingTrackingHost(record.domain)
  return host && host === record.host ? `https://${host}` : null
}

/** A domain a tracking host may be set up for, or an error sentence. */
export function validateTrackingHostDomain(input: string): { domain: string | null; error: string | null } {
  return validateSendingDomain(input)
}
