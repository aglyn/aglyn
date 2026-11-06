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
import type {
  PluginSiteResourcePreview,
  PluginSiteResourceRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-site-resources'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { connectionsCollection, listHostConnections } from './connection-store'
import { credentialsForOrg } from './credentials-store'
import { revokeRecord } from './revoke'

/**
 * DECLARED CONNECTIONS GO WITH WHAT HELD THEM (AGL-4193).
 *
 * A SITE deleted takes its connections: `hosts/{hostId}/pluginConnections`
 * is under the site's tree, so `eraseHost`'s recursive delete removes the
 * documents. What it cannot reach is the grant at the provider, which would
 * otherwise go on opening the business's account after the site that held
 * it is gone. So the site-resource eraser, which runs before that delete,
 * revokes each grant first (best effort: a revoke that fails is logged, and
 * the sealed token is deleted either way), then deletes the documents itself
 * so nothing depends on the order.
 *
 * A WORKSPACE erased takes the OAuth app credentials its listings hold
 * (`pluginConnectionCredentials`, keyed by `orgId`): the erasure sweeps that
 * collection by field (`orgKeyedCollections`), and the marketplace's org
 * eraser deletes them too and counts them, so the audit record says how many
 * went. Its sites' connections go with each site, through the eraser above.
 *
 * Nothing is listed on the Delete site card: a connection holds no content of
 * the owner's, only a grant the owner can make again.
 */

const firestore = (): FirebaseFirestore.Firestore => firebaseAdmin.app().firestore()

/** The site-resource eraser: nothing to preview, every grant revoked and deleted on erase. */
export const pluginConnectionsSiteEraser = {
  async preview(): Promise<PluginSiteResourcePreview> {
    return { noun: ['plugin connection', 'plugin connections'], itemNoun: ['item', 'items'], going: [], staying: 0 }
  },
  async erase(request: PluginSiteResourceRequest): Promise<number> {
    const records = await listHostConnections(firestore(), request.hostId)
    for (const record of records) await revokeRecord(record, request.orgId)
    const snapshot = await connectionsCollection(firestore(), request.hostId).get()
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()))
    return records.length
  },
}

/** The workspace's share: its listings' OAuth app credentials, counted and (unless a dry run) deleted. */
export async function erasePluginConnectionCredentials(request: PluginOrgErasureRequest): Promise<PluginOrgErasureReport> {
  const docs = await credentialsForOrg(firestore(), request.orgId)
  if (!request.dryRun) await Promise.all(docs.map((doc) => doc.ref.delete()))
  return { connectionCredentials: docs.length }
}
