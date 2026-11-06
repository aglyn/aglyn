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

import { openSecret, sealSecret, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { PLUGIN_CONNECTION_CREDENTIALS_COLLECTION, pluginConnectionDocId } from '../../model/plugin-connections'
import type { PluginConnectionClient } from './provider-http'

/**
 * A LISTING'S OAUTH APP, SEALED (AGL-4193).
 *
 * `pluginConnectionCredentials/{listingId}__{connectionId}`: the client id
 * and secret of the PUBLISHER's own OAuth app, which every site's connect for
 * that listing authenticates with. Both are sealed with
 * `PLUGIN_CONNECTIONS_TOKEN_KEY`, each bound to this document and its purpose
 * as the seal's context, so a value copied into another listing's document
 * refuses to open there.
 *
 * Write-only by design: no route reads either value back. A publisher sees
 * "set" or "not set", and replaces the pair whole. `orgId` names the
 * publishing workspace, so that workspace's erasure sweeps the document by
 * field (`orgKeyedCollections`), and the Firestore rules refuse every client.
 */

export interface PluginConnectionCredentialsRecord {
  /** The publishing workspace. */
  orgId: string
  listingId: string
  connectionId: string
  sealedClientId: string
  sealedClientSecret: string
  updatedAtMs: number
  updatedBy: string
}

export function credentialsRef(
  firestore: FirebaseFirestore.Firestore,
  listingId: string,
  connectionId: string,
): FirebaseFirestore.DocumentReference {
  return firestore.collection(PLUGIN_CONNECTION_CREDENTIALS_COLLECTION).doc(pluginConnectionDocId(listingId, connectionId))
}

/** The seal's context: this document and this value's purpose. */
export const credentialsContext = (listingId: string, connectionId: string, purpose: 'client-id' | 'client-secret') =>
  `plugin-connections:credentials:${listingId}:${connectionId}:${purpose}`

/** Builds the stored record for a pair the publisher typed. */
export function sealCredentials(
  keyring: SecretBoxKeyring,
  input: { orgId: string; listingId: string; connectionId: string; clientId: string; clientSecret: string; uid: string; nowMs: number },
): PluginConnectionCredentialsRecord {
  return {
    orgId: input.orgId,
    listingId: input.listingId,
    connectionId: input.connectionId,
    sealedClientId: sealSecret(input.clientId, keyring.current, {
      context: credentialsContext(input.listingId, input.connectionId, 'client-id'),
    }),
    sealedClientSecret: sealSecret(input.clientSecret, keyring.current, {
      context: credentialsContext(input.listingId, input.connectionId, 'client-secret'),
    }),
    updatedAtMs: input.nowMs,
    updatedBy: input.uid,
  }
}

export async function saveCredentials(
  firestore: FirebaseFirestore.Firestore,
  record: PluginConnectionCredentialsRecord,
): Promise<void> {
  await credentialsRef(firestore, record.listingId, record.connectionId).set(record)
}

export async function clearCredentials(
  firestore: FirebaseFirestore.Firestore,
  listingId: string,
  connectionId: string,
): Promise<void> {
  await credentialsRef(firestore, listingId, connectionId).delete()
}

/** Whether each named connection's credentials are set, and when: never the values. */
export async function credentialsStatus(
  firestore: FirebaseFirestore.Firestore,
  listingId: string,
  connectionIds: readonly string[],
): Promise<Record<string, { set: boolean; updatedAtMs: number | null }>> {
  const snapshots = await Promise.all(connectionIds.map((id) => credentialsRef(firestore, listingId, id).get()))
  const out: Record<string, { set: boolean; updatedAtMs: number | null }> = {}
  connectionIds.forEach((id, index) => {
    const data = snapshots[index].exists ? snapshots[index].data() : undefined
    const set = typeof data?.['sealedClientId'] === 'string' && typeof data?.['sealedClientSecret'] === 'string'
    out[id] = { set, updatedAtMs: set ? Number(data?.['updatedAtMs']) || null : null }
  })
  return out
}

/**
 * The publisher's OAuth app for a listing's connection, opened, or `null`
 * when it is not set. Throws `SecretBoxError` for a value that does not open
 * (a key that was dropped from the ring, or a tampered document).
 */
export async function openCredentials(
  firestore: FirebaseFirestore.Firestore,
  keyring: SecretBoxKeyring,
  listingId: string,
  connectionId: string,
): Promise<PluginConnectionClient | null> {
  const snapshot = await credentialsRef(firestore, listingId, connectionId).get()
  const data = snapshot.exists ? snapshot.data() : undefined
  if (typeof data?.['sealedClientId'] !== 'string' || typeof data?.['sealedClientSecret'] !== 'string') return null
  return {
    clientId: openSecret(data['sealedClientId'], keyring, {
      context: credentialsContext(listingId, connectionId, 'client-id'),
    }).plaintext,
    clientSecret: openSecret(data['sealedClientSecret'], keyring, {
      context: credentialsContext(listingId, connectionId, 'client-secret'),
    }).plaintext,
  }
}

/** Every credentials document a workspace's listings hold, for its erasure. */
export async function credentialsForOrg(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const snapshot = await firestore.collection(PLUGIN_CONNECTION_CREDENTIALS_COLLECTION).where('orgId', '==', orgId).get()
  return snapshot.docs
}
