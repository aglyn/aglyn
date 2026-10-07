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
  BUSINESS_PROFILE_SUBCOLLECTION,
  BUSINESS_PROFILE_SITE_DOC,
  BUSINESS_PROFILE_WORKSPACE_DOC,
  mergeBusinessProfilePrefill,
  resolveBusinessProfile,
  type BusinessProfileDoc,
  type BusinessProfileHost,
  type BusinessProfileValues,
} from '@aglyn/aglyn/app-utils/business-profile'
import { aiHostPublishContext } from '../model/ai-host-publish-context'
import type { AiSiteContextInput } from '../model/ai-site-context'
import {
  AI_SITE_MEMORY_SUBCOLLECTION,
  AI_SITE_MEMORY_MAX,
  aiListedPreferences,
  aiSitePreferenceOf,
  type AiSitePreference,
  type AiSitePreferenceMatch,
} from '../model/ai-site-memory'

/**
 * The server half of the site context (AGL-3661): the reads that make an
 * `AiSiteContextInput`, the guided start's prefill and the memory writer.
 * Every function takes the Firestore it works on, so a door, a step and a
 * spec hand in their own.
 *
 * FAIL-SOFT on purpose. The context makes a job better; it never decides
 * whether a job runs. A read that fails is logged and answered with `null`,
 * and the job runs as it did before the context existed.
 */

type Data = Record<string, unknown>

const docData = async (ref: FirebaseFirestore.DocumentReference): Promise<Data | null> => {
  const snapshot = await ref.get()
  return snapshot.exists ? ((snapshot.data() ?? null) as Data | null) : null
}

/** The site's own preferences, read whole (they are capped at write). */
export async function readAiSitePreferences(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
): Promise<AiSitePreference[]> {
  const snapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection(AI_SITE_MEMORY_SUBCOLLECTION)
    .limit(AI_SITE_MEMORY_MAX * 2)
    .get()
  return snapshot.docs
    .map((row) => aiSitePreferenceOf(row.id, row.data() as Data))
    .filter((row): row is AiSitePreference => row !== null)
}

/**
 * Everything the block says about one site, read in one window: the host,
 * the site's profile, the workspace defaults and the remembered preferences.
 * `null` for a site of another workspace (never read for it) and for any
 * read that failed. A caller that already holds the host passes it.
 */
export async function readAiSiteContext(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; hostId: string | null | undefined; host?: Data | null },
): Promise<AiSiteContextInput | null> {
  const { orgId } = input
  const hostId = typeof input.hostId === 'string' ? input.hostId.trim() : ''
  if (!orgId || !hostId) return null
  try {
    const hostRef = firestore.collection('hosts').doc(hostId)
    const [host, site, workspace, preferences] = await Promise.all([
      input.host !== undefined ? Promise.resolve(input.host) : docData(hostRef),
      docData(hostRef.collection(BUSINESS_PROFILE_SUBCOLLECTION).doc(BUSINESS_PROFILE_SITE_DOC)),
      docData(
        firestore
          .collection('orgs')
          .doc(orgId)
          .collection(BUSINESS_PROFILE_SUBCOLLECTION)
          .doc(BUSINESS_PROFILE_WORKSPACE_DOC),
      ),
      readAiSitePreferences(firestore, hostId),
    ])
    // A site of another workspace is never described to this one.
    if (!host || host['orgId'] !== orgId) return null
    return {
      profile: resolveBusinessProfile({
        host: host as BusinessProfileHost,
        site: site as BusinessProfileDoc | null,
        workspace: workspace as BusinessProfileDoc | null,
      }),
      publish: aiHostPublishContext(host),
      preferences: aiListedPreferences(preferences),
    }
  } catch (error) {
    console.warn('ai site context unread', { orgId, hostId, error })
    return null
  }
}

/**
 * Fills the site's profile from the guided start's answers or a generator's
 * output (AGL-3661), never over what the owner typed: the merge decides,
 * inside a transaction so an owner's save in between is never overwritten.
 * Returns whether anything was written.
 */
export async function prefillAiBusinessProfile(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  values: BusinessProfileValues,
  source: 'start' | 'ai',
  now: Date = new Date(),
): Promise<boolean> {
  const ref = firestore
    .collection('hosts')
    .doc(hostId)
    .collection(BUSINESS_PROFILE_SUBCOLLECTION)
    .doc(BUSINESS_PROFILE_SITE_DOC)
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const current = snapshot.exists ? (snapshot.data() as BusinessProfileDoc) : null
    const next = mergeBusinessProfilePrefill(current, values, source)
    if (!next) return false
    tx.set(ref, { ...next, updatedAt: now, updatedBy: null })
    return true
  })
}

/**
 * Remembers the preferences one applied edit showed (AGL-3661): each one's
 * count goes up, a preference of the same group that it replaces is
 * forgotten, and the site keeps at most `AI_SITE_MEMORY_MAX`, dropping the
 * least repeated and oldest first.
 */
export async function rememberAiSitePreferences(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  matches: readonly AiSitePreferenceMatch[],
  now: Date = new Date(),
): Promise<void> {
  if (!matches.length) return
  const collection = firestore.collection('hosts').doc(hostId).collection(AI_SITE_MEMORY_SUBCOLLECTION)
  const existing = await readAiSitePreferences(firestore, hostId)
  const byId = new Map(existing.map((row) => [row.id, row]))
  const batch = firestore.batch()
  const kept = new Map(existing.map((row) => [row.id, row]))
  for (const match of matches) {
    for (const row of existing) {
      if (row.group === match.group && row.id !== match.id) {
        batch.delete(collection.doc(row.id))
        kept.delete(row.id)
      }
    }
    const held = byId.get(match.id)
    const row: AiSitePreference = {
      ...match,
      count: (held?.count ?? 0) + 1,
      lastSeenAtMs: now.getTime(),
      source: 'assist-edit',
    }
    kept.set(match.id, row)
    batch.set(collection.doc(match.id), row)
  }
  const overflow = [...kept.values()]
    .sort((a, b) => b.count - a.count || b.lastSeenAtMs - a.lastSeenAtMs)
    .slice(AI_SITE_MEMORY_MAX)
  for (const row of overflow) batch.delete(collection.doc(row.id))
  await batch.commit()
}
