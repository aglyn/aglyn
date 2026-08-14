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
  restoreMediaFromTombstone,
} from '@aglyn/tenant-data-admin'
import { resolveMediaScope } from '../../../../utils/server/media-scope'

/**
 * Put back a media asset the caller just deleted (AGL-1467).
 *
 * The consuming end of the tombstone `/api/media/upload`'s DELETE branch
 * writes. It restores the storage object by generation, every CDN variant, the
 * Firestore document verbatim and both counters — see
 * `libs/tenant/data/admin/src/lib/server/media-tombstone.ts` for the ordering
 * argument and the atomicity guarantee.
 *
 * ## Why this is a route and not a "Recently deleted" screen
 *
 * The affordance chosen for this issue is the snackbar's **Undo**, and only
 * that. The alternative — a browsable recently-deleted view over the
 * tombstones — was rejected for two reasons, in this order:
 *
 *  1. **It would be a second readable copy of customer content.** A tombstone
 *     holds a media document verbatim: file name, alt text, description, tags,
 *     custom metadata, the `visibleTo` tokens that decide who could see the
 *     asset. Today nothing lists them and no client rule grants a read, so
 *     they are server-only records with exactly one consumer. A view means a
 *     read path, rules to scope it, and a surface where deleted customer
 *     assets are browsable — the shape AGL-1443 is open on, volunteered.
 *  2. **It is not the shape of the mistake.** What happened on 2026-08-13 was
 *     a fast repetitive pass in which two wrong files went by unnoticed. The
 *     recovery that matches it is the one attached to the message that says
 *     what just went, at the moment it says it.
 *
 * The seven-day tombstone is therefore NOT a seven-day promise in the UI; it
 * is the window in which this endpoint keeps working, which is what makes a
 * later support-assisted restore possible at all. The copy says nothing about
 * a duration on purpose (`media-delete-copy.ts`).
 *
 * ## Authorization
 *
 * `resolveMediaScope`, identically to the delete — this is the same capability
 * pointed the other way, and it writes a document into a library. Host
 * `memberRoles` admin/editor, or an org roster role above viewer.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
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
    // lockdown-423: via apps/console/utils/server/media-scope.ts — the scope
    // resolver runs the verdict on the org/host docs it already reads and
    // hands the 423 refusal back as `error.response`.
    const { scope, error } = await resolveMediaScope(body, query, decoded.uid, {
      staff: decoded['staff'] === true,
    })
    if (!scope) {
      return (
        error?.response ??
        Response.json(
          { error: error?.message ?? 'Bad request' },
          { status: error?.status ?? 400 },
        )
      )
    }
    const mediaId = String(body?.['mediaId'] ?? '')
    if (!mediaId) {
      return Response.json({ error: 'Missing mediaId' }, { status: 400 })
    }

    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)

    const result = await restoreMediaFromTombstone({
      scopeRef: scope.scopeRef,
      bucket,
      mediaId,
      billing: scope.billing,
    })

    // The refusals this can answer with are things only the server knows —
    // the window closed, or the bytes would breach the plan — and each one
    // carries a sentence the author can act on. Collapsing them into a status
    // is how "Undo failed" ends up on screen with no way to find out why.
    return Response.json(
      result.ok
        ? { restored: true, message: result.message, fileName: result.fileName }
        : { error: result.message },
      { status: result.status },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Restore failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
