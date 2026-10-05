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

import type { PluginTransferResource } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import type { HostActivityTarget } from '@aglyn/tenant-data-admin'
import { firebaseAdmin, getOrgForHost, logHostActivity } from '@aglyn/tenant-data-admin'
import { findUserByUidAcrossPools } from '@aglyn/tenant-data-admin/server/auth-pools'
import { createRedirectsTransferResource } from './redirects-transfer'

/**
 * The redirects resource over the console's Admin SDK, made once per process
 * on the first import or export. The declarations file reaches it by a
 * relative `import()`, so the console's boot loads neither this nor the
 * Admin SDK.
 */
let resource: PluginTransferResource | null = null

/** Who an activity line names, by uid; read once per member per process. */
const emails = new Map<string, string | null>()

async function emailOf(uid: string): Promise<string | null> {
  if (emails.has(uid)) return emails.get(uid) ?? null
  // Across every sign-in pool: an SSO member is not in the project's pool.
  const email = await findUserByUidAcrossPools(uid)
    .then((found) => found?.record.email ?? null)
    .catch(() => null)
  emails.set(uid, email)
  return email
}

export function redirectsTransferResource(): PluginTransferResource {
  resource ??= createRedirectsTransferResource({
    firestore: firebaseAdmin.app().firestore(),
    // The create route's owner read: a plan-less or missing workspace is the
    // free plan, which has no redirects.
    loadOrg: async (hostId) => ((await getOrgForHost(hostId))?.org ?? null) as never,
    // The create route's activity line for each rule an import creates.
    logCreated: async (hostId, actorUid, ruleId, declared) => {
      await logHostActivity(
        hostId,
        { uid: actorUid, email: await emailOf(actorUid) },
        `Created ${declared.activityNoun}`,
        { type: (declared.activityType ?? 'content') as HostActivityTarget['type'], id: ruleId },
      )
    },
  })
  return resource
}
