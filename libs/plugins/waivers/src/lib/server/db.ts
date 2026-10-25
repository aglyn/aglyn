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

import { randomBytes } from 'crypto'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { Firestore } from 'firebase-admin/firestore'
import { WAIVERS_COLLECTIONS } from '../constants/bundle-common'

/**
 * The Firestore and the private Storage every waivers server module writes
 * through (AGL-4042). One getter each, so a spec swaps one thing.
 */

let dbOverride: unknown = null

export function waiversDb(): Firestore {
  return (dbOverride ?? firebaseAdmin.app().firestore()) as Firestore
}

/** Test seam. */
export function setWaiversDbForTests(db: unknown): void {
  dbOverride = db
}

/** The few Storage calls this plugin makes: private objects, never a download token. */
export interface WaiversFileStore {
  save(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  read(path: string): Promise<Uint8Array | null>
}

let storeOverride: WaiversFileStore | null = null

export function waiversFiles(): WaiversFileStore {
  if (storeOverride) return storeOverride
  const bucket = firebaseAdmin.app().storage().bucket()
  return {
    async save(path, bytes, contentType) {
      // No `firebaseStorageDownloadTokens` in the metadata: nothing but the
      // Admin SDK can ever read the object back.
      await bucket.file(path).save(Buffer.from(bytes), {
        resumable: false,
        contentType,
        metadata: { cacheControl: 'private, no-store' },
      })
    },
    async read(path) {
      const file = bucket.file(path)
      const [exists] = await file.exists()
      if (!exists) return null
      const [contents] = await file.download()
      return new Uint8Array(contents)
    },
  }
}

/** Test seam. */
export function setWaiversFilesForTests(store: WaiversFileStore | null): void {
  storeOverride = store
}

/** Whether a client-supplied id is one Firestore will take as a document id. */
export function isDocumentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes('/') &&
    !/^__.*__$/.test(value) &&
    value !== '.' &&
    value !== '..'
  )
}

/** A fresh, unguessable document id. */
export function newWaiversId(): string {
  return randomBytes(12).toString('hex')
}

const org = (orgId: string) => waiversDb().collection('orgs').doc(orgId)

export const waiversRefs = {
  waivers: (orgId: string) => org(orgId).collection(WAIVERS_COLLECTIONS.waivers),
  waiver: (orgId: string, waiverId: string) => org(orgId).collection(WAIVERS_COLLECTIONS.waivers).doc(waiverId),
  versions: (orgId: string, waiverId: string) =>
    org(orgId).collection(WAIVERS_COLLECTIONS.waivers).doc(waiverId).collection(WAIVERS_COLLECTIONS.versions),
  signatures: (orgId: string) => org(orgId).collection(WAIVERS_COLLECTIONS.signatures),
  signature: (orgId: string, signatureId: string) =>
    org(orgId).collection(WAIVERS_COLLECTIONS.signatures).doc(signatureId),
}
