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

import type { PluginOrgErasureReport, PluginOrgErasureRequest } from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { createTwilioClient, type TwilioClient } from '../twilio/twilio-client'
import { createFirestorePhoneRepository, type PhoneFirestore, type PhoneRepository } from './phone-repository'

/** Closes an erased workspace's Twilio subaccount (AGL-4251). A dry run only counts. */
export async function erasePhoneOrgWith(
  request: PluginOrgErasureRequest,
  deps: { repo: PhoneRepository; twilio: TwilioClient },
): Promise<PluginOrgErasureReport> {
  const account = await deps.repo.getAccount(request.orgId)
  if (!account) return { subaccounts: 0 }
  if (request.dryRun) return { subaccounts: 1 }
  await deps.twilio.closeSubaccount(account.subaccountSid)
  return { subaccounts: 1 }
}

export function erasePhoneOrg(request: PluginOrgErasureRequest): Promise<PluginOrgErasureReport> {
  return erasePhoneOrgWith(request, {
    repo: createFirestorePhoneRepository(
      () => firebaseAdmin.app().firestore() as unknown as PhoneFirestore,
      (by) => firebaseAdmin.firestore.FieldValue.increment(by),
    ),
    twilio: createTwilioClient(),
  })
}
