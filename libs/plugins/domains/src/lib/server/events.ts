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

import { detachProjectDomain } from '@aglyn/tenant-data-admin'
import { DOMAINS_COLLECTIONS } from '../constants/bundle-common'
import type { DomainRegistrationDoc } from '../model/registration'
import { db, readRegistration, updateRegistration } from './db'
import { registrarShouldAutoRenew } from './lifecycle'
import { platformEffects } from './platform-effects'

/*
 * What the plugin hears from the platform (AGL-3962), each handler bounded
 * and quiet: the webhook and the routes that raise these must not wait on a
 * registrar, and a handler that throws is logged by the event runner.
 */

/** A dispute on any charge for a name stops its renewals until staff look. */
export async function onDisputeOpened(payload: {
  orgId: string
  invoiceId: string | null
}): Promise<void> {
  if (!payload.invoiceId) return
  const found = await db()
    .collection(DOMAINS_COLLECTIONS.registrations)
    .where('invoiceIds', 'array-contains', payload.invoiceId)
    .limit(1)
    .get()
  const registration = found.docs[0]?.data() as DomainRegistrationDoc | undefined
  if (!registration || registration.orgId !== payload.orgId) return
  const next = await updateRegistration(
    registration.domain,
    { disputedAtMs: Date.now() },
    { event: 'disputed', detail: payload.invoiceId },
  )
  const effects = platformEffects()
  if (next) await effects.driver.setAutoRenew(next.domain, registrarShouldAutoRenew(next))
  await effects.alert('disputed', registration, payload.invoiceId)
}

/**
 * The owner changed their card: a renewal that was failing is tried again on
 * the next pass, and one that ran out of tries before expiry is picked back
 * up — which is usually exactly what the new card was for.
 */
export async function onPaymentMethodChanged(payload: { orgId: string }): Promise<void> {
  const snapshot = await db()
    .collection(DOMAINS_COLLECTIONS.registrations)
    .where('orgId', '==', payload.orgId)
    .limit(50)
    .get()
  const nowMs = Date.now()
  for (const doc of snapshot.docs) {
    const registration = doc.data() as DomainRegistrationDoc
    const renewal = registration.renewal
    if (registration.status !== 'active' || !renewal || renewal.chargedInvoiceId) continue
    if (!renewal.lastChargeError) continue
    if (renewal.abandonedReason && renewal.abandonedReason !== 'charge-failed') continue
    if ((registration.expiresAtMs ?? 0) <= nowMs) continue
    const next = await updateRegistration(
      registration.domain,
      {
        renewal: {
          ...renewal,
          nextChargeAtMs: nowMs,
          abandonedAtMs: undefined,
          abandonedReason: undefined,
        },
      },
      { event: 'renewal-retry-new-card' },
    )
    if (next) {
      await platformEffects()
        .driver.setAutoRenew(next.domain, registrarShouldAutoRenew(next))
        .catch(() => undefined)
    }
  }
}

/**
 * A bought name left its site — disconnected by its owner, or the site was
 * deleted. The name stays registered to the owner and is offered to their
 * other sites; a deleted site's name is also taken off the deployment, where
 * it would otherwise answer with nothing.
 */
export async function onHostDomainReleased(payload: {
  hostId: string
  domain: string
  reason: 'detached' | 'site-deleted'
}): Promise<void> {
  const registration = await readRegistration(payload.domain)
  if (!registration || registration.hostId !== payload.hostId) return
  await updateRegistration(
    registration.domain,
    { hostId: null },
    { event: payload.reason === 'site-deleted' ? 'site-deleted' : 'disconnected', detail: payload.hostId },
  )
  if (payload.reason === 'site-deleted') {
    await detachProjectDomain(registration.domain, 'tenant').catch(() => undefined)
    await detachProjectDomain(`www.${registration.domain}`, 'tenant').catch(() => undefined)
  }
}
