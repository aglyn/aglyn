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
 * THE DAILY LINK RE-CHECK (AGL-3451).
 *
 * A credential harvester is often listed by Google Web Risk only after the
 * page linking to it went live, and a live page is not reviewed again until
 * somebody publishes it. This walks every live page's foreign hosts, a chunk
 * of sites per call (`{ "cursor": "…" }` resumes; `done` / `nextCursor` say
 * where it stopped), looks them up again, and sends each page with a newly
 * listed host back through the page review (`recheckLivePageLinks`). A page
 * it holds has its site's cached pages dropped, and a young workspace's
 * security hold is placed before the call returns (AGL-3450).
 *
 * A GET walks one chunk and reports what it would look up; it looks nothing
 * up and holds nothing.
 */

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller; it holds pages
// and places the platform's own locks, which no workspace lock may refuse.

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { recheckLivePageLinks } from '@aglyn/tenant-data-admin/server/link-reputation-review'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import { applyPendingSecurityHolds } from '../../../../utils/server/page-security-hold'
import { revalidateEntireHost } from '../../../../utils/server/tenant-revalidate'

/** The beat id `/api/health/crons` reads. */
export const WEB_RISK_RECHECK_JOB_ID = 'web-risk-recheck'

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'The link re-check is not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const dryRun = isCronDryRun({ method, body, query })
  if (method === 'POST') await recordCronBeat(WEB_RISK_RECHECK_JOB_ID)
  const rawCursor = (body as { cursor?: unknown } | null)?.cursor ?? query?.['cursor']
  const cursor = typeof rawCursor === 'string' && rawCursor ? rawCursor : null
  try {
    const firestore = firebaseAdmin.app().firestore()
    const chunk = await recheckLivePageLinks({ cursor, dryRun })
    if (dryRun) return Response.json({ dryRun: true, ...chunk })
    // A held page stops serving at its next render; drop what is cached so
    // that render is now.
    const revalidated = await Promise.all(
      chunk.heldHostIds.map((hostId) =>
        revalidateEntireHost(firestore, hostId).then(
          (result) => ({ hostId, reason: result.reason }),
          () => ({ hostId, reason: 'failed' }),
        ),
      ),
    )
    // A young workspace's page held here asks for a security hold; place it
    // now rather than on the next quarter-hour tick.
    const securityHolds = chunk.held ? await applyPendingSecurityHolds(firestore) : null
    return Response.json(
      {
        dryRun: false,
        ...chunk,
        revalidated,
        ...(securityHolds
          ? {
              securityHolds: {
                applied: securityHolds.applied,
                skipped: securityHolds.skipped,
                failed: securityHolds.failed,
              },
            }
          : {}),
      },
      { status: securityHolds?.failed ? 207 : 200 },
    )
  } catch (error) {
    console.error('[admin/web-risk-recheck] failed', error)
    return Response.json({ error: 'The link re-check failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
export const maxDuration = 300
