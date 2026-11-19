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

import { coeditMirrorRoomPath } from '@aglyn/aglyn/app-utils/version-draft'

/**
 * CLEARING A VERSION'S CO-EDIT MIRROR ON THE SERVER (AGL-4235).
 *
 * The mirror (`coeditMirrorRoomPath`, in the Realtime Database) holds the
 * unsaved canvas work a Besigner tab shares with the others in the room, and
 * replays it to whoever joins until a save clears it. A server write that
 * makes the stored version authoritative again (a draft published into it)
 * clears the room the way the Besigner's own save does, or the older unsaved
 * work replays over what was just published.
 *
 * Best effort, like the editor's: the write has landed, and a room that
 * cannot be cleared must not make it look failed. Never throws.
 */

/** The one Realtime Database call this needs, so a spec can stand in for it. */
export interface CoeditMirrorDatabase {
  ref(path: string): { remove(): Promise<unknown> }
}

export interface CoeditMirrorRoom {
  orgId: string
  hostId: string
  /** `screen`, `layout`, …: the document type the Besigner opened. */
  docType: string
  docId: string
  versionId?: string | null
}

/**
 * Removes one version's co-edit mirror room. Answers whether the removal
 * completed. The Admin SDK is loaded on first use, so a module that imports
 * this does not pull it in.
 */
export async function clearCoeditMirror(
  room: CoeditMirrorRoom,
  deps: { database?: () => CoeditMirrorDatabase } = {},
): Promise<boolean> {
  try {
    const database =
      deps.database ?? (await import('./firebase-admin')).firebaseAdmin.database
    await database().ref(coeditMirrorRoomPath(room)).remove()
    return true
  } catch {
    return false
  }
}
