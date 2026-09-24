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

import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import {
  sendingTrackingHost,
  TRACKING_HOST_DETAIL,
  trackingHostDnsRecords,
  trackingHostLinkOrigin,
  validateTrackingHostDomain,
  type TrackingHostRecord,
  type TrackingHostResult,
} from '@aglyn/shared-util-email'
import { OUTREACH_SHORT_LINK_PATH } from '../runtime/click-link'
import type {
  OutreachLinkDomain,
  OutreachLinkDomainRequest,
  OutreachLinkDomainResponse,
  OutreachLinkDomainsResponse,
} from '../model/outreach-api'
import { OUTREACH_COLLECTIONS } from '../model/outreach.types'
import { readStoredOutreachMailbox } from '../model/stored-records'
import type { OutreachRouteDeps } from './route-deps'
import { outreachRouteGate, type OutreachRouteCaller } from './route-gate'
import {
  outreachMethodNotAllowed,
  outreachOk,
  outreachRefusal,
  readOutreachJsonBody,
} from './route-http'

/**
 * THE LINK DOMAINS ROUTE (AGL-3306): `outreach/link-domains`.
 *
 * A tracked sequence link reads `https://links.<the mailbox's domain>/<id>`
 * once the organization has set that host up and it has verified — the same
 * `links.` label, the same CNAME-and-check process, as a sending domain's
 * campaign click tracking, with this deployment in place of the mail
 * provider (`tracking-host.ts`). Until then it reads the console's own
 * `/api/outreach/l/<id>`, as it always has.
 *
 * `GET ?orgId` lists one row per sending domain of the organization's
 * connected mailboxes, plus any host still set up for a domain no mailbox
 * sends as any more (so it can be removed). `POST` sets one up — the domain
 * driver attaches the host — checks it, or removes it. Only a domain a
 * mailbox of the organization sends as may be set up: the host is a claim
 * about mail the organization actually sends.
 *
 * Setting up and removing change what this deployment serves, so they are
 * an owner's or an admin's; checking changes nothing but the verdict, and
 * the list is everyone's who may use Sequences.
 */

/** The platform's tracking-host store (`@aglyn/tenant-data-admin`); specs build their own. */
export interface OutreachTrackingHosts {
  list(firestore: FirebaseFirestore.Firestore, orgId: string): Promise<TrackingHostRecord[]>
  setUp(input: HostInput): Promise<TrackingHostResult>
  verify(input: HostInput): Promise<TrackingHostResult>
  remove(input: HostInput): Promise<TrackingHostResult>
}

interface HostInput {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  domain: string
  nowMs: number
}

export interface OutreachLinkDomainRouteDeps {
  hosts(): Promise<OutreachTrackingHosts>
  /** The console's own HTTPS origin, for the link prefix a domain without a host uses. */
  consoleOrigin(): string | null
}

/** The activity lines a change writes. */
export const OUTREACH_LINK_DOMAIN_ACTIVITY = {
  'set-up': (host: string) => `Set up ${host} as a Sequences link domain`,
  remove: (host: string) => `Removed ${host} as a Sequences link domain`,
} as const

/** The sending domain of every connected mailbox, alphabetically. */
async function mailboxDomains(firestore: FirebaseFirestore.Firestore, orgId: string): Promise<string[]> {
  const snapshot = await firestore.collection('orgs').doc(orgId).collection(OUTREACH_COLLECTIONS.mailboxes).get()
  const domains = new Set<string>()
  for (const doc of snapshot.docs) {
    const mailbox = readStoredOutreachMailbox(doc.id, doc.data())
    if (!mailbox) continue
    const domain = validateTrackingHostDomain(mailbox.sendAs || mailbox.email).domain
    if (domain) domains.add(domain)
  }
  return [...domains].sort()
}

