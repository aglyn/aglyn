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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import {
  isUsageLevel,
  readUsageLevel,
  USAGE_LEVEL_AT_FIELD,
  USAGE_LEVEL_BY_FIELD,
  USAGE_LEVEL_COLLECTIONS,
  USAGE_LEVEL_FIELD,
  USAGE_LEVEL_TARGETS,
  USAGE_LEVELS,
  type UsageLevel,
  type UsageLevelTarget,
} from '@aglyn/aglyn/app-utils/usage-level'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * The staff usage level (AGL-4228): how much an account, a workspace or a
 * site actually uses the platform, as a member of staff judged it.
 *
 * `POST { target: 'user' | 'org' | 'site', id, level, also?: ('org' | 'owner')[] }`
 * → `{ ok, set: [{ target, id, level, before }] }`.
 *
 * A site's level may carry to its workspace (`also: ['org']`) and to that
 * workspace's owner (`also: ['owner']`) in the same request, because a site
 * somebody is running their business on says the same of its workspace and
 * of the person behind it; and a workspace's to its owner. Each one is its
 * own write and its own audit row, and a carry never lowers a level that is
 * already higher: marking a site Building does not demote a Power user.
 *
 * Staff only, plain `staff` rather than `super`: it is a note on the
 * customer, not a change to what they get. The rules deny the three keys to
 * every client write, so this route — Admin SDK — is the one writer.
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

  const target = String(body?.target ?? '') as UsageLevelTarget
  const id = String(body?.id ?? '').trim()
  const level = body?.level
  const also = Array.isArray(body?.also) ? (body.also as unknown[]).map(String) : []
  if (!(USAGE_LEVEL_TARGETS as readonly string[]).includes(target)) {
    return Response.json({ error: 'Unknown target' }, { status: 400 })
  }
  // A document id never holds a slash; one that did would address another
  // collection.
  if (!id || id.includes('/')) {
    return Response.json({ error: 'Missing id' }, { status: 400 })
  }
  if (!isUsageLevel(level)) {
    return Response.json({ error: 'Unknown usage level' }, { status: 400 })
  }

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    // A staff member signed in AS a customer is that customer for the
    // length of the session; the level is staff's word, not theirs.
    if (!decoded['staff'] || isImpersonationSession(decoded)) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const db = app.firestore()
    const ref = (kind: UsageLevelTarget, docId: string) =>
      db.collection(USAGE_LEVEL_COLLECTIONS[kind]).doc(docId)

    const primary = await ref(target, id).get()
    // An account may have no `users/{uid}` document yet; the level is still
    // staff's to record, so only a workspace or site must exist.
    if (!primary.exists && target !== 'user') {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    /*
     * The carries. A site's workspace is its `orgId`; a workspace's owner is
     * its `ownerUid`. Each is read before anything is written, so a missing
     * workspace refuses the whole request rather than half of it.
     */
    const writes: Array<{ kind: UsageLevelTarget; docId: string; carried: boolean }> = [
      { kind: target, docId: id, carried: false },
    ]
    let orgSnap: FirebaseFirestore.DocumentSnapshot | null = null
    if (target === 'site' && (also.includes('org') || also.includes('owner'))) {
      const orgId = String(primary.get('orgId') ?? '')
      if (orgId) orgSnap = await ref('org', orgId).get()
      if (also.includes('org') && orgSnap?.exists) {
        writes.push({ kind: 'org', docId: orgSnap.id, carried: true })
      }
    }
    if (target === 'org') orgSnap = primary
    if (also.includes('owner') && target !== 'user') {
      const ownerUid = String(orgSnap?.get('ownerUid') ?? '')
      if (ownerUid && !ownerUid.includes('/')) {
        writes.push({ kind: 'user', docId: ownerUid, carried: true })
      }
    }

    const set: Array<{
      target: UsageLevelTarget
      id: string
      level: UsageLevel
      before: UsageLevel
    }> = []
    for (const write of writes) {
      const snap =
        write.kind === target && write.docId === id
          ? primary
          : write.kind === 'org' && orgSnap?.id === write.docId
            ? orgSnap
            : await ref(write.kind, write.docId).get()
      const before = readUsageLevel(snap.get(USAGE_LEVEL_FIELD))
      /*
       * A carry raises, never lowers: the order of `USAGE_LEVELS` is least
       * use first, and a level somebody set on the workspace or the person
       * from a closer look is not overwritten by a site's. The level asked
       * for on the thing itself is always written — that is the correction.
       */
      if (write.carried && rank(before) >= rank(level)) continue
      await snap.ref.set(
        {
          [USAGE_LEVEL_FIELD]: level,
          [USAGE_LEVEL_AT_FIELD]: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          [USAGE_LEVEL_BY_FIELD]: decoded.uid,
        },
        { merge: true },
      )
      await addAdminAudit(db, {
        actorUid: decoded.uid,
        action: `${AUDIT_PREFIX[write.kind]}.usageLevel`,
        target: `${USAGE_LEVEL_COLLECTIONS[write.kind]}/${write.docId}`,
        before: { [USAGE_LEVEL_FIELD]: before },
        after: {
          [USAGE_LEVEL_FIELD]: level,
          ...(write.carried ? { carriedFrom: `${USAGE_LEVEL_COLLECTIONS[target]}/${id}` } : {}),
        },
        at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => undefined)
      set.push({ target: write.kind, id: write.docId, level, before })
    }
    return Response.json({ ok: true, set }, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Usage level request failed' }, { status: 500 })
  }
}

/** The audit action's first segment, as the activity labels file them. */
const AUDIT_PREFIX: Readonly<Record<UsageLevelTarget, string>> = {
  user: 'user',
  org: 'org',
  site: 'host',
}

const rank = (level: UsageLevel) => USAGE_LEVELS.indexOf(level)

export const dynamic = 'force-dynamic'
export { handler as POST }
