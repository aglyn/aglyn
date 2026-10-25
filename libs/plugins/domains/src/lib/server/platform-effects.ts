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
  isSecurityClassLockdownReason,
  normalizeOrgLockdown,
} from '@aglyn/aglyn/app-utils/lockdown'
import { consumePurchaseGatePreclearance } from '@aglyn/aglyn/plugin-manager/purchase-gate-preclearance'
import {
  connectHostCustomDomain,
  disconnectHostCustomDomain,
  readOrgBilling,
} from '@aglyn/tenant-data-admin'
import { raiseDomainAlert } from './alerts'
import { db } from './db'
import { sendDomainEmail } from './domain-emails'
import type { LifecycleEffects } from './lifecycle'
import { registrar } from './registrar'
import { VERCEL_REGISTRAR } from './registrar-vercel'
import { chargeDomain, refundInvoice } from './stripe'

/*
 * The lifecycle's effects as the platform performs them (AGL-3962): the
 * deployment's registrar, the workspace's card, core's connect and release,
 * core's purchase-gate preclearance, the designed emails and the operator
 * alerts. Specs hand the lifecycle their own.
 */

/** The deployment's registrar, with the built-in drivers offered. */
export function deploymentRegistrar() {
  return registrar([VERCEL_REGISTRAR])
}

/** What a refused connect means for the sweep: wait and retry, or stop. */
const RETRYABLE_CONNECT = new Set(['not-configured', 'attach-failed'])

/** The actor a sweep-made change is recorded under in a site's activity. */
export const DOMAINS_SYSTEM_ACTOR = { uid: 'system:domains', email: null }

export function platformEffects(): LifecycleEffects {
  return {
    driver: deploymentRegistrar(),
    now: () => Date.now(),
    async charge(request) {
      // A workspace locked for security or abuse is charged nothing: its card
      // may be the stolen one the lock is about. The renewal then runs out
      // of tries as a decline would, and auto-renew is turned off.
      const org = await db().collection('orgs').doc(request.orgId).get().catch(() => null)
      const lock = normalizeOrgLockdown(org?.data() as never)
      if (lock && isSecurityClassLockdownReason(lock.reason)) {
        return { ok: false, invoiceId: null, paidCents: 0, code: 'workspace-locked' }
      }
      const billing = await readOrgBilling(request.orgId).catch(() => ({}))
      const stripeCustomerId = String(
        (billing as { stripeCustomerId?: unknown }).stripeCustomerId ?? '',
      )
      if (!stripeCustomerId) {
        return { ok: false, invoiceId: null, paidCents: 0, code: 'no-customer' }
      }
      return chargeDomain({ ...request, stripeCustomerId })
    },
    refund: (invoiceId, reason) => refundInvoice(invoiceId, reason),
    async connect({ hostId, domain, actor, twin }) {
      const connected = await connectHostCustomDomain({
        hostId,
        domain,
        // A bought name's DNS is the registrar's and ours, so both names
        // resolve here and the www twin can be claimed with it. A site's own
        // domain put back after a swap keeps the twin it had (AGL-4040).
        twin: twin === undefined ? `www.${domain}` : twin,
        actor,
      })
      if (connected.ok === 'connected') return { ok: 'connected' }
      return {
        ok: 'refused',
        code: connected.code,
        retryable: RETRYABLE_CONNECT.has(connected.code),
      }
    },
    async disconnect({ hostId, domain, actor }) {
      // Only a site still showing THIS name is released: one that moved on
      // to another domain is not the expired name's to change.
      const host = await db().collection('hosts').doc(hostId).get()
      if (String(host.get('cname') ?? '').toLowerCase() !== domain) return true
      const released = await disconnectHostCustomDomain({
        hostId,
        actor: actor ?? DOMAINS_SYSTEM_ACTOR,
      })
      return released.ok !== 'refused'
    },
    email: sendDomainEmail,
    alert: raiseDomainAlert,
    // Fails closed in core: false on any error, and with nothing registered.
    consumePreclearance: (preclearanceId) => consumePurchaseGatePreclearance(preclearanceId),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}
