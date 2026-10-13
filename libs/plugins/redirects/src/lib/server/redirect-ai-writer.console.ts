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

import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import type { PluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { HostActivityTarget } from '@aglyn/tenant-data-admin'
import { firebaseAdmin, logHostActivity } from '@aglyn/tenant-data-admin'
import { findUserByUidAcrossPools } from '@aglyn/tenant-data-admin/server/auth-pools'
import { getLockdownVerdict } from '@aglyn/tenant-data-admin/server/lockdown'
import { createRedirectAiWriter } from './redirect-ai-writer'

/**
 * The `redirect` writer (AGL-3745) over the console's Admin SDK, made once per
 * process on its first call. The declarations file reaches it by a relative
 * `import()`, so the console's boot loads neither this nor the Admin SDK.
 */
let writer: PluginResourceDraftWriter | null = null

export function redirectAiWriter(): PluginResourceDraftWriter {
  writer ??= createRedirectAiWriter({
    firestore: () => firebaseAdmin.app().firestore() as unknown as FirebaseFirestore.Firestore,
    // The verdict every console write door asks: the platform, the workspace,
    // the site and the member, for a write.
    lockdown: async ({ uid, org, host }) =>
      Boolean(
        await getLockdownVerdict({ staff: false, uid, org: org as never, host: host as never, intent: 'write' }),
      ),
    // The create route's announcement, for every path a change touches.
    announcePaths: async (hostId, paths) => {
      await dropPluginSiteCache({ hostIds: [hostId], paths: { [hostId]: [...paths] }, reason: 'redirect rules were changed' })
    },
    // The create route's activity line for a created rule.
    logCreated: async (hostId, actorUid, ruleId, declared) => {
      const email = await findUserByUidAcrossPools(actorUid)
        .then((found) => found?.record.email ?? null)
        .catch(() => null)
      await logHostActivity(
        hostId,
        { uid: actorUid, email },
        `Created ${declared.activityNoun}`,
        { type: (declared.activityType ?? 'content') as HostActivityTarget['type'], id: ruleId },
      )
    },
  })
  return writer
}
