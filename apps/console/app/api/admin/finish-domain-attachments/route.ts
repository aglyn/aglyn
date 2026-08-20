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
  domainStateServes,
  firebaseAdmin,
  projectDomainStatus,
} from '@aglyn/tenant-data-admin'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import { upsertSubdomainRedirect } from '../../../../utils/server/subdomain-redirect'

/** Hosts examined per run — a ceiling on time and Vercel API calls. */
const MAX_HOSTS = 200

/**
 * Finishes custom domains that became healthy after their attach (AGL-2010).
 *
 * Attaching is not instantaneous and its slow steps are not ours: a
 * certificate issues over seconds to minutes, and an ownership challenge or a
 * DNS correction happens in the customer's registrar on their own clock. The
 * attach route records the shortfall as `cnameAttachmentPending` and, until
 * now, NOTHING ever cleared it. The flag is what `liveCustomDomain` reads to
 * decide whether visitors may be sent to the domain, so a domain that went
 * healthy five minutes later stayed dark until somebody happened to reopen the
 * site's setup page and press Re-attach. A customer who pointed their DNS
 * correctly and closed the tab never got their site.
 *
 * The same is true of `subdomainRedirectPending`: a best-effort edge-redirect
 * registration that failed had only a hand-run script
 * (`tools/scripts/backfill-subdomain-redirects.mjs`) behind it.
 *
 * This is the sweeper for both. It makes exactly the reads the attach route's
 * own status probe makes and completes what has become true — it never
 * attaches anything new, never claims a domain, and never writes a pending
 * flag ON. The worst a run can do is nothing.
 *
 * A GET is somebody's curl or a browser: it reports and writes nothing. The
 * cron POSTs. (The two irreversible cron routes that lack this guard are
 * AGL-2084 — this one is not going to become a third.)
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query, body } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'Domain completion is not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  // AGL-1955 — the mark `/api/health/crons` reads to notice this job going
  // AWAY. Stamped on the invocation, not on the work, so a run that finds
  // nothing to do still proves the schedule is alive; POST only, because a
  // human's GET is not the scheduler and must not stand in for it.
  if (method === 'POST') await recordCronBeat('finish-domain-attachments')
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_TENANT_PROJECT_ID
  const teamId = process.env.VERCEL_TEAM_ID
  if (!token || !projectId) {
    // The same 501 the attach route gives, for the same reason: on a
    // self-hosted deployment there is no Vercel API to ask, and the
    // app-level canonical redirect is the fallback there.
    return Response.json(
      {
        error:
          'Domain attachment is not configured (missing VERCEL_TOKEN / ' +
          'VERCEL_TENANT_PROJECT_ID).',
      },
      { status: 501 },
    )
  }

  const dryRun = isCronDryRun({ method, query, body })

  const firestore = firebaseAdmin.app().firestore()
  const completed: string[] = []
  const stillPending: string[] = []
  const redirectsRegistered: string[] = []
  let examined = 0

  try {
    const pending = await firestore
      .collection('hosts')
      .where('cnameAttachmentPending', '==', true)
      .limit(MAX_HOSTS)
      .get()

    for (const hostDoc of pending.docs) {
      examined += 1
      const domain = String(hostDoc.get('cname') ?? '').trim().toLowerCase()
      // A pending flag with no domain is a detach that raced the sweeper.
      // Nothing to probe and nothing to fix; leaving the flag ON is the safe
      // reading, because clearing it would tell `liveCustomDomain` to send
      // visitors to a domain the host no longer has.
      if (!domain) continue

      const status = await projectDomainStatus(domain, { projectId })
      // Deliberately the SAME predicate as the attach route, including
      // `certificate-pending` (AGL-1996). A sweeper that used a looser
      // definition of "serving" than the door it is completing for would
      // re-introduce the bug that door was fixed to avoid — and until
      // AGL-2011 that sameness was two hand-kept copies of four comparisons,
      // held by this comment. It is now literally one function.
      const serves = domainStateServes(status.state)
      if (!serves) {
        stillPending.push(domain)
        continue
      }
      completed.push(domain)
      if (dryRun) continue

      await hostDoc.ref
        .set(
          {
            cnameAttachmentPending:
              firebaseAdmin.firestore.FieldValue.delete(),
          },
          { merge: true },
        )
        .catch(() => undefined)

      const subdomain = String(hostDoc.get('subdomain') ?? '')
        .trim()
        .toLowerCase()
      if (!subdomain) continue
      const redirected = await upsertSubdomainRedirect({
        token,
        projectId,
        teamId,
        subdomain,
        target: domain,
      }).catch(() => false)
      if (redirected) redirectsRegistered.push(subdomain)
      await hostDoc.ref
        .set(
          redirected
            ? {
                subdomainRedirectPending:
                  firebaseAdmin.firestore.FieldValue.delete(),
              }
            : { subdomainRedirectPending: true },
          { merge: true },
        )
        .catch(() => undefined)
    }

    // Second arm: the domain is already live but its edge redirect never
    // registered, so the platform subdomain still serves a duplicate of the
    // site instead of redirecting. Same shape, different flag.
    const redirectPending = await firestore
      .collection('hosts')
      .where('subdomainRedirectPending', '==', true)
      .limit(MAX_HOSTS)
      .get()

    for (const hostDoc of redirectPending.docs) {
      // Anything still awaiting attachment was handled above (or is not ready
      // to redirect at all) — this arm is only for hosts that are live.
      if (hostDoc.get('cnameAttachmentPending') === true) continue
      examined += 1
      const domain = String(hostDoc.get('cname') ?? '').trim().toLowerCase()
      const subdomain = String(hostDoc.get('subdomain') ?? '')
        .trim()
        .toLowerCase()
      if (!domain || !subdomain) continue
      if (dryRun) {
        redirectsRegistered.push(subdomain)
        continue
      }
      const redirected = await upsertSubdomainRedirect({
        token,
        projectId,
        teamId,
        subdomain,
        target: domain,
      }).catch(() => false)
      if (!redirected) continue
      redirectsRegistered.push(subdomain)
      await hostDoc.ref
        .set(
          {
            subdomainRedirectPending:
              firebaseAdmin.firestore.FieldValue.delete(),
          },
          { merge: true },
        )
        .catch(() => undefined)
    }

    return Response.json(
      {
        ok: true,
        dryRun,
        examined,
        completed,
        stillPending,
        redirectsRegistered,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json(
      { error: 'Domain completion sweep failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
