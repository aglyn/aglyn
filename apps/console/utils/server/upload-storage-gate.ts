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
  UploadStorageGate,
  UploadStorageGateInput,
  UploadStorageRefusal,
} from '@aglyn/aglyn/plugin-manager/plugin-upload-storage-gate'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { mediaStorageGate, scopeBillsStorageOverage } from '../storage-overage'
import { formatStorageMb } from '../usage-alert-notice'
import { resolveOrgMediaBand } from './media-storage-band'

const MB = 1024 * 1024

/**
 * This app's answer to `core.upload-storage-gate` (AGL-4096): whether a
 * member's file kept outside the media library (a quote's proof) fits the
 * workspace's storage.
 *
 * The same band and the same decision as a site library upload, through the
 * same helpers: `resolveOrgMediaBand` for the workspace's one pool (which
 * already holds every kept quote and form file, counted in the site's
 * `counters/media`), and `mediaStorageGate` for what happens past it —
 * refused on a plan that does not bill storage, taken and billed on one that
 * does, refused past a storage cap the workspace set. The file is kept on a
 * site (`hosts/{hostId}/private/uploads/…`), so its scope is the site's and it
 * bills as a site library file does.
 *
 * A site with no owning workspace has no pool to measure, as `/api/media/storage`
 * says, and is not refused here.
 */
export async function checkUploadStorage(
  input: UploadStorageGateInput,
): Promise<UploadStorageRefusal | null> {
  const owner = await getOrgForHost(input.hostId)
  if (!owner?.orgId) return null
  // A kept file is always a site's, counted in the site's `counters/media`.
  const scope = { collection: 'hosts' as const, scopeId: input.hostId }
  const org = owner.org as Parameters<typeof mediaStorageGate>[0]['org']
  const band = await resolveOrgMediaBand({
    firestore: firebaseAdmin.app().firestore(),
    orgId: owner.orgId,
    org,
    currentHostId: scope.scopeId,
  })
  const gate = mediaStorageGate({
    org,
    usedMb: (band.usedBytes + Math.max(0, Number(input.bytes) || 0)) / MB,
    allowanceMb: band.allowanceMb,
    billsOverage: scopeBillsStorageOverage(scope.collection),
  })
  if (gate.allowed) return null
  return {
    status: gate.status,
    // The media library's own words for the band (`mediaStorageLimitMessage`);
    // a cap the workspace set keeps the gate's sentence, which names it.
    error:
      gate.code === 'plan_limit_reached' || !gate.error
        ? `Storage limit reached (${formatStorageMb(gate.limitMb)} across your workspace) — see Billing to upgrade`
        : gate.error,
    code: gate.code ?? 'plan_limit_reached',
  }
}

export const consoleUploadStorageGate: UploadStorageGate = { check: checkUploadStorage }
