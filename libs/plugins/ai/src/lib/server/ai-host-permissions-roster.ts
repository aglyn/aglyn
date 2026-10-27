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
import { aiPermissionsOf } from '../model/ai-permissions'

/**
 * The AI keys of a collaborator's per-site verdict, copied onto their row of
 * the site's roster (`hosts/{hostId}/members/{memberId}.aiPermissions`)
 * (AGL-4047). The native apps draw a collaborator's AI access from that copy;
 * the platform's generic toggle door decides the verdict and raises
 * `host.member.permissions.changed`, and this keeps the copy in step. A row
 * that no longer exists is left alone.
 */
export async function recordAiPermissionsOnRoster(
  hostId: string,
  memberId: string,
  permissions: Readonly<Record<string, boolean>>,
): Promise<void> {
  const ref = firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('members')
    .doc(memberId)
  if (!(await ref.get()).exists) return
  await ref.update({ aiPermissions: aiPermissionsOf(permissions) })
}
