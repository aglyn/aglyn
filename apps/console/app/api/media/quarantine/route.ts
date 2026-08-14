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

/**
 * "Why did this image stop loading?" — the OWNER's answer (AGL-1612).
 *
 * AGL-1512 shipped the enforcement core and `mediaQuarantineNotice()`, the
 * customer-facing copy, and then nothing called it from a UI. A workspace
 * whose asset was taken down saw an image that had simply stopped rendering,
 * with no state in the DAM and no notice anywhere. AGL-1613 closed the case
 * where they try to upload it again; this closes the passive one, which is
 * the one they actually hit first.
 *
 * ## Why this route exists rather than a client read
 *
 * `mediaQuarantines` is Admin-SDK-only and has no Firestore rules block — a
 * deliberate AGL-1512 call that keeps the feature at zero rules-deploy debt,
 * since the default deny is already exactly the right posture. Reading it
 * from the browser would mean a rules deploy, which is a debt class of its
 * own. So the console asks a route, and this is it.
 *
 * ## Why it takes MEDIA IDS and not digests
 *
 * The client already holds every asset's `contentHash` and `contentSha256`,
 * so a route that accepted digests would be a line of code shorter. It would
 * also be an ORACLE: any authenticated user could probe arbitrary hashes and
 * learn what the platform has taken down anywhere, which is precisely the
 * fact the CDN's neutral 410 exists to withhold. Keys are therefore derived
 * server-side from documents the caller is scoped to, and the answer can only
 * ever concern assets they can already see.
 *
 * ## What it costs
 *
 * Nothing, essentially always. The deny list is empty on a healthy platform,
 * so the handler asks {@link hasMediaQuarantines} first — one already-cached
 * read — and returns an empty answer having touched no media document at
 * all. Only when something IS quarantined does it pay a read per requested
 * id, bounded by {@link MAX_PROBE_IDS}.
 *
 * The response carries the notice and the reason and nothing else. The staff
 * `note` — a DMCA notice number, a complainant, an internal assessment —
 * cannot reach it: `normalizeMediaQuarantine` drops the field before a state
 * exists, and the body is built from that state.
 */

import { mediaQuarantineNotice, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getMediaQuarantine,
  hasMediaQuarantines,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { resolveMediaScope, scopeAllows } from '../../../../utils/server/media-scope'

/**
 * How many assets one call may ask about.
 *
 * A DAM page is 50 tiles and a picker grid is smaller, so this is roomy. It
 * is a bound rather than a limit worth tuning: the reads behind it only
 * happen when the deny list is non-empty, and an unbounded list on a route
 * that reads a document per entry is a denial-of-service with extra steps.
 */
export const MAX_PROBE_IDS = 100

async function handler(request: Request): Promise<Response> {
  const {
    method,
    query,
    body,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  // POST, not GET: the payload is a list of ids, and a GET carrying a body
  // throws silently in this stack. Nothing here mutates.
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    // lockdown-423: via apps/console/utils/server/media-scope.ts — the scope
    // resolver runs the verdict on the org/host docs it already reads and
    // hands the 423 refusal back as `error.response`.
    //
    // No `feature` gate, though: this is a READ, and it is the read that
    // explains why something is refused. Withholding the explanation during a
    // platform-wide uploads pause would be the wrong way round.
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

    const requested = Array.isArray(body?.['mediaIds'])
      ? (body['mediaIds'] as unknown[])
          .map((value) => String(value ?? '').trim())
          .filter(Boolean)
          .slice(0, MAX_PROBE_IDS)
      : []
    if (!requested.length) {
      return Response.json(
        { quarantined: {}, readAtMs: Date.now() },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    // The whole point of the pre-check — see the module header. An empty
    // deny list answers without reading a single media document.
    if (!(await hasMediaQuarantines())) {
      return Response.json(
        { quarantined: {}, readAtMs: Date.now() },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const quarantined: Record<
      string,
      { reason: string; title: string; body: string; contact: string | null }
    > = {}
    await Promise.all(
      requested.map(async (mediaId) => {
        const snapshot = await scope.scopeRef
          .collection('media')
          .doc(mediaId)
          .get()
        if (!snapshot.exists || snapshot.get('deletedAt')) return
        // The same visibility rule every other media route applies
        // (AGL-1043). An asset the caller cannot see is one they get no
        // answer about — not even the answer "it is disabled", which would
        // confirm the asset exists.
        if (!scopeAllows(scope, snapshot.get('visibleTo'))) return
        const state = await getMediaQuarantine({
          contentSha256: snapshot.get('contentSha256'),
          contentHash: snapshot.get('contentHash'),
          scopeSegment: scope.cdnScope,
          mediaId,
        })
        if (!state) return
        const notice = mediaQuarantineNotice(state)
        quarantined[mediaId] = {
          reason: state.reason,
          title: notice.title,
          body: notice.body,
          contact: notice.contact ?? null,
        }
      }),
    )

    return Response.json(
      { quarantined, readAtMs: Date.now() },
      // A takedown is reversible and lifts within seconds; a cached answer
      // would keep telling a customer their restored file is disabled.
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[media/quarantine] failed', error)
    return Response.json({ error: 'Could not read file state' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
