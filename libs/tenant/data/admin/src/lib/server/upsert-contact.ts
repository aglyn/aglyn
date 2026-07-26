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
  checkContactQuota,
  type ContactInteraction,
  type ContactSource,
  mergeContactInteraction,
  normalizeContactEmail,
} from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import { firebaseAdmin } from './firebase-admin'
import { getOrgForHost, orgDataCollectionForHost } from './organizations'

/**
 * Contacts ingestion (AGL-197): upserts an org-scoped contact doc (AGL-237)
 * keyed by normalized email from any capture point (forms, membership,
 * orders, bookings). Fire-and-forget by design — callers should never
 * fail their primary write because contact capture had a problem.
 *
 * Quota (AGL-890): contacts are audience BANDS, not hard caps. Paid plans
 * always create — contacts past the included band meter onto the monthly
 * invoice (report-usage cron). Free hard-bands at the included count:
 * only there do dropped creations increment `counters/contactsDropped`,
 * surfaced as a console alert (AGL-891). Interactions on existing
 * contacts always append regardless of plan.
 */
export async function upsertHostContact(options: {
  hostId: string
  email: unknown
  name?: string
  source: ContactSource
  interaction: Omit<ContactInteraction, 'type' | 'atMs'> & { atMs?: number }
  /** Explicit marketing opt-in (AGL-301) with a consent timestamp. */
  marketingConsent?: boolean
  /** Order value in cents — rolls into RFM fields (AGL-328). */
  purchaseCents?: number
}): Promise<void> {
  try {
    const email = normalizeContactEmail(options.email)
    if (!email) return
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(options.hostId)
    // Contacts are org-scoped (AGL-237): every host in the org feeds one
    // shared list; hostId is stamped per contact for provenance.
    const contactsRef = await orgDataCollectionForHost(
      options.hostId,
      'contacts',
    )
    const interaction: ContactInteraction = {
      type: options.source,
      atMs: options.interaction.atMs ?? Date.now(),
      ...(options.interaction.refId
        ? { refId: options.interaction.refId }
        : {}),
      ...(options.interaction.summary
        ? { summary: options.interaction.summary.slice(0, 200) }
        : {}),
    }

    const existing = await contactsRef
      .where('email', '==', email)
      .limit(1)
      .get()

    if (!existing.empty) {
      const docSnapshot = existing.docs[0]
      const merged = mergeContactInteraction(
        {
          name: docSnapshot.get('name') ?? undefined,
          sources: docSnapshot.get('sources') ?? {},
          interactions: docSnapshot.get('interactions') ?? [],
        },
        { source: options.source, interaction, name: options.name },
      )
      await docSnapshot.ref.set(
        {
          ...(merged.name ? { name: merged.name } : {}),
          sources: merged.sources,
          interactions: merged.interactions,
          ...(options.marketingConsent
            ? { marketingConsent: true, marketingConsentAtMs: Date.now() }
            : {}),
          ...(options.purchaseCents
            ? {
                ltvCents: FieldValue.increment(options.purchaseCents),
                ordersCount: FieldValue.increment(1),
                lastPurchaseAtMs: Date.now(),
              }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return
    }

    // New contact: audience-band check via the aggregate count (cheap; no
    // doc reads) against the owning org's entitlements (AGL-238/890).
    // Metered plans always pass (overage bills via the report-usage
    // cron); only free's hard band drops the CRM record — visibly, via
    // the counter and the console alert (AGL-891). The signup/order that
    // triggered the capture always succeeds either way.
    const orgBilling = await getOrgForHost(options.hostId)
    const count = (await contactsRef.count().get()).data().count
    const quota = checkContactQuota((orgBilling?.org as any) ?? null, count)
    if (!quota.allowed) {
      await hostRef
        .collection('counters')
        .doc('contactsDropped')
        .set({ total: FieldValue.increment(1) }, { merge: true })
      return
    }

    await contactsRef.add({
      hostId: options.hostId,
      email,
      ...(options.name ? { name: options.name.slice(0, 120) } : {}),
      sources: { [options.source]: true },
      interactions: [interaction],
      tags: [],
      ...(options.marketingConsent
        ? { marketingConsent: true, marketingConsentAtMs: Date.now() }
        : {}),
      ...(options.purchaseCents
        ? {
            ltvCents: options.purchaseCents,
            ordersCount: 1,
            lastPurchaseAtMs: Date.now(),
            firstPurchaseAtMs: Date.now(),
          }
        : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    console.error('upsertHostContact failed', error)
  }
}
