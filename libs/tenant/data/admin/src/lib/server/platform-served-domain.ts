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

import { liveCustomDomain, TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import type { ProjectDomainStatus } from './domain-provider'
import firebaseAdmin from './firebase-admin'
import { PLATFORM_DOMAIN_PATTERN, MAX_DOMAIN_LENGTH } from './platform-domain-names'
import { projectDomainStatus } from './workspace-domains'

/*==========================================
 * WHETHER THIS PLATFORM SERVES A HOSTNAME (AGL-4085).
 *
 * The question a caller asks before it hands a request a secret that only
 * our own edge may see: the site-import crawler's edge secret
 * (`site-import-edge.ts` in the AI plugin), which lifts the tenant's bot
 * challenge for AglynBot. A wrong "yes" sends that
 * secret to a stranger, so this answers from our own records and from the
 * hosting platform's live view, never from the shape of the name:
 *
 *  - `{sub}.{TENANT_APEX}` is ours only when exactly one host carries that
 *    `subdomain`. The apex's DNS is ours, so no one else can answer for it.
 *  - Any other name is ours only when exactly one host carries it as its
 *    `cname` (and `liveCustomDomain` says it serves: no attach or detach left
 *    pending), or as its `cnameTwin` with the twin's redirect landed. That is
 *    what the tenant's own `get-host.ts` resolves a request by.
 *  - AND the hosting platform says, right now, that the name is attached to
 *    the tenant deployment, verified, pointed at it with no foreign record
 *    answering beside ours, and holding a certificate (`state: 'serving'`,
 *    no `conflicts`). A customer's DNS was checked once, when they connected
 *    the name; a name re-pointed since at a server of their own still reads
 *    as live in Firestore, and only this read sees it.
 *
 * Every doubt is a "no": a query that fails, two hosts claiming one name, a
 * status the platform could not answer (`unknown`), a deployment with no
 * domain provider (`skipped`). A "no" costs only the challenge the crawler
 * met before this existed.
 *
 * What it cannot see: DNS that changes between this read and the request a
 * moment later. The secret that window could expose lifts the bot challenge
 * and nothing else (no sign-in, no lockdown, no rate limit), and the edge
 * rule asks for the AglynBot user agent as well.
 *=========================================*/

/** The host fields a domain decision reads, and nothing else. */
export interface HostDomainRecord {
  id: string
  subdomain?: string | null
  cname?: string | null
  cnameTwin?: string | null
  cnameAttachmentPending?: boolean | null
  cnameDetachmentPending?: boolean | null
  cnameTwinPending?: boolean | null
}

export type HostDomainField = 'subdomain' | 'cname' | 'cnameTwin'

export type PlatformServedVerdict =
  | { served: true; via: 'subdomain' | 'cname' | 'twin'; hostId: string }
  | {
      served: false
      reason:
        /** Not a hostname at all, or the tenant apex itself. */
        | 'not-a-hostname'
        /** No host carries the name. */
        | 'no-host'
        /** More than one host carries the name; connect-time uniqueness failed. */
        | 'ambiguous'
        /** A host carries it, but its attach, detach or twin never landed. */
        | 'not-live'
        /** The hosting platform does not say the name serves on our deployment now. */
        | 'not-serving'
        /** A read failed. */
        | 'error'
    }

export interface PlatformServedDeps {
  /** At most two hosts whose `field` equals `value`. */
  findHosts?: (field: HostDomainField, value: string) => Promise<HostDomainRecord[]>
  /** The hosting platform's live view of a name on the tenant deployment. */
  domainStatus?: (hostname: string) => Promise<ProjectDomainStatus>
}

const HOST_DOMAIN_FIELDS = [
  'subdomain',
  'cname',
  'cnameTwin',
  'cnameAttachmentPending',
  'cnameDetachmentPending',
  'cnameTwinPending',
] as const

async function findHostsInFirestore(field: HostDomainField, value: string): Promise<HostDomainRecord[]> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .where(field, '==', value)
    .select(...HOST_DOMAIN_FIELDS)
    .limit(2)
    .get()
  return snapshot.docs.map((doc) => {
    const data = doc.data() as Omit<HostDomainRecord, 'id'>
    return { ...data, id: doc.id }
  })
}

/** A request's hostname, lowercased and without a trailing dot; null for anything else. */
export function normalizeServedHostname(input: string): string | null {
  const name = String(input ?? '').trim().toLowerCase().replace(/\.+$/, '')
  if (!name || name.length > MAX_DOMAIN_LENGTH) return null
  if (!PLATFORM_DOMAIN_PATTERN.test(name)) return null
  return name
}

/** Whether a name serves on our deployment, and why not when it does not. Never throws. */
export async function platformServedDomain(
  hostname: string,
  deps: PlatformServedDeps = {},
): Promise<PlatformServedVerdict> {
  const name = normalizeServedHostname(hostname)
  if (!name || name === TENANT_APEX) return { served: false, reason: 'not-a-hostname' }
  const findHosts = deps.findHosts ?? findHostsInFirestore
  const domainStatus = deps.domainStatus ?? ((host: string) => projectDomainStatus(host, { scope: 'tenant' }))

  try {
    // A platform subdomain: one label under the apex, held by exactly one host.
    if (name.endsWith(`.${TENANT_APEX}`)) {
      const sub = name.slice(0, -(TENANT_APEX.length + 1))
      if (!sub || sub.includes('.')) return { served: false, reason: 'no-host' }
      const hosts = (await findHosts('subdomain', sub)).filter((host) => host.subdomain === sub)
      if (hosts.length === 0) return { served: false, reason: 'no-host' }
      if (hosts.length > 1) return { served: false, reason: 'ambiguous' }
      return { served: true, via: 'subdomain', hostId: hosts[0].id }
    }

    // A custom domain: the host's own name, else the twin that forwards to it.
    let match: { host: HostDomainRecord; via: 'cname' | 'twin' } | null = null
    const byCname = (await findHosts('cname', name)).filter(
      (host) => String(host.cname ?? '').trim().toLowerCase() === name,
    )
    if (byCname.length > 1) return { served: false, reason: 'ambiguous' }
    if (byCname.length === 1) match = { host: byCname[0], via: 'cname' }
    if (!match) {
      const byTwin = (await findHosts('cnameTwin', name)).filter(
        (host) => String(host.cnameTwin ?? '').trim().toLowerCase() === name,
      )
      if (byTwin.length > 1) return { served: false, reason: 'ambiguous' }
      if (byTwin.length === 1) match = { host: byTwin[0], via: 'twin' }
    }
    if (!match) return { served: false, reason: 'no-host' }

    const primary = liveCustomDomain(match.host)
    if (!primary) return { served: false, reason: 'not-live' }
    if (match.via === 'cname' && primary !== name) return { served: false, reason: 'not-live' }
    if (match.via === 'twin' && match.host.cnameTwinPending === true) return { served: false, reason: 'not-live' }

    const status = await domainStatus(name)
    const conflicts = Array.isArray(status?.conflicts) ? status.conflicts : []
    if (status?.state !== 'serving' || conflicts.length > 0) return { served: false, reason: 'not-serving' }
    return { served: true, via: match.via, hostId: match.host.id }
  } catch (error) {
    console.error('[platform-served-domain] could not decide; answering no', name, error)
    return { served: false, reason: 'error' }
  }
}

/** {@link platformServedDomain} as a yes or no. */
export async function isPlatformServedDomain(hostname: string, deps: PlatformServedDeps = {}): Promise<boolean> {
  return (await platformServedDomain(hostname, deps)).served
}
