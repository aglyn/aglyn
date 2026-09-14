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
  PluginUserErasureReport,
  PluginUserErasureRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-user-erasure'
import { eraseUserAiUsage } from './ai-usage-by-user'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'

/**
 * The AI plugin's share of an account erasure (AGL-2939): the person's
 * monthly usage documents, deleted from every org they belonged to and
 * swept from the ones they had left. The report is the meter's own — orgs
 * deleted by path, and months found by the cross-org sweep, `null` when
 * that sweep could not run.
 *
 * Its own module, imported by the server declarations when an erasure
 * runs, so the boot registers the eraser without loading the meter.
 */
export async function eraseAiUsageForUser({
  uid,
  orgIds,
}: PluginUserErasureRequest): Promise<PluginUserErasureReport> {
  const { orgs, sweptMonths } = await eraseUserAiUsage(
    firebaseAdmin.app().firestore(),
    uid,
    orgIds,
  )
  return { orgs, sweptMonths }
}
