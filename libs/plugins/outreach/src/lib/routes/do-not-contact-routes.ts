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
import { normalizeOutreachDomain } from '../engine/do-not-contact-domain'
import type {
  OutreachDoNotContactDomainRequest,
  OutreachDoNotContactDomainResponse,
  OutreachDoNotContactDomainsResponse,
} from '../model/outreach-api'
import {
  addOutreachDoNotContactDomain,
  listOutreachDoNotContactDomains,
  removeOutreachDoNotContactDomain,
} from '../storage/do-not-contact-store'
import type { OutreachRouteDeps } from './route-deps'
import { outreachRouteGate } from './route-gate'
import {
  outreachMethodNotAllowed,
  outreachOk,
  outreachRefusal,
  readOutreachJsonBody,
} from './route-http'

/**
 * THE DO-NOT-CONTACT DOMAINS ROUTE (AGL-3244): `outreach/do-not-contact/domains`.
 *
 * `GET ?orgId` lists the domains; `POST` adds one, with the member as its
 * author, or takes one off. The address half of the list has no route of
 * its own — an address entry carries no address and is listed nowhere — so
 * this is the one place the list is edited by hand. Both directions write a
 * line to the organization's activity feed: taking a domain off is what
 * lets a sequence email a company that once blocked the sender, and who did
 * that is worth knowing.
 */

/** The activity lines a change writes. */
export const OUTREACH_DO_NOT_CONTACT_DOMAIN_ACTIVITY = {
  add: (domain: string) => `Added ${domain} to the Sequences do-not-contact list`,
  remove: (domain: string) => `Removed ${domain} from the Sequences do-not-contact list`,
} as const

export function createOutreachDoNotContactDomainsRoute(deps: OutreachRouteDeps): PluginWebApiHandler {
  return async (request) => {
    if (request.method === 'GET') {
      const gate = await outreachRouteGate(
        request,
        new URL(request.url).searchParams.get('orgId'),
        deps.gate,
      )
      if (gate instanceof Response) return gate
      const domains = await listOutreachDoNotContactDomains(deps.firestore(), gate.orgId)
      return outreachOk({ ok: true, domains } satisfies OutreachDoNotContactDomainsResponse)
    }
    if (request.method !== 'POST') return outreachMethodNotAllowed('GET, POST')

    const body = await readOutreachJsonBody(request)
    const gate = await outreachRouteGate(request, body['orgId'], deps.gate)
    if (gate instanceof Response) return gate
    const action = body['action'] as OutreachDoNotContactDomainRequest['action']
    if (action !== 'add' && action !== 'remove') {
      return outreachRefusal(400, 'invalid-request', 'Say whether to add the domain or remove it.')
    }
    const domain = normalizeOutreachDomain(body['domain'])
    if (!domain) {
      return outreachRefusal(400, 'invalid-domain', 'Type a domain, such as example.com.')
    }
    const firestore = deps.firestore()
    let changed: boolean
    if (action === 'add') {
      const added = await addOutreachDoNotContactDomain(firestore, {
        orgId: gate.orgId,
        domain,
        reason: 'manual',
        source: 'member',
        addedByUid: gate.uid,
        nowMs: deps.now(),
        detail: typeof body['detail'] === 'string' ? body['detail'] : null,
      })
      changed = added.created
    } else {
      changed = await removeOutreachDoNotContactDomain(firestore, gate.orgId, domain)
    }
    if (changed) {
      await deps.logOrgActivity(
        gate.orgId,
        { uid: gate.uid, email: gate.email },
        OUTREACH_DO_NOT_CONTACT_DOMAIN_ACTIVITY[action](domain),
        { type: 'org', id: gate.orgId },
      )
    }
    const domains = await listOutreachDoNotContactDomains(firestore, gate.orgId)
    return outreachOk({ ok: true, domains, changed, domain } satisfies OutreachDoNotContactDomainResponse)
  }
}
