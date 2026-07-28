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

import { hostCollectionKind, pluginRequestFromWeb } from '@aglyn/aglyn/server'
// Shared, unit-tested scope decision lives in _lib: route.ts may only
// export handlers.
import { eraseScopeDenial } from '../../_lib/erase-scope'
import {
  emailUnverifiedResponse,
  eraseSubtree,
  firebaseAdmin,
  isImpersonationSession,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

/** Roles allowed to delete org data — mirrors rules' canWriteOrgData(). */
const ORG_WRITER_ROLES = new Set(['owner', 'admin', 'editor'])
/** Roles allowed to delete host content — mirrors canWriteHostContent(). */
const HOST_WRITER_ROLES = new Set(['admin', 'editor'])

type Scope = 'orgs' | 'hosts'

/**
 * The resources whose deletion has to cascade (AGL-945/946/947). Each of
 * these parents owns a subcollection, and a client-side `deleteDoc` would
 * orphan it. The kind is a whitelist, not a passthrough: the caller names
 * a resource, never a Firestore path, so no request can walk this route
 * into an arbitrary subtree.
 */
const ERASABLE: Record<string, { scopes: readonly Scope[]; label: string }> = {
  // orgs/{orgId}/datasets/{id}/records — form submissions, automation rows.
  datasets: { scopes: ['orgs', 'hosts'], label: 'Dataset' },
  // orgs/{orgId}/lists/{id}/members — enrolled contacts (PII).
  lists: { scopes: ['orgs', 'hosts'], label: 'List' },
  // hosts/{hostId}/collections/{id}/entries — published content entries.
  collections: { scopes: ['hosts'], label: 'Collection' },
}

/**
 * Recursive delete for the org/host resources that own subcollections.
 *
 * `recursiveDelete` is Admin-SDK-only, so these deletes cannot happen in the
 * console cards — the rules now deny the client a direct delete of these
 * parent docs (the child collections stay client-writable, so deleting a
 * single record/entry is unaffected).
 *
 * The cards resolve their scope as `['orgs', orgId]`, falling back to
 * `['hosts', hostId]` when a host has no owning org yet, so both scopes are
 * accepted and each is authorized against its own membership model.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const scope = String(body?.scope ?? '') as Scope
  const scopeId = String(body?.scopeId ?? '')
  const kind = String(body?.kind ?? '')
  const id = String(body?.id ?? '')
  const erasable = ERASABLE[kind]
  if (!scopeId || !id) {
    return Response.json({ error: 'Missing scopeId or id' }, { status: 400 })
  }
  if (!erasable || !erasable.scopes.includes(scope)) {
    return Response.json({ error: 'Unknown resource' }, { status: 400 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const isStaff = decoded['staff'] === true

    if (!isStaff && scope === 'orgs') {
      const membership = await resolveOrgMembership(decoded.uid, scopeId)
      const member = membership?.member as any
      if (
        !member ||
        !ORG_WRITER_ROLES.has(String(member.role)) ||
        member.orgSuspended === true
      ) {
        return Response.json({
          error: 'Deleting org data requires the editor role',
        }, { status: 403 })
      }

      // The role check above is NOT sufficient (AGL-1046) — see
      // `eraseScopeDenial` for what it misses and why it is a 404.
      const target = await firestore
        .collection(scope)
        .doc(scopeId)
        .collection(kind)
        .doc(id)
        .get()
      const denial = eraseScopeDenial({
        visibleTo: target.get('visibleTo') as string[] | undefined,
        member,
        // A caller-supplied hint, treated as one: omitting it skips the
        // shared-resource rail but not the boundary check, which is the
        // part that is load-bearing.
        fromHostId: body?.hostId ? String(body.hostId) : '',
        label: erasable.label,
        exists: target.exists,
      })
      if (denial) {
        return Response.json({ error: denial.error }, { status: denial.status })
      }
    } else if (!isStaff) {
      // Host scope: the site's own member roles gate content, and a
      // suspended owning org blocks writes the same way the rules do.
      const hostSnapshot = await firestore.collection('hosts').doc(scopeId).get()
      if (!hostSnapshot.exists) {
        return Response.json({ error: 'Unknown site' }, { status: 404 })
      }
      const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
      if (!HOST_WRITER_ROLES.has(String(memberRole))) {
        return Response.json({
          error: 'Deleting site content requires the editor role',
        }, { status: 403 })
      }
      const orgId = hostSnapshot.get('orgId') as string | undefined
      if (orgId) {
        const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
        if (orgSnapshot.get('suspendedAt')) {
          return Response.json({
            error: 'This workspace is suspended',
          }, { status: 403 })
        }
      }
    }

    // `collections` holds two unrelated document kinds on one path (AGL-954).
    // The caller states which one it believes it is deleting, and that is
    // checked here — the catalog card must not be able to recursiveDelete a
    // content collection's `entries`, however stale its list is.
    const expectedCollectionKind = body?.collectionKind
    if (kind === 'collections' && expectedCollectionKind) {
      const snapshot = await firestore
        .collection(scope)
        .doc(scopeId)
        .collection(kind)
        .doc(id)
        .get()
      if (
        snapshot.exists &&
        hostCollectionKind(snapshot.data()) !== expectedCollectionKind
      ) {
        return Response.json({
          error: 'That collection belongs to a different part of the console',
        }, { status: 409 })
      }
    }

    await eraseSubtree([scope, scopeId, kind, id])

    return Response.json({ ok: true, id }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({
      error: `${erasable.label} could not be deleted`,
    }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
