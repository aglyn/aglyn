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
import { operatorIdentity } from '@aglyn/aglyn/app-utils/operator-identity'
import {
  accountBannedRecipients,
  firebaseAdmin,
  getServerReleaseFlagValues,
  listUsersAcrossPools,
} from '@aglyn/tenant-data-admin'
import {
  AD_AUDIENCE_PROVIDER_LABELS,
  AD_AUDIENCE_STAGE_LABELS,
  emailDomain,
  readAdAudienceConfig,
  type AdAudienceProvider,
  type AdAudienceStage,
} from '@aglyn/tenant-data-admin/server/ad-audience-sync'
import {
  readAdAudienceAccounts,
  runAdAudienceSync,
  type AudienceFetch,
} from '@aglyn/tenant-data-admin/server/ad-audience-sync-run'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import { raiseConsoleOperatorAlert } from '../../../../utils/server/raise-operator-alert'

// lockdown-423: exempt — a platform cron; it changes no org.

/**
 * THE ACCOUNT-HOLDER AD AUDIENCE, NIGHTLY (AGL-3780).
 *
 * Keeps a customer-list audience of the operator's own United States account
 * holders in step on the operator's own Meta, Google and LinkedIn ad
 * accounts, as SHA-256 hashes of their addresses. The rules — who is
 * eligible, how each provider normalizes, the diff and each request — are in
 * `tenant-data-admin`'s `ad-audience-sync`; this route reads the flag, the
 * caller and the accounts, and runs it.
 *
 * - A GET, or `?dryRun=1` on a POST, reports per provider how many accounts
 *   are eligible and how many hashes would be added and removed, and sends
 *   nothing. A staff ID token may read that report but never send.
 * - The scheduled POST sends only while `release_ad_audience_sync` is on,
 *   and each provider only when its variables are set. Off, the report says
 *   `flag-off` and nothing leaves.
 * - `?force=1` on the scheduled POST sends a set that shrank by more than
 *   half, which a run otherwise holds as a likely failed read.
 * - The report and the log carry counts only: no address, no hash.
 * - Beside each provider's all-holders list, the report carries every STAGE
 *   (AGL-4072) — free and not published, free and published, paid, lapsed —
 *   with its eligible count whether or not its lists are configured, and
 *   each configured stage list's own outcome.
 */

export const AD_AUDIENCE_SYNC_JOB_ID = 'ad-audience-sync'
const AD_AUDIENCE_SYNC_RELEASE_FLAG = 'release_ad_audience_sync' as const

/** True for a verified staff ID token, else the refusal to return. */
async function isStaffCaller(
  headers: Partial<Record<string, string>>,
): Promise<true | Response> {
  const authorization = headers.authorization ?? ''
  if (!authorization.startsWith('Bearer ')) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  try {
    const decoded = await firebaseAdmin
      .app()
      .auth()
      .verifyIdToken(authorization.slice('Bearer '.length))
    if (!decoded.email_verified || !decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    return true
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    throw error
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, body, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  // The scheduler sends; a staff member may only READ the counts. This route
  // walks every account, so anything else is refused.
  const cron = isCronAuthorized(headers)
  if (!cron) {
    const staff = await isStaffCaller(headers)
    if (staff !== true) return staff
  }
  const params = query as Record<string, string | string[] | undefined>
  const dryRun = !cron || isCronDryRun({ method, body, query: params })
  const force = cron && !dryRun && (params['force'] === '1' || params['force'] === 'true')
  if (cron && method === 'POST') await recordCronBeat(AD_AUDIENCE_SYNC_JOB_ID)

  const now = Date.now()
  const firestore = firebaseAdmin.app().firestore()
  try {
    const flags = await getServerReleaseFlagValues()
    const flagOn = flags[AD_AUDIENCE_SYNC_RELEASE_FLAG]?.enabled === true
    // Off and not a dry run: nothing would be sent, so nothing is read.
    if (!dryRun && !flagOn) {
      console.info('[ad-audience-sync] release_ad_audience_sync is off; nothing sent')
      return Response.json({ ok: true, dryRun, flagOn, skipped: 'flag-off' }, { status: 200 })
    }
    const operatorDomain = emailDomain(operatorIdentity().supportEmail)
    const internalDomains = operatorDomain ? [operatorDomain] : []
    const { accounts } = await readAdAudienceAccounts({
      firestore,
      listUserPage: listUsersAcrossPools,
      bannedEmails: (emails) => accountBannedRecipients(emails, firestore),
      now,
      internalDomains,
    })
    const report = await runAdAudienceSync({
      dryRun,
      flagOn,
      force,
      config: readAdAudienceConfig(),
      internalDomains,
      accounts,
      firestore,
      fetch: fetch as unknown as AudienceFetch,
      now,
    })
    const lists = [
      ...Object.entries(report.providers).map(([provider, result]) => ({
        provider: provider as AdAudienceProvider,
        stage: null as AdAudienceStage | null,
        result,
      })),
      ...Object.entries(report.stages ?? {}).flatMap(([stage, stageReport]) =>
        Object.entries(stageReport.providers).map(([provider, result]) => ({
          provider: provider as AdAudienceProvider,
          stage: stage as AdAudienceStage,
          result,
        })),
      ),
    ]
    for (const { provider, stage, result } of lists) {
      if (result.outcome !== 'failed' && result.outcome !== 'held-shrink') continue
      const label = AD_AUDIENCE_PROVIDER_LABELS[provider]
      await raiseConsoleOperatorAlert('ops.adAudienceSyncFailed', {
        dedupeKey: stage ? `ad-audience-sync:${provider}:${stage}` : `ad-audience-sync:${provider}`,
        context: {
          provider: stage ? `${label} (${AD_AUDIENCE_STAGE_LABELS[stage]} list)` : label,
          detail: result.error ?? result.outcome,
        },
      })
    }
    return Response.json({ ok: true, ...report }, { status: 200 })
  } catch (error) {
    console.error('[ad-audience-sync] sweep failed', error)
    if (!dryRun) {
      await raiseConsoleOperatorAlert('ops.adAudienceSyncFailed', {
        dedupeKey: 'ad-audience-sync:read',
        context: {
          provider: 'Every provider',
          detail: 'the accounts could not be read, so nothing was sent',
        },
      })
    }
    return Response.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export { handler as GET, handler as POST }
