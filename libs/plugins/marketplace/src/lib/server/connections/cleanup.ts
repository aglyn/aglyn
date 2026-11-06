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

import {
  findPluginConnection,
  validatePluginConnections,
  type PluginConnectionDeclaration,
} from '@aglyn/aglyn/app-utils/plugin-connections'
import { isPluginRevoked, type PluginRevocation } from '@aglyn/aglyn/app-utils/plugin-manifest'
import {
  connectionRecordRef,
  connectionRef,
  listHostConnections,
  type PluginConnectionRecord,
} from './connection-store'
import type { InstalledPluginConnections } from './installed-connection'
import { revokeRecord } from './revoke'

/**
 * A SITE'S CONNECTION GOES WHEN THE PLUGIN THAT DECLARED IT DOES (AGL-4194).
 *
 * A grant is held for one purpose: the plugin the site installed. When the
 * site uninstalls that plugin, or moves to a version that no longer declares
 * the connection, the grant is revoked at the provider (best effort) and the
 * connection and its record are deleted. Nothing else of the plugin's is
 * deleted on uninstall; this is a grant to someone else's account, which
 * outlives its purpose the moment the plugin goes.
 *
 * Three readings of a pin, kept apart on purpose:
 *
 *   - `declared`: the site runs a version that declares the connection;
 *   - `gone`: no pin (the site's own or its workspace's), or the pinned
 *     version declares no such connection. The connection is an orphan;
 *   - `paused`: the pinned version is revoked by the kill switch, or its
 *     manifest no longer reads. Nothing runs, and NOTHING is deleted: a
 *     takedown lifted tomorrow must find the site still connected.
 *
 * Called from the uninstall and install routes (`install-plugin.ts`) with the
 * declarations the pin held before it moved, and from the scheduled sync for
 * any orphan it meets.
 */

export type PinnedConnectionState =
  | { state: 'declared'; installed: InstalledPluginConnections; connection: PluginConnectionDeclaration }
  | { state: 'gone' }
  | { state: 'paused' }

/** Where a site's connection stands against the pin the site runs now. */
export async function pinnedConnectionState(
  firestore: FirebaseFirestore.Firestore,
  input: { hostId: string; orgId: string | null; listingId: string; connectionId: string },
): Promise<PinnedConnectionState> {
  const [hostPin, orgPin, revocation] = await Promise.all([
    firestore.collection('hosts').doc(input.hostId).collection('installs').doc(input.listingId).get(),
    input.orgId
      ? firestore.collection('orgs').doc(input.orgId).collection('installs').doc(input.listingId).get()
      : Promise.resolve(null),
    firestore.collection('revocations').doc(input.listingId).get(),
  ])
  // The site's own pin wins over the workspace's, as it does for the loaders.
  const pin = hostPin.exists ? hostPin.data() : orgPin?.exists ? orgPin.data() : undefined
  if (!pin) return { state: 'gone' }
  const version = String(pin['version'] ?? '')
  if (!version) return { state: 'paused' }
  if (isPluginRevoked(revocation.data() as PluginRevocation | undefined, version)) return { state: 'paused' }
  const manifest = (pin['manifest'] ?? null) as { connections?: unknown; name?: unknown } | null
  if (manifest?.connections === undefined) return { state: 'gone' }
  const verdict = validatePluginConnections(manifest.connections)
  if (verdict.ok === false) return { state: 'paused' }
  const connection = findPluginConnection({ connections: verdict.value }, input.connectionId)
  if (!connection) return { state: 'gone' }
  return {
    state: 'declared',
    connection,
    installed: {
      listingId: input.listingId,
      version,
      displayName: String(pin['displayName'] ?? manifest.name ?? input.listingId).slice(0, 120),
      connections: verdict.value,
    },
  }
}

/**
 * Revokes a connection's grant (best effort, with `declaration` when the pin
 * that declared it is already gone) and deletes the connection and its record.
 */
export async function forgetSiteConnection(
  firestore: FirebaseFirestore.Firestore,
  record: Pick<PluginConnectionRecord, 'hostId' | 'listingId' | 'connectionId'> & Partial<PluginConnectionRecord>,
  input: { orgId: string | null; declaration?: PluginConnectionDeclaration | null; revoke?: typeof revokeRecord },
): Promise<{ revoked: boolean }> {
  const revoke = input.revoke ?? revokeRecord
  const revoked = await revoke(record as PluginConnectionRecord, input.orgId, input.declaration ?? null)
  await Promise.all([
    connectionRef(firestore, record.hostId, record.listingId, record.connectionId).delete(),
    connectionRecordRef(firestore, record.hostId, record.listingId, record.connectionId).delete(),
  ])
  return { revoked }
}

/**
 * After a pin of `listingId` moved (removed, or re-pinned to another version)
 * on `hostIds`: every connection of that listing a site holds that its pin no
 * longer declares is revoked and deleted. `previous` is what the pin declared
 * before it moved, for the revocation endpoint. Answers how many went.
 */
export async function reconcileListingConnections(
  firestore: FirebaseFirestore.Firestore,
  input: {
    hostIds: readonly string[]
    orgId: string | null
    listingId: string
    previous: readonly PluginConnectionDeclaration[]
  },
): Promise<number> {
  let forgotten = 0
  for (const hostId of input.hostIds) {
    const records = (await listHostConnections(firestore, hostId)).filter((one) => one.listingId === input.listingId)
    for (const record of records) {
      const pinned = await pinnedConnectionState(firestore, {
        hostId,
        orgId: input.orgId,
        listingId: input.listingId,
        connectionId: record.connectionId,
      })
      if (pinned.state !== 'gone') continue
      await forgetSiteConnection(firestore, record, {
        orgId: input.orgId,
        declaration: input.previous.find((one) => one.id === record.connectionId) ?? null,
      })
      forgotten += 1
    }
  }
  return forgotten
}

/** The connections a pin's manifest declares, read defensively; `[]` for none or a manifest that does not read. */
export function pinConnections(pin: Record<string, unknown> | undefined | null): PluginConnectionDeclaration[] {
  const connections = (pin?.['manifest'] as { connections?: unknown } | undefined)?.connections
  if (connections === undefined) return []
  const verdict = validatePluginConnections(connections)
  return verdict.ok === false ? [] : verdict.value
}
