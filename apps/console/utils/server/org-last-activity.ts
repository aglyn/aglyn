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

import { FieldValue } from 'firebase-admin/firestore'
import {
  ORG_LAST_ACTIVITY_INTERVAL_MS,
  ORG_LAST_ACTIVITY_PATH,
} from '../org-list-query'

/** A Firestore Timestamp, a Date or epoch millis, as millis; null for anything else. */
export function activityMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  const seconds = (value as { seconds?: unknown } | null)?.seconds
  return typeof seconds === 'number' ? seconds * 1000 : null
}

/**
 * Whether an organization's stored last activity is stale enough to write
 * again: missing, unreadable, or older than the interval. A value in the
 * future (a skewed clock wrote it) is left alone until the interval passes it.
 */
export function orgActivityIsStale(stored: unknown, nowMs: number): boolean {
  const at = activityMillis(stored)
  if (at === null) return true
  return nowMs - at >= ORG_LAST_ACTIVITY_INTERVAL_MS
}

/** The slice of the Admin SDK this needs, so a spec can hand in a fake. */
export interface OrgActivityStore {
  collection(path: 'orgs'): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; get(field: string): unknown }>
      update(data: Record<string, unknown>): Promise<unknown>
    }
  }
}

/**
 * Stamp `orgs/{orgId}.lastActivityAt` with the server's clock, unless it was
 * stamped within `ORG_LAST_ACTIVITY_INTERVAL_MS`. This is the per-org bound
 * on writes: however many members and tabs are active at once, the document
 * is written at most once per interval (two racing requests can both write;
 * both write "now", so the race costs a write and never a wrong answer).
 *
 * `update`, never `set`: an organization that does not exist is not created
 * by someone's heartbeat. Returns whether it wrote.
 */
export async function stampOrgLastActivity(
  db: OrgActivityStore,
  orgId: string,
  nowMs: number = Date.now(),
): Promise<'stamped' | 'fresh' | 'missing'> {
  const ref = db.collection('orgs').doc(orgId)
  const snapshot = await ref.get()
  if (!snapshot.exists) return 'missing'
  if (!orgActivityIsStale(snapshot.get(ORG_LAST_ACTIVITY_PATH), nowMs)) return 'fresh'
  await ref.update({ [ORG_LAST_ACTIVITY_PATH]: FieldValue.serverTimestamp() })
  return 'stamped'
}
