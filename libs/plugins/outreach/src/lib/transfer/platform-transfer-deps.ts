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

import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { logOrgActivity } from '@aglyn/tenant-data-admin/server/organizations'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import type { OutreachDoNotContactTransferDeps } from './do-not-contact-transfer'

/**
 * The do-not-contact transfer resource's reach into the platform: the Admin
 * SDK, the membership resolver and organization read the route gate uses,
 * and the organization's activity log. Loaded by the console's declarations
 * the first time a transfer asks, never at boot.
 */
export function platformOutreachTransferDeps(): OutreachDoNotContactTransferDeps {
  const firestore = firebaseAdmin.app().firestore()
  return {
    firestore,
    now: Date.now,
    resolveOrgPermissions: (uid, context) => resolveOrgPermissions(uid, context),
    readOrg: async (orgId) => {
      const snapshot = await firestore.collection('orgs').doc(orgId).get()
      return snapshot.exists ? (snapshot.data() ?? {}) : null
    },
    logOrgActivity: (orgId, actor, action, target) => logOrgActivity(orgId, actor, action, target),
  }
}
