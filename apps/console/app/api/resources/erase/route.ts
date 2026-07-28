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
import { isErasable, type Scope } from '../../_lib/erasable'
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

/**
 * Recursive delete for the org/host resources that own subcollections.
 *
 * `recursiveDelete` is Admin-SDK-only, so these deletes cannot happen in the
 * console cards — the rules now deny the client a direct delete of these
 * parent docs (the child collections stay client-writable, so deleting a
 * single record/entry is unaffected).
 *
 * Both scopes are still accepted, but they are no longer two ways to reach
 * the SAME resource (AGL-1050 follow-up). `datasets` and `lists` are org
 * resources, full stop — the `['hosts', hostId]` fallback the cards used to
 * resolve to is deleted, production held nothing under it, and the rules now
 * deny it. `collections` is the one genuinely host-scoped kind.
 *
 * That mattered for more than tidiness. The `scope === 'orgs'` branch below
 * is where `eraseScopeDenial` runs — the AGL-1046 boundary that stops a site
 * collaborator recursiveDelete-ing a dataset AGL-1041 forbids them to read.
 * The host branch checks `memberRoles` and never consults `visibleTo`,
 * because host content has none. So while `datasets`/`lists` accepted
 * `'hosts'`, naming that scope was a way to ASK FOR THE WEAKER CHECK. It
 * targeted `hosts/{hostId}/datasets/*`, which is empty in production, so
 * nothing was ever destroyable through it — but the Admin SDK evaluates no
 * rules, and a second accepted scope is a second boundary to keep correct
 * forever. Now an unknown scope for a kind is a 400 before any read.
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
  // Kind AND scope together: a known kind named under a scope it does not
  // live in is rejected here, before any read (AGL-1050 follow-up).
  const erasable = isErasable(kind, scope)
  if (!scopeId || !id) {
    return Response.json({ error: 'Missing scopeId or id' }, { status: 400 })
  }
  if (!erasable) {
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
    // Hoisted so the collection-kind check below can reuse it rather than
    // re-reading the same document.
    let target: FirebaseFirestore.DocumentSnapshot | undefined

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
      target = await firestore
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
      // Reuses the org-scope read above when there was one — `collections`
      // is host-scoped, so in practice this fetches; the guard just avoids
      // a second read of the identical doc if that ever changes.
      const snapshot =
        target ??
        (await firestore
          .collection(scope)
          .doc(scopeId)
          .collection(kind)
          .doc(id)
          .get())
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
