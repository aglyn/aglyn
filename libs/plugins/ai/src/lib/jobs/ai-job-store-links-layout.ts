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

import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import type { Firestore } from 'firebase-admin/firestore'
import { aiLayoutWithStoreLinks, type AiStoreLayoutLinks } from '../model/ai-layout-store-links'

/**
 * A store's links in the site's own layout, as a DRAFT (AGL-3676): a build
 * that makes the site a store and builds no layout writes a new version of
 * the layout its store pages render inside, with Account (and Cart, where
 * the header has none) in the header and the account and policies in the
 * footer (`aiLayoutWithStoreLinks`). The layout's current version — the one
 * visitors see — is never touched: the new version waits beside it, and goes
 * live only when the build publishes (`aiPublishGuidedSite`'s `storeLinks`),
 * as every draft the build makes does.
 */

/** The field a draft version keeps the version it was made from in, so a publish knows whether it is still current. */
export const AI_STORE_LINKS_SOURCE_FIELD = 'aiStoreLinksSourceVersionId'

/** What a store links draft version is called in the layout's versions. */
export const AI_STORE_LINKS_VERSION_NAME = 'Account and policy links'

/** What writing a store's links into the site's layout came to. */
export type AiStoreLinksLayoutDraft =
  | { status: 'written'; layoutId: string; versionId: string; name: string }
  /** Every link was already there. */
  | { status: 'present'; layoutId: string }
  /** The layout has no header list or no footer list to add to: what it had room for, if anything, was written. */
  | { status: 'unrecognized'; layoutId: string; versionId: string | null; name: string }
  /** The layout is gone, or has no current version to start from. */
  | { status: 'gone' }

/**
 * Writes the draft version (idempotent: a version with this id already
 * written is that draft). Reads the layout's current version and writes the
 * new one beside it, a copy of it — its fields, everything the editor stored
 * — with the links added.
 */
export async function writeAiStoreLinksLayoutDraft(
  firestore: Firestore,
  input: {
    hostId: string
    layoutId: string
    versionId: string
    links: AiStoreLayoutLinks
    screenPaths: Readonly<Record<string, string>>
    uid: string
    aiJobId: string
    now: Date
  },
): Promise<AiStoreLinksLayoutDraft> {
  const layoutRef = firestore.collection('hosts').doc(input.hostId).collection('layouts').doc(input.layoutId)
  const layout = await layoutRef.get()
  const currentVersionId = layout.get('versionId')
  if (!layout.exists || layout.get('deletedAt') != null || typeof currentVersionId !== 'string' || !currentVersionId) {
    return { status: 'gone' }
  }
  const name = String(layout.get('displayName') ?? '') || 'Layout'
  const draftRef = layoutRef.collection('versions').doc(input.versionId)
  const already = await draftRef.get()
  if (already.exists) return { status: 'written', layoutId: input.layoutId, versionId: input.versionId, name }
  const current = await layoutRef.collection('versions').doc(currentVersionId).get()
  const nodes = current.exists ? decodeStoredNodes<Record<string, unknown>>(current.get('nodes')) : null
  if (!nodes) return { status: 'gone' }
  const result = aiLayoutWithStoreLinks(nodes, input.links, input.screenPaths)
  const recognized = result.header && result.footer
  const packed = result.nodes ? encodeStoredNodes(result.nodes as never) : null
  if (!packed) return recognized ? { status: 'present', layoutId: input.layoutId } : { status: 'unrecognized', layoutId: input.layoutId, versionId: null, name }
  const copy = { ...(current.data() as Record<string, unknown>) }
  delete copy['aiEditJobId']
  await draftRef.create({
    ...copy,
    nodes: Buffer.from(packed),
    displayName: AI_STORE_LINKS_VERSION_NAME,
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.uid,
    aiJobId: input.aiJobId,
    [AI_STORE_LINKS_SOURCE_FIELD]: currentVersionId,
  })
  return recognized
    ? { status: 'written', layoutId: input.layoutId, versionId: input.versionId, name }
    : { status: 'unrecognized', layoutId: input.layoutId, versionId: input.versionId, name }
}
