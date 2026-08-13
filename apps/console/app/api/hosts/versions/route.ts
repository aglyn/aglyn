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

import { checkEntitlement, createResourceUid, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getLockdownVerdict,
  getOrgForHost,
  isImpersonationSession,
  lockdownJsonResponse,
} from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'

/**
 * The three parents that carry besigner version history, and the only three
 * whose `versions` subcollection the rules deny client `create` on (AGL-1369).
 *
 * `emailTemplates` deliberately absent: its versions hang off the host
 * catch-all, not these dedicated blocks, and the `versioning` entitlement does
 * not gate email design — the versions panel is not mounted on that besigner.
 */
const PARENTS: Record<string, string> = {
  screen: 'screens',
  layout: 'layouts',
  component: 'components',
}

/**
 * Firestore's own document ceiling. Deliberately larger than the resources
 * route's 256 KB: a version doc IS the node map, and the besigner warns at
 * ~900 KB rather than refusing, so a legitimate page can arrive close to 1 MiB.
 * Capping lower here would refuse saves the product allows.
 */
const MAX_DATA_BYTES = 1024 * 1024

/**
 * Keys a client may set on a version document (AGL-1377). This route had
 * neither an allow-list nor a deny-list — `{ ...data }` went to Firestore
 * whole — which is the same bet /api/hosts/resources lost, one route over
 * and with the guard removed entirely.
 *
 * The list is every key the console's create paths send: the back-pointer
 * to the parent (whichever of the three kinds it is), the host, the label,
 * the node map, and the canvas root. `createdAt`/`updatedAt` are absent
 * because they are stamped below on every create.
 *
 * Saving a version stays client-direct and is unaffected — a save is a
 * merge-set onto the document already open, so a besigner that adds a
 * field to a version it OWNS keeps working. This governs the seed only.
 */
const VERSION_KEYS = new Set([
  'hostId',
  'screenId',
  'layoutId',
  'componentId',
  'displayName',
  'nodes',
  'rootId',
])

/**
 * Creates a besigner version document (AGL-1369).
 *
 * `versioning` (Pro+) was enforced in the console only: the component checked
 * the entitlement and then wrote `versions/{new}` with the client SDK, so a
 * Free or Starter org got Pro version history by writing the document directly.
 *
 * What makes the gate enforceable is that creating a version and SAVING one
 * are different operations, which the previous analysis had backwards. An
 * ordinary canvas save is a merge-set onto the version already open
 * (`saveNodesGuarded`), so it is an update and stays client-direct on every
 * plan. A create means one more version document than there was before — and
 * "more than one" is exactly what the entitlement sells.
 *
 * So the route does not ask the client which kind of create this is. It counts
 * what already exists with the Admin SDK:
 *
 *   - No versions yet -> this is the resource's FIRST, and a resource with no
 *     version cannot be opened at all. Allowed on every plan, no entitlement.
 *   - One or more -> this is retained history. Requires `versioning`.
 *
 * That is the plan-card promise stated exactly: a Free site keeps one working
 * version per screen; Pro keeps history. A client cannot misdeclare its way
 * past it because it never gets to declare anything.
 *
 * Body: `{ hostId, kind, parentId, id?, data?, sourceVersionId? }`. Pass
 * `sourceVersionId` to snapshot an existing version — the copy is made
 * server-side from the stored document, so the node map never crosses the
 * wire and the snapshot cannot be doctored on the way past.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const hostId = String(body?.hostId ?? '')
  const kind = String(body?.kind ?? '')
  const parentCollection = PARENTS[kind]
  const parentId = String(body?.parentId ?? '')
  if (!hostId || !parentCollection || !parentId) {
    return Response.json(
      { error: 'Missing hostId or parentId, or unknown kind' },
      { status: 400 },
    )
  }
  const sourceVersionId =
    typeof body?.sourceVersionId === 'string' && body.sourceVersionId
      ? String(body.sourceVersionId)
      : undefined
  const data = body?.data
  if (!sourceVersionId && (!data || typeof data !== 'object' || Array.isArray(data))) {
    return Response.json(
      { error: 'Missing data (or sourceVersionId)' },
      { status: 400 },
    )
  }
  if (data && JSON.stringify(data).length > MAX_DATA_BYTES) {
    return Response.json({ error: 'Payload too large' }, { status: 413 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    // Same role model as the rules' canWriteHostContent, and as
    // /api/hosts/resources: host member role admin/editor.
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return Response.json(
        { error: 'Editing requires the editor role' },
        { status: 403 },
      )
    }

    const ownerOrg = await getOrgForHost(hostId)
    const org = (ownerOrg?.org ?? {}) as any
    // Lockdown verdict (AGL-1501): subsumes the old bare `suspendedAt` check
    // — same org read, plus the platform/host/user scopes and the distinct
    // 423 body an API consumer can tell apart from a role 403. Staff bypass
    // is the un-panic invariant.
    const lockdown = await getLockdownVerdict({
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org,
      host: hostSnapshot.data(),
    })
    if (lockdown) return lockdownJsonResponse(lockdown)

    const parentRef = hostRef.collection(parentCollection).doc(parentId)
    const parentSnapshot = await parentRef.get()
    if (!parentSnapshot.exists) {
      return Response.json({ error: 'Unknown document' }, { status: 404 })
    }

    const versionsRef = parentRef.collection('versions')
    // The count is the gate, and it is read here rather than taken on trust.
    // `limit(1)` because only "any" versus "none" matters — a full count would
    // read the whole node map of every version to answer a yes/no question.
    const existing = await versionsRef.select().limit(1).get()
    if (!existing.empty && !checkEntitlement(org, 'versioning')) {
      return Response.json(
        {
          error:
            'Version history requires a Pro plan — see Billing to upgrade',
        },
        { status: 403 },
      )
    }

    let payload: Record<string, unknown>
    if (sourceVersionId) {
      const source = await versionsRef.doc(sourceVersionId).get()
      if (!source.exists) {
        return Response.json({ error: 'Source version missing' }, { status: 404 })
      }
      // The snapshot is the STORED document, and ONLY the stored document.
      // The caller gets to name it and nothing else: spreading `data` over the
      // copy would let a client send its own `nodes` and have arbitrary
      // content written under the label of a copy of something else.
      const label = (data as Record<string, unknown> | undefined)?.[
        'displayName'
      ]
      payload = {
        ...(source.data() as Record<string, unknown>),
        ...(typeof label === 'string' ? { displayName: label.slice(0, 200) } : {}),
      }
    } else {
      // Allow-listed, like the snapshot branch above already was in spirit:
      // there, the caller gets to name the copy and nothing else. Here it
      // gets the seed's declared keys and nothing else (AGL-1377).
      payload = {}
      for (const [key, value] of Object.entries(
        data as Record<string, unknown>,
      )) {
        if (VERSION_KEYS.has(key) && value !== undefined) payload[key] = value
      }
    }

    const id =
      typeof body?.id === 'string' && body.id
        ? String(body.id).slice(0, 64)
        : createResourceUid()
    await versionsRef.doc(id).create({
      ...payload,
      // Stamped server-side, like every other create route: a client clock is
      // not a fact about when the version was made.
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    return Response.json({ ok: true, id }, { status: 200 })
  } catch (error: any) {
    if (error?.code === 6 /* ALREADY_EXISTS */) {
      return Response.json({ error: 'That id already exists' }, { status: 409 })
    }
    console.error(error)
    return Response.json({ error: 'Create failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