function row(domain: string, record: TrackingHostRecord | null, consoleOrigin: string | null): OutreachLinkDomain {
  const origin = trackingHostLinkOrigin(record)
  const detailKey = record?.lastDetail as keyof typeof TRACKING_HOST_DETAIL | null | undefined
  return {
    domain,
    host: record?.host ?? sendingTrackingHost(domain),
    status: record?.status ?? 'not-set-up',
    records: record
      ? trackingHostDnsRecords(record).map(({ type, name, value, required, note }) => ({
          type,
          name,
          value,
          required,
          note,
        }))
      : [],
    detail: detailKey && detailKey in TRACKING_HOST_DETAIL ? TRACKING_HOST_DETAIL[detailKey] : null,
    linkPrefix: origin ? `${origin}/` : consoleOrigin ? `${consoleOrigin}${OUTREACH_SHORT_LINK_PATH}/` : null,
    checkedAtMs: record?.lastCheckedAtMs ?? null,
    verifiedAtMs: record?.verifiedAtMs ?? null,
  }
}

async function listing(
  deps: OutreachRouteDeps,
  links: OutreachLinkDomainRouteDeps,
  gate: OutreachRouteCaller,
): Promise<OutreachLinkDomainsResponse> {
  const firestore = deps.firestore()
  const [domains, records] = await Promise.all([
    mailboxDomains(firestore, gate.orgId),
    (await links.hosts()).list(firestore, gate.orgId),
  ])
  const byDomain = new Map(records.map((record) => [record.domain, record]))
  const all = [...new Set([...domains, ...byDomain.keys()])].sort()
  const consoleOrigin = links.consoleOrigin()
  return {
    ok: true,
    domains: all.map((domain) => row(domain, byDomain.get(domain) ?? null, consoleOrigin)),
    canManage: gate.isOrgAdmin,
  }
}

export function createOutreachLinkDomainsRoute(
  deps: OutreachRouteDeps,
  links: OutreachLinkDomainRouteDeps,
): PluginWebApiHandler {
  return async (request) => {
    if (request.method === 'GET') {
      const gate = await outreachRouteGate(request, new URL(request.url).searchParams.get('orgId'), deps.gate)
      if (gate instanceof Response) return gate
      return outreachOk(await listing(deps, links, gate))
    }
    if (request.method !== 'POST') return outreachMethodNotAllowed('GET, POST')

    const body = await readOutreachJsonBody(request)
    const gate = await outreachRouteGate(request, body['orgId'], deps.gate)
    if (gate instanceof Response) return gate
    const action = body['action'] as OutreachLinkDomainRequest['action']
    if (action !== 'set-up' && action !== 'check' && action !== 'remove') {
      return outreachRefusal(400, 'invalid-request', 'Say whether to set the link domain up, check it, or remove it.')
    }
    if (action !== 'check' && !gate.isOrgAdmin) {
      return outreachRefusal(403, 'permission', 'Only an owner or an admin can change link domains.')
    }
    const checked = validateTrackingHostDomain(String(body['domain'] ?? ''))
    if (!checked.domain) {
      return outreachRefusal(400, 'invalid-domain', checked.error ?? 'Type a domain, such as example.com.')
    }
    const domain = checked.domain
    const firestore = deps.firestore()
    if (action === 'set-up' && !(await mailboxDomains(firestore, gate.orgId)).includes(domain)) {
      return outreachRefusal(
        400,
        'invalid-domain',
        `No connected mailbox sends as ${domain}. A link domain follows the address your sequences send from.`,
      )
    }

    const hosts = await links.hosts()
    const input = { firestore, orgId: gate.orgId, domain, nowMs: deps.now() }
    const result =
      action === 'set-up' ? await hosts.setUp(input) : action === 'check' ? await hosts.verify(input) : await hosts.remove(input)
    if (result.error) {
      return outreachRefusal(result.status >= 400 ? result.status : 409, 'link-domain-refused', result.error)
    }
    if (action !== 'check') {
      await deps.logOrgActivity(
        gate.orgId,
        { uid: gate.uid, email: gate.email },
        OUTREACH_LINK_DOMAIN_ACTIVITY[action](sendingTrackingHost(domain)),
        { type: 'org', id: gate.orgId },
      )
    }
    return outreachOk({ ...(await listing(deps, links, gate)), domain } satisfies OutreachLinkDomainResponse)
  }
}
