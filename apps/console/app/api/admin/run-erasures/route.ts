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
import type { AglynOrgBilling } from '@aglyn/aglyn/server'
import { resolveBrandingProfile } from '@aglyn/aglyn/server'
import { isCronAuthorized } from '../../../../utils/cron-auth'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { renderSystemEmail } from '../../_lib/render-system-email'
import {
  ERASURE_HOLD_MS,
  eraseOrg,
  findUserByUidAcrossPools,
  firebaseAdmin,
} from '@aglyn/tenant-data-admin'

/**
 * Executes due GDPR erasures (AGL-487) — completes the self-serve deletion
 * loop so no manual staff step is required. Scheduler-invoked with the
 * shared `x-cron-secret`, like report-usage / usage-alerts / audit-archive.
 *
 * Finds orgs whose `erasureRequestedAt` is past the 7-day hold and erases
 * each via `eraseOrg` (which re-verifies the hold and writes a final export
 * to Storage before deleting anything). Batched small — irreversible work,
 * so a bounded number per run and eraseOrg is safe to re-run on the rest.
 */
const MAX_PER_RUN = 5

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return Response.json({ error: 'Erasure runner is not configured (CRON_SECRET).' }, { status: 501 })
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const holdCutoff = new Date(Date.now() - ERASURE_HOLD_MS)
    const due = await firestore
      .collection('orgs')
      .where('erasureRequestedAt', '<', holdCutoff)
      .limit(MAX_PER_RUN)
      .get()

    const auth = firebaseAdmin.app().auth()
    const emailConfigured = isEmailConfigured()
    const erased: string[] = []
    const skipped: Array<{ orgId: string; reason?: string }> = []
    for (const org of due.docs) {
      // Capture before erasing — eraseOrg deletes the org document, but the
      // owner's auth account survives it, so the address stays reachable.
      const orgName = org.get('name') ?? 'your organization'
      // White-label brand (White-Label Phase 3): resolved BEFORE eraseOrg
      // deletes the doc, so the completion notice still reads as the org's
      // brand. One shared resolver, same as every other surface.
      const branding = resolveBrandingProfile(
        org.data() as Partial<AglynOrgBilling>,
      )
      const ownerUid = String(org.get('ownerUid') ?? '')
      // Across pools (AGL-1122) — an SSO owner is invisible to project-level
      // `getUser`, so the "your workspace has been erased" notice never went
      // out for exactly the orgs on the plan that has SSO.
      const ownerEmail =
        emailConfigured && ownerUid
          ? await findUserByUidAcrossPools(ownerUid)
              .then((found) => found?.record.email)
              .catch(() => undefined)
          : undefined

      const result = await eraseOrg(org.id)
      if (!result.ok) {
        skipped.push({ orgId: org.id, reason: result.skippedReason })
        continue
      }
      erased.push(org.id)

      // Confirm completion to the owner (AGL-768). Best-effort and wrapped so
      // a send problem never affects the erasure result.
      if (ownerEmail) {
        try {
          const fallbackText =
            `${orgName} and all of its data have been permanently erased ` +
            `from ${branding.productName}, as requested. This is complete and ` +
            'cannot be undone.'
          const designed = await renderSystemEmail('erasure-confirmation', {
            'org.name': String(orgName),
          })
          await sendEmail({
            to: ownerEmail,
            subject: designed?.subject ?? 'Your Aglyn data has been erased',
            text: designed?.text || fallbackText,
            ...(designed?.html ? { html: designed.html } : {}),
            fromName: branding.fromName,
            context: 'erasure-confirmation',
          })
        } catch (confirmError) {
          console.error('erasure-confirmation email skipped', confirmError)
        }
      }
    }

    return Response.json({ erased, skipped, scanned: due.size }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Erasure run failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }

/**
 * Cron routes run long: this one sweeps every org (AGL-1141).
 *
 * Vercel Hobby defaults a function to 10s, and nothing here set a duration —
 * so `report-usage` 504d with FUNCTION_INVOCATION_TIMEOUT at 10.2s on
 * 2026-07-31 having succeeded the day before. A pass sitting right on the
 * boundary fails intermittently, which reads as flaky rather than as a limit.
 */
export const maxDuration = 60
