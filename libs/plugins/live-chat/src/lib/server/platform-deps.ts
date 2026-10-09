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
import {
  EmailNotVerifiedError,
  firebaseAdmin,
  verifyConsoleIdToken,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { getSiteLockdown } from '@aglyn/tenant-data-admin/server/tenant-write-lockdown'
import { FieldValue } from 'firebase-admin/firestore'
import { LIVE_CHAT_PLUGIN_ID, LIVE_CHAT_SETTINGS_COLLECTION } from '../constants'
import { createLiveChatSettingsHandler } from './settings-route'

/**
 * The production wiring (AGL-3698): the Admin SDK and the site cache. The
 * enricher and the route take these as arguments, so their specs drive them
 * with fakes and this file is the only one that reaches the real services.
 */

const firestore = () => firebaseAdmin.app().firestore()

const settingsRef = (hostId: string) =>
  firestore()
    .collection('hosts')
    .doc(hostId)
    .collection(LIVE_CHAT_SETTINGS_COLLECTION)
    .doc(LIVE_CHAT_PLUGIN_ID)

/** A site's stored chat settings, or null. */
export async function readLiveChatSettingsDoc(hostId: string): Promise<unknown> {
  const snapshot = await settingsRef(hostId).get()
  return snapshot.exists ? (snapshot.data() ?? null) : null
}

let handler: ReturnType<typeof createLiveChatSettingsHandler> | null = null

/** The console card's route, over the real services. */
export function liveChatSettingsHandler() {
  return (handler ??= createLiveChatSettingsHandler({
    verifyIdToken: async (token) => {
      const decoded = await verifyConsoleIdToken(token)
      return { uid: decoded.uid, staff: decoded['staff'] === true }
    },
    isEmailUnverified: (error) => error instanceof EmailNotVerifiedError,
    readMemberRoles: async (hostId) => {
      const host = await firestore().collection('hosts').doc(hostId).get()
      return host.exists ? ((host.get('memberRoles') ?? {}) as Record<string, unknown>) : null
    },
    siteLocked: async (hostId) => Boolean(await getSiteLockdown(hostId)),
    readSettings: readLiveChatSettingsDoc,
    writeSettings: async (hostId, settings, uid) => {
      await settingsRef(hostId).set({
        ...settings,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      })
    },
    dropSiteCache: async (hostId) =>
      (await dropPluginSiteCache({ hostIds: [hostId], reason: 'live chat settings changed' })).complete,
  }))
}
