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

import { isServerReleaseFlagOnForOrg } from '@aglyn/tenant-data-admin/server/release-flags'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  SITE_CHAT_RELEASE_FLAG,
  SITE_CHAT_SETTINGS_COLLECTION,
  SITE_CHAT_SETTINGS_DOC,
} from '../model/site-chat'

/**
 * The two reads a page render makes for the site chat (AGL-4250): the
 * owner's settings document and the release flag. Their own module, so the
 * render path reaches these and never the door, its provider or its meters.
 */

export async function readSiteChatSettingsDoc(hostId: string): Promise<unknown> {
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection(SITE_CHAT_SETTINGS_COLLECTION)
    .doc(SITE_CHAT_SETTINGS_DOC)
    .get()
  return snapshot.exists ? (snapshot.data() ?? null) : null
}

export function siteChatReleasedFor(orgId: string): Promise<boolean> {
  return isServerReleaseFlagOnForOrg(SITE_CHAT_RELEASE_FLAG as never, orgId)
}
