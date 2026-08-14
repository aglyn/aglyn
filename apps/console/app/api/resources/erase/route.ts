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
  collectionDeleteDenial,
  collectionTemplateBindings,
  hostCollectionKind,
  pluginRequestFromWeb,
  type CollectionTemplateScreen,
  type CollectionTemplateSource,
} from '@aglyn/aglyn/server'
// Shared, unit-tested scope decision lives in _lib: route.ts may only
// export handlers.
import { eraseScopeDenial } from '../../_lib/erase-scope'
import { isErasable, type Scope } from '../../_lib/erasable'
import {
  emailUnverifiedResponse,
  eraseSubtree,
  firebaseAdmin,
  isImpersonationSession,
  lockdownRefusal,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

/** Roles allowed to delete org data — mirrors rules' canWriteOrgData(). */
const ORG_WRITER_ROLES = new Set(['owner', 'admin', 'editor'])
/** Roles allowed to delete host content — mirrors canWriteHostContent(). */
const HOST_WRITER_ROLES = new Set(['admin', 'editor'])
/**
 * Deleting a whole COLLECTION is a site-structural act, not a content edit
 * (AGL-1324): it removes the `/{slug}` and `/{slug}/{entry}` routes the site
 * publishes, which is the same grade of action as deleting the site — and
 * that has always been admin-only (`DeleteSiteCard`). Hosts have no `owner`
 * role; `admin` IS the top of the site role model, so this is the
 * "owner/admin only" gate the issue asks for.
 *
 * This tightens the commerce catalog card too, which reached the same route
 * with the same kind as an `editor`. Deliberate: one resource, one gate.
 */
const HOST_ADMIN_ROLES = new Set(['admin'])

/**
 * The AGL-1324 dependency reads behind {@link collectionDeleteDenial}: how
 * many entries the collection still holds, and which of its template screens
 * are still alive. One aggregation query plus at most two document gets, and
 * only for a collection — every other kind skips this entirely.
 *
 * The reads live here and the decision lives in `@aglyn/aglyn`, so the rule
 * itself is unit-tested and the console dialog can show the same blockers
 * before it arms its button.
 */
async function collectionDependencyDenial(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  snapshot: FirebaseFirestore.DocumentSnapshot,
) {
  const data = (snapshot.data() ?? {}) as CollectionTemplateSource & {
    displayName?: unknown
    name?: unknown
  }
  const boundIds = [...new Set(
    [data.listScreenId, data.entryScreenId, data.templateScreenId]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0),
  )]
  const screensRef = firestore.collection('hosts').doc(hostId).collection('screens')
  const [entryCount, screenDocs] = await Promise.all([
    snapshot.ref
      .collection('entries')
      .count()
      .get()
      .then((result) => Number(result.data().count ?? 0)),
    boundIds.length
      ? firestore.getAll(...boundIds.map((screenId) => screensRef.doc(screenId)))
      : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]),
  ])

  const screens: Record<string, CollectionTemplateScreen | undefined> = {}
  for (const screen of screenDocs) {
    if (!screen.exists) continue
    screens[screen.id] = {
      displayName: screen.get('displayName') as string | undefined,
      deletedAt: screen.get('deletedAt'),
    }
  }

  return collectionDeleteDenial({
    // Content collections name themselves `displayName`, catalog ones `name`.
    displayName: String(data.displayName ?? data.name ?? ''),
    entryCount,
    bindings: collectionTemplateBindings(data, screens),
  })
}

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
      if (!member || !ORG_WRITER_ROLES.has(String(member.role))) {
        return Response.json({
          error: 'Deleting org data requires the editor role',
        }, { status: 403 })
      }
      // Lockdown verdict (AGL-1506): the `orgSuspended` member projection
      // stays the per-request org signal (no org-doc read on the happy
      // path); when it trips, the org doc is read only then to build the
      // distinct 423. The user scope rides along — an erase is destructive
      // and rare, so the per-call read is proportionate. A projection/doc
      // disagreement keeps the old refusal — never loosened.
      const locked = await lockdownRefusal({
        request,
        uid: decoded.uid,
        org:
          member.orgSuspended === true
            ? ((
                await firestore.collection('orgs').doc(scopeId).get()
              ).data() ?? {})
            : undefined,
      })
      if (locked) return locked
      if (member.orgSuspended === true) {
        return Response.json({
          error: 'This workspace is suspended',
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
      // A collection delete takes published routes with it, so it needs the
      // admin gate rather than the content-editor one (AGL-1324).
      const isCollection = kind === 'collections'
      const requiredRoles = isCollection ? HOST_ADMIN_ROLES : HOST_WRITER_ROLES
      if (!requiredRoles.has(String(memberRole))) {
        return Response.json({
          error: isCollection
            ? 'Deleting a collection requires the site admin role'
            : 'Deleting site content requires the editor role',
        }, { status: 403 })
      }
      const orgId = hostSnapshot.get('orgId') as string | undefined
      // Lockdown verdict (AGL-1506): replaces the ad-hoc `suspendedAt` 403
      // this branch carried — the same org read as before, now feeding the
      // shared helper so the platform/host/user scopes and the distinct
      // 423 body come with it.
      const orgSnapshot = orgId
        ? await firestore.collection('orgs').doc(orgId).get()
        : undefined
      const locked = await lockdownRefusal({
        request,
        uid: decoded.uid,
        org: orgSnapshot?.data(),
        host: hostSnapshot.data(),
      })
      if (locked) return locked
    }

    // `collections` holds two unrelated document kinds on one path (AGL-954).
    // The caller states which one it believes it is deleting, and that is
    // checked here — the catalog card must not be able to recursiveDelete a
    // content collection's `entries`, however stale its list is.
    const expectedCollectionKind = body?.collectionKind
    if (kind === 'collections') {
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
      if (snapshot.exists) {
        if (
          expectedCollectionKind &&
          hostCollectionKind(snapshot.data()) !== expectedCollectionKind
        ) {
          return Response.json({
            error: 'That collection belongs to a different part of the console',
          }, { status: 409 })
        }
        // Nothing may depend on it (AGL-1324). Enforced here and not only in
        // the dialog: the console computes the same blockers for fast
        // feedback, but a stale client — or a direct call — must not be able
        // to cascade a published page or a shelf of entries out of existence.
        const denial = await collectionDependencyDenial(
          firestore,
          scopeId,
          snapshot,
        )
        if (denial) {
          return Response.json({
            error: denial.error,
            blockers: denial.blockers,
          }, { status: denial.status })
        }
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
