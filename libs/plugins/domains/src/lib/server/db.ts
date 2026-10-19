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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { DOMAINS_COLLECTIONS } from '../constants/bundle-common'
import {
  withEvent,
  type DomainRegistrationDoc,
  type DomainRegistrationEvent,
} from '../model/registration'

/*
 * `domainRegistrations/{domain}`, read and written only here (AGL-3962). The
 * Firestore rules refuse the collection to every client, so each write the
 * console shows was made by a route or the sweep through these helpers.
 */

/**
 * A copy without `undefined` anywhere in it. The Admin SDK refuses an
 * `undefined` field outright, and clearing an optional renewal field by
 * spreading `{ abandonedAtMs: undefined }` is the natural way to write it.
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) out[key] = stripUndefined(entry)
    }
    return out as T
  }
  return value
}

export function db(): FirebaseFirestore.Firestore {
  return firebaseAdmin.app().firestore()
}

export function registrationRef(
  domain: string,
  firestore: FirebaseFirestore.Firestore = db(),
): FirebaseFirestore.DocumentReference {
  return firestore.collection(DOMAINS_COLLECTIONS.registrations).doc(domain)
}

export async function readRegistration(
  domain: string,
  firestore: FirebaseFirestore.Firestore = db(),
): Promise<DomainRegistrationDoc | null> {
  const snapshot = await registrationRef(domain, firestore).get()
  return snapshot.exists ? (snapshot.data() as DomainRegistrationDoc) : null
}

/**
 * Merges `patch` and appends `event` in one transaction, so two writers — a
 * route and the sweep — never drop each other's history rows.
 */
export async function updateRegistration(
  domain: string,
  patch: Partial<DomainRegistrationDoc>,
  event?: Omit<DomainRegistrationEvent, 'atMs'> & { atMs?: number },
  firestore: FirebaseFirestore.Firestore = db(),
): Promise<DomainRegistrationDoc | null> {
  const ref = registrationRef(domain, firestore)
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) return null
    const current = snapshot.data() as DomainRegistrationDoc
    const nowMs = Date.now()
    const next: DomainRegistrationDoc = {
      ...current,
      ...patch,
      updatedAtMs: nowMs,
      history: event
        ? withEvent(current.history, { atMs: event.atMs ?? nowMs, event: event.event, ...(event.detail ? { detail: event.detail } : {}) })
        : current.history ?? [],
    }
    const clean = stripUndefined(next)
    tx.set(ref, clean)
    return clean
  })
}

export async function listRegistrations(
  field: 'hostId' | 'orgId',
  value: string,
  firestore: FirebaseFirestore.Firestore = db(),
): Promise<DomainRegistrationDoc[]> {
  if (!value) return []
  const snapshot = await firestore
    .collection(DOMAINS_COLLECTIONS.registrations)
    .where(field, '==', value)
    .limit(50)
    .get()
  return snapshot.docs.map((doc) => doc.data() as DomainRegistrationDoc)
}

/** Registrations in `status`, oldest update first, for the sweep. */
export async function listByStatus(
  status: DomainRegistrationDoc['status'],
  limit: number,
  firestore: FirebaseFirestore.Firestore = db(),
): Promise<DomainRegistrationDoc[]> {
  const snapshot = await firestore
    .collection(DOMAINS_COLLECTIONS.registrations)
    .where('status', '==', status)
    .limit(limit)
    .get()
  return snapshot.docs
    .map((doc) => doc.data() as DomainRegistrationDoc)
    .sort((a, b) => (a.updatedAtMs ?? 0) - (b.updatedAtMs ?? 0))
}
