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
  type ContactInteraction,
  type ContactSource,
  mergeContactInteraction,
  normalizeContactEmail,
  resolveTenantEntitlements,
} from '@aglyn/aglyn'
import { FieldValue } from 'firebase-admin/firestore'
import { firebaseAdmin } from './firebase-admin'
import { getOrgForHost, orgDataCollectionForHost } from './organizations'

/**
 * Contacts ingestion (AGL-197): upserts an org-scoped contact doc (AGL-237)
 * keyed by normalized email from any capture point (forms, membership,
 * orders, bookings). Fire-and-forget by design — callers should never
 * fail their primary write because contact capture had a problem.
 *
 * Quota: `contactsPerHost` gates NEW contact creation only; interactions
 * on existing contacts always append. Dropped creations increment
 * `counters/contactsDropped` so the console can surface an upgrade hint.
 */
export async function upsertHostContact(options: {
  hostId: string
  email: unknown
  name?: string
  source: ContactSource
  interaction: Omit<ContactInteraction, 'type' | 'atMs'> & { atMs?: number }
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
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return
    }

    // New contact: enforce the plan quota via the aggregate count (cheap;
    // no doc reads) against the owning org's entitlements (AGL-238).
    const orgBilling = await getOrgForHost(options.hostId)
    const limit = resolveTenantEntitlements(
      (orgBilling?.org as any) ?? null,
    ).contactsPerHost
    const count = (await contactsRef.count().get()).data().count
    if (count >= limit) {
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
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    console.error('upsertHostContact failed', error)
  }
}
