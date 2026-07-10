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
  firebaseAdmin,
  getOrgDoc,
  getOrgForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

export interface MediaScope {
  /** Storage prefix + Firestore parent: `hosts/{id}` or `orgs/{id}`. */
  base: string
  /** `hosts` | `orgs` — the parent collection. */
  collection: 'hosts' | 'orgs'
  /** Host or org id. */
  scopeId: string
  /** Firestore doc ref of the scope (media/mediaFolders/counters parent). */
  scopeRef: FirebaseFirestore.DocumentReference
  /** Billing/entitlement doc — the owning org either way (AGL-238). */
  billing: Record<string, unknown>
  /** Segment used in cdnPath — `{hostId}` or `org:{orgId}`. */
  cdnScope: string
}

export interface MediaScopeError {
  status: number
  message: string
}

/**
 * Media APIs serve two scopes (org DAM parity): a host's own library and
 * the organization's shared one. Resolution authenticates the caller for
 * whichever identity the request carries — host `memberRoles`
 * admin/editor, or org roster role owner/admin/editor — and hands back
 * the Storage/Firestore base plus the billing doc for quota gates.
 */
export async function resolveMediaScope(
  body: Record<string, unknown> | undefined,
  query: Partial<Record<string, string | string[]>>,
  uid: string,
): Promise<{ scope?: MediaScope; error?: MediaScopeError }> {
  const firestore = firebaseAdmin.app().firestore()
  const orgId = String(body?.['orgId'] ?? query['orgId'] ?? '') || null
  const hostId = String(body?.['hostId'] ?? query['hostId'] ?? '') || null

  if (orgId) {
    const membership = await resolveOrgMembership(uid, orgId)
    const role = membership?.member.role
    if (!role || role === 'viewer') {
      return {
        error: {
          status: 403,
          message: 'Editing the organization library requires the editor role',
        },
      }
    }
    const org = (await getOrgDoc(orgId)) ?? {}
    return {
      scope: {
        base: `orgs/${orgId}`,
        collection: 'orgs',
        scopeId: orgId,
        scopeRef: firestore.collection('orgs').doc(orgId),
        billing: org as Record<string, unknown>,
        cdnScope: `org:${orgId}`,
      },
    }
  }

  if (!hostId) {
    return { error: { status: 400, message: 'Missing hostId or orgId' } }
  }
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) {
    return { error: { status: 404, message: 'Unknown site' } }
  }
  const memberRole = (hostSnapshot.get('memberRoles') ?? {})[uid]
  if (memberRole !== 'admin' && memberRole !== 'editor') {
    return { error: { status: 403, message: 'Not a site admin' } }
  }
  const billing = (await getOrgForHost(hostId))?.org ?? {}
  return {
    scope: {
      base: `hosts/${hostId}`,
      collection: 'hosts',
      scopeId: hostId,
      scopeRef: hostRef,
      billing: billing as Record<string, unknown>,
      cdnScope: hostId,
    },
  }
}

/** Folder names become real Storage path segments — keep them tame. */
export function sanitizeFolderSegment(name: unknown): string {
  return (
    String(name ?? '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'folder'
  )
}

/**
 * Materialized Storage path for a folder (AGL: real folders): walks the
 * mediaFolders parent chain and joins sanitized names. Empty string for
 * root/unknown folders — a stale id files the asset at the root.
 */
export async function folderStoragePath(
  scopeRef: FirebaseFirestore.DocumentReference,
  folderId: string | null,
): Promise<string> {
  const segments: string[] = []
  let current: string | null = folderId
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const snapshot = await scopeRef
      .collection('mediaFolders')
      .doc(current)
      .get()
    if (!snapshot.exists) break
    segments.unshift(sanitizeFolderSegment(snapshot.get('name')))
    current = (snapshot.get('parentId') as string | null) ?? null
  }
  return segments.join('/')
}

/**
 * The object path recorded on the media doc, with the legacy flat layout
 * as fallback for assets uploaded before real folders existed.
 */
export function mediaObjectPath(
  mediaSnapshot: FirebaseFirestore.DocumentSnapshot,
  base: string,
): string {
  const stored = mediaSnapshot.get('storagePath')
  return typeof stored === 'string' && stored
    ? stored
    : `${base}/media/${mediaSnapshot.id}`
}
