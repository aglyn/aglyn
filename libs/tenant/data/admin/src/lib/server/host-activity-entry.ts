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

import { connectedAppActorLabel, type HostActivityActor } from '@aglyn/aglyn/app-utils/activity-presenter'
import { activitySearchTokens } from '@aglyn/aglyn/app-utils/activity-search'

/**
 * ONE SHAPE FOR A HOST ACTIVITY ENTRY (AGL-4235).
 *
 * `logHostActivity` appends an entry on its own; a server write that wants
 * the entry in the SAME batch or transaction as the change it records — so a
 * rolled-back write leaves no row claiming it happened — stages this instead.
 * Both build the document here, so an entry reads the same whichever wrote it.
 * No Firestore handle: the caller supplies the clock (`createdAt`).
 */

/** What a host activity entry points at. */
export interface HostActivityEntryTarget {
  type: string
  id?: string
  name?: string
  versionId?: string
}

/** The `hosts/{hostId}/activity` document for one act. */
export function hostActivityEntry(
  actor: HostActivityActor,
  action: string,
  target: HostActivityEntryTarget,
  createdAt: unknown,
): Record<string, unknown> {
  return {
    actorId: actor.uid,
    actorEmail: actor.email ?? null,
    // A key's entry names the key (AGL-2632); a person's carries no such
    // field, so the two are told apart by its presence.
    ...(actor.apiKeyName ? { apiKeyName: actor.apiKeyName } : {}),
    // A connected app's entry names the app instead (AGL-4225).
    ...(actor.connectedAppName
      ? {
          connectedAppName: actor.connectedAppName,
          // The label as the native activity lists print it, which read a
          // stored field rather than build one (AGL-4225).
          connectedAppLabel: connectedAppActorLabel(actor.connectedAppName),
        }
      : {}),
    action,
    target: {
      type: target.type,
      ...(target.id ? { id: target.id } : {}),
      ...(target.name ? { name: target.name } : {}),
      ...(target.versionId ? { versionId: target.versionId } : {}),
    },
    // What the log's search box finds the entry by (AGL-3321): the key's
    // name stands in for an address an integration does not have.
    searchTokens: activitySearchTokens({
      actorEmail: actor.email,
      apiKeyName: actor.apiKeyName,
      connectedAppName: actor.connectedAppName,
      target,
    }),
    createdAt,
  }
}
