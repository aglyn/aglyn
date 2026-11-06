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

/**
 * WHICH CONNECTIONS A SITE'S INSTALLED PLUGINS DECLARE (AGL-4193).
 *
 * A connection is run under the declaration of the version the site has
 * PINNED, never the listing's latest: a publisher shipping a new version must
 * not change where an existing site's token is sent until that site moves to
 * it. The pin carries its manifest (`hosts/{hostId}/installs/{listingId}`, or
 * the workspace-wide `orgs/{orgId}/installs/{listingId}`), and every read here
 * re-validates it, because a denormalized copy is data, not a verdict.
 *
 * A version the kill switch revoked declares nothing: its connections stop
 * connecting with the code that declared them.
 */

export interface InstalledPluginConnections {
  listingId: string
  version: string
  /** The pinned plugin's name, for the activity feed. */
  displayName: string
  connections: PluginConnectionDeclaration[]
}

async function revocationFor(
  firestore: FirebaseFirestore.Firestore,
  listingId: string,
): Promise<PluginRevocation | undefined> {
  return (await firestore.collection('revocations').doc(listingId).get()).data() as PluginRevocation | undefined
}

function readPin(
  listingId: string,
  data: Record<string, unknown> | undefined,
  revocation: PluginRevocation | undefined,
): InstalledPluginConnections | null {
  if (!data) return null
  const version = String(data['version'] ?? '')
  if (!version || isPluginRevoked(revocation, version)) return null
  const manifest = (data['manifest'] ?? null) as { connections?: unknown; name?: unknown } | null
  const verdict = validatePluginConnections(manifest?.connections)
  if (verdict.ok === false || !verdict.value.length) return null
  return {
    listingId,
    version,
    displayName: String(data['displayName'] ?? manifest?.name ?? listingId).slice(0, 120),
    connections: verdict.value,
  }
}

/** The site's pin of one listing (the site's own first, then the workspace's), with its connections. */
export async function installedPluginConnections(
  firestore: FirebaseFirestore.Firestore,
  input: { hostId: string; orgId: string | null; listingId: string },
): Promise<InstalledPluginConnections | null> {
  const [hostPin, orgPin, revocation] = await Promise.all([
    firestore.collection('hosts').doc(input.hostId).collection('installs').doc(input.listingId).get(),
    input.orgId
      ? firestore.collection('orgs').doc(input.orgId).collection('installs').doc(input.listingId).get()
      : Promise.resolve(null),
    revocationFor(firestore, input.listingId),
  ])
  const pin = hostPin.exists ? hostPin.data() : orgPin?.exists ? orgPin.data() : undefined
  return readPin(input.listingId, pin, revocation)
}

/** One declared connection of a listing the site runs, or `null`. */
export async function installedConnection(
  firestore: FirebaseFirestore.Firestore,
  input: { hostId: string; orgId: string | null; listingId: string; connectionId: string },
): Promise<{ installed: InstalledPluginConnections; connection: PluginConnectionDeclaration } | null> {
  const installed = await installedPluginConnections(firestore, input)
  if (!installed) return null
  const connection = findPluginConnection({ connections: installed.connections }, input.connectionId)
  return connection ? { installed, connection } : null
}

/** Every plugin the site runs that declares a connection: its own pins over the workspace's. */
export async function installedConnectionsForHost(
  firestore: FirebaseFirestore.Firestore,
  input: { hostId: string; orgId: string | null },
): Promise<InstalledPluginConnections[]> {
  const [hostPins, orgPins] = await Promise.all([
    firestore.collection('hosts').doc(input.hostId).collection('installs').get(),
    input.orgId ? firestore.collection('orgs').doc(input.orgId).collection('installs').get() : Promise.resolve(null),
  ])
  const pins = new Map<string, Record<string, unknown>>()
  for (const doc of orgPins?.docs ?? []) pins.set(doc.id, doc.data())
  // The site's own pin wins, as it does for the loaders.
  for (const doc of hostPins.docs) pins.set(doc.id, doc.data())
  const declaring = [...pins.entries()].filter(([, data]) => {
    const connections = (data['manifest'] as { connections?: unknown } | undefined)?.connections
    return Array.isArray(connections) && connections.length > 0
  })
  const out: InstalledPluginConnections[] = []
  for (const [listingId, data] of declaring) {
    const read = readPin(listingId, data, await revocationFor(firestore, listingId))
    if (read) out.push(read)
  }
  return out
}

/**
 * The connections a listing's LATEST version declares, for its publisher's
 * credentials form: credentials belong to the listing, and the form offers
 * what the newest version asks for.
 */
export async function latestListingConnections(
  firestore: FirebaseFirestore.Firestore,
  listingId: string,
  latestVersion: string,
): Promise<PluginConnectionDeclaration[]> {
  if (!latestVersion) return []
  const snapshot = await firestore
    .collection('marketplaceListings')
    .doc(listingId)
    .collection('pluginVersions')
    .doc(latestVersion)
    .get()
  const verdict = validatePluginConnections((snapshot.get('manifest') as { connections?: unknown } | undefined)?.connections)
  return verdict.ok === false ? [] : verdict.value
}
