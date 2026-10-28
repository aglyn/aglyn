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

import type {
  PluginPersonErasureReport,
  PluginPersonErasureRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { waiverRetentionStamp, waiverRetentionStampMoved, type WaiverRetentionStamp } from '../model/waiver-retention'
import type { StoredWaiverSignature } from '../model/waiver-signature'
import { waiversDb, waiversRefs } from './db'
import { setWaiversRetentionYearsForTests, siteRetentionYears } from './retention'

export { siteRetentionYears }

/*==========================================
 * ERASING A PERSON FROM A WORKSPACE'S WAIVERS (AGL-4042).
 *
 * A signed waiver is the store's record of what the signer agreed to — the
 * liability record a store is asked for after an accident — so an erasure
 * request does not delete it. Each signature the person signed, on every
 * site, is KEPT for that site's waiver retention period (a plugin setting,
 * `retentionYears`), counted from the last day it covers or from the day the
 * youngest minor on it reaches the waiver's adult age, and then deleted by
 * the retention job (`retention-job.ts`) with its drawn signature and paper
 * photo, exactly as every other signature is: the erasure neither shortens
 * nor lengthens it. A signature whose period has already run out is deleted
 * now.
 *
 * What the erasure still removes here is the link to the person's people
 * record (`contactId`), which the CRM's own eraser deletes: a kept signature
 * points at nothing the person asked to keep. The signature's own fields —
 * the signer's details, the minors, the mark, the audit trail — are the
 * record, so they stay as signed; blanking them would leave a waiver that
 * proves nothing.
 *
 * Idempotent: a signature already kept keeps its first request's time and is
 * stamped again only if the period moved, so the nightly retry of a failed
 * erasure writes nothing new.
 *=========================================*/

/** How many of a person's signatures one erasure reaches. */
const MAX_SIGNATURES = 500

type Bucket = { deleteFiles(options: { prefix: string }): Promise<unknown> }

function defaultBucket(): Bucket | null {
  try {
    return firebaseAdmin.app().storage().bucket() as unknown as Bucket
  } catch {
    return null
  }
}

let bucketOverride: (() => Bucket | null) | null = null

/** Test seams: the bucket the files are deleted from, and a site's period. */
export function setWaiversErasureDepsForTests(
  deps: { bucket?: (() => Bucket | null) | null; retentionYears?: ((orgId: string, hostId: string) => Promise<number>) | null } | null,
): void {
  bucketOverride = deps?.bucket ?? null
  setWaiversRetentionYearsForTests(deps?.retentionYears ?? null)
}

/** The bucket a signature's files live in, or `null` where Storage is not configured. */
export const waiversBucket = (): Bucket | null => (bucketOverride ?? defaultBucket)()

/** Deletes one signature's private files: the drawn signature and the paper photo. */
export async function deleteSignatureFiles(bucket: Bucket | null, orgId: string, signatureId: string): Promise<void> {
  if (!bucket) return
  await bucket.deleteFiles({ prefix: `orgs/${orgId}/waiverSignatures/${signatureId}/` }).catch(() => undefined)
}

export async function eraseWaiversPerson(request: PluginPersonErasureRequest): Promise<PluginPersonErasureReport> {
  const email = String(request.email ?? '').trim().toLowerCase()
  if (!email || !request.orgId) return { signatures: 0, kept: 0, deleted: 0 }
  const found = await waiversRefs.signatures(request.orgId).where('emailLower', '==', email).limit(MAX_SIGNATURES).get()
  const years = new Map<string, Promise<number>>()
  const yearsFor = (hostId: string) => {
    if (!years.has(hostId)) years.set(hostId, siteRetentionYears(request.orgId, hostId))
    return years.get(hostId) as Promise<number>
  }
  const plan: Array<{ ref: { id: string }; keep: boolean; stamp: WaiverRetentionStamp; requestedAtMs: number; changed: boolean }> = []
  for (const doc of found.docs) {
    const signature = doc.data() as StoredWaiverSignature
    const stamp = waiverRetentionStamp(signature, await yearsFor(String(signature.hostId ?? '')))
    const keep = stamp.retainUntilMs > request.atMs
    const requestedAtMs = signature.erasure?.requestedAtMs ?? request.atMs
    const changed =
      !signature.erasure || waiverRetentionStampMoved(signature, stamp) || (signature.contactId ?? null) !== null
    plan.push({ ref: doc.ref, keep, stamp, requestedAtMs, changed })
  }
  const kept = plan.filter((entry) => entry.keep).length
  const report = { signatures: found.size, kept, deleted: plan.length - kept }
  if (request.dryRun) return report
  const bucket = waiversBucket()
  for (let start = 0; start < plan.length; start += 200) {
    const batch = waiversDb().batch()
    for (const entry of plan.slice(start, start + 200)) {
      const ref = waiversRefs.signature(request.orgId, entry.ref.id)
      if (entry.keep) {
        if (entry.changed) {
          batch.update(ref, {
            erasure: { requestedAtMs: entry.requestedAtMs },
            ...entry.stamp,
            contactId: null,
          })
        }
        continue
      }
      await deleteSignatureFiles(bucket, request.orgId, entry.ref.id)
      batch.delete(ref)
    }
    await batch.commit()
  }
  return report
}
