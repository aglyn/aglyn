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
 * the designed emails and the operator alerts. Specs hand the lifecycle
 * their own.
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
    async connect({ hostId, domain, actor }) {
      const connected = await connectHostCustomDomain({
        hostId,
        domain,
        // A bought name's DNS is the registrar's and ours, so both names
        // resolve here and the www twin can be claimed with it.
        twin: `www.${domain}`,
        actor,
      })
      if (connected.ok === 'connected') return { ok: 'connected' }
      return {
        ok: 'refused',
        code: connected.code,
        retryable: RETRYABLE_CONNECT.has(connected.code),
      }
    },
    async disconnect({ hostId, domain }) {
      // Only a site still showing THIS name is released: one that moved on
      // to another domain is not the expired name's to change.
      const host = await db().collection('hosts').doc(hostId).get()
      if (String(host.get('cname') ?? '').toLowerCase() !== domain) return true
      const released = await disconnectHostCustomDomain({
        hostId,
        actor: DOMAINS_SYSTEM_ACTOR,
      })
      return released.ok !== 'refused'
    },
    email: sendDomainEmail,
    alert: raiseDomainAlert,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}
