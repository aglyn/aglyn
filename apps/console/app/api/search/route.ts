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
  oneBoxCursor,
  oneBoxLimit,
  oneBoxQuery,
} from '@aglyn/aglyn/app-utils/one-box-search'
import { listPluginSearchSources } from '@aglyn/aglyn/plugin-manager/plugin-search-sources'
import {
  checkRateLimit,
  firebaseAdmin,
  lockdownRefusal,
  rateLimitHeaders,
  resolveMemberOrgPermissions,
} from '@aglyn/tenant-data-admin'
import { applyListQuery } from '@aglyn/tenant-data-admin/server/list-query'
import { filterEnabledPluginsByReleaseFlags } from '@aglyn/tenant-data-admin/server/release-flags'
import { registerPluginServerDeclarations } from '../../../constants/plugins.declarations.server.generated'
import { invalidIdTokenResponse } from '../_lib/invalid-id-token-response'
import { runOneBoxSearch, type OneBoxDoc, type OneBoxStore } from '../_lib/one-box-search'

/**
 * `GET /api/search` — the native apps' one box (AGL-3943): the person's
 * workspaces and sites across every workspace, and the records of the workspace or site they stand in, grouped
 * and paged. See `_lib/one-box-search.ts` for what is read and who sees it,
 * and `@aglyn/aglyn/app-utils/one-box-search` for the request and payload.
 *
 * Signed in by the Firebase ID token, as every console route the apps call
 * (console routes are not App Check gated, docs/mobile/native-architecture.md
 * §4). Counted per account against an in-process window (`checkRateLimit`,
 * the volume limiter: a read here costs reads, never a consequence), so a
 * box typed into cannot become a scraper.
 */

/** Searches one account may run a minute; a typed query debounced runs a few. */
const ONE_BOX_RATE_LIMIT = 60

const SEARCH_RATE_WINDOW_MS = 60_000

/** The Admin SDK behind the engine's reads. */
function adminStore(): OneBoxStore {
  const db = firebaseAdmin.app().firestore()
  const byId = firebaseAdmin.firestore.FieldPath.documentId()
  const docs = (snapshot: FirebaseFirestore.QuerySnapshot): OneBoxDoc[] =>
    snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
  return {
    async get(path) {
      const snapshot = await db.doc(path).get()
      return snapshot.exists ? (snapshot.data() ?? {}) : null
    },
    async window(path, { where, limit, startAfterId }) {
      let query: FirebaseFirestore.Query = db.collection(path)
      if (where) query = query.where(where.field, where.op, where.value)
      query = query.orderBy(byId)
      if (startAfterId) query = query.startAfter(startAfterId)
      return docs(await query.limit(limit).get())
    },
    async planned(path, plan, limit) {
      return docs(await applyListQuery(db.collection(path), plan as never).limit(limit).get())
    },
  }
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const rate = checkRateLimit(`one-box:${decoded.uid}`, {
      limit: ONE_BOX_RATE_LIMIT,
      windowMs: SEARCH_RATE_WINDOW_MS,
    })
    if (!rate.allowed) {
      return Response.json(
        { error: 'Too many searches. Try again in a moment.' },
        { status: 429, headers: rateLimitHeaders(rate) },
      )
    }

    const url = new URL(request.url)
    const text = oneBoxQuery(url.searchParams.get('q'))
    if (!text) {
      return Response.json({ error: 'Type at least two characters' }, { status: 400 })
    }
    const orgId = url.searchParams.get('orgId')?.trim() || null
    const hostId = url.searchParams.get('hostId')?.trim() || null
    if (hostId && !orgId) {
      return Response.json({ error: 'A site is searched inside its workspace: send orgId' }, { status: 400 })
    }

    const store = adminStore()
    if (orgId) {
      // Lockdown verdict (AGL-1506): a workspace or site that is locked is
      // not searched; the platform and account scopes ride on the same call.
      const locked = await lockdownRefusal({
        request,
        staff: decoded['staff'] === true,
        uid: decoded.uid,
        org: ((await store.get(`orgs/${orgId}`)) ?? undefined) as never,
        host: (hostId ? ((await store.get(`hosts/${hostId}`)) ?? undefined) : undefined) as never,
      })
      if (locked) return locked
    } else {
      const locked = await lockdownRefusal({
        request,
        staff: decoded['staff'] === true,
        uid: decoded.uid,
      })
      if (locked) return locked
    }

    // The plugins' server search sources are registered by their console
    // declarations; the step memoizes itself, so this is once per process.
    await registerPluginServerDeclarations().catch((error) =>
      console.error('[api/search] plugin declarations failed', error),
    )

    const result = await runOneBoxSearch({
      store,
      uid: decoded.uid,
      text,
      orgId,
      hostId,
      limit: oneBoxLimit(url.searchParams.get('limit')),
      group: url.searchParams.get('group'),
      cursor: oneBoxCursor(url.searchParams.get('cursor')),
      sources: listPluginSearchSources(),
      permissions: (id, member) => resolveMemberOrgPermissions(id, member as never),
      releaseFilter: (ids, id) => filterEnabledPluginsByReleaseFlags(ids, { orgId: id, authorization }),
    })
    if (result.status !== 200) {
      return Response.json({ error: result.error }, { status: result.status })
    }
    return Response.json(result.body, {
      status: 200,
      headers: { 'Cache-Control': 'no-store', ...rateLimitHeaders(rate) },
    })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[api/search]', error)
    return Response.json({ error: 'Search failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
