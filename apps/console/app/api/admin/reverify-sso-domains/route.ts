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
 * Does every live SSO domain still prove it belongs to the org routing it?
 * (AGL-1210 — the residual the 2026-08-23 audit named.)
 *
 * A domain is proven ONCE, when an admin presses Verify, and then routes that
 * domain's sign-ins forever. A company that lets its domain lapse — or sells
 * it — keeps the routing until a human revokes it. That is an account-takeover
 * shape in slow motion, and it is the last gap in an otherwise strong proof.
 *
 * ## It REPORTS. It does not revoke, and it does not touch `verified`.
 *
 * The obvious fix is worse than the bug. `resolveChallengeTxt` cannot tell
 * "the record is gone" from "the resolver did not answer" — both are an empty
 * array — so a resolver blip during this sweep looks exactly like every
 * customer deleting their TXT record at the same instant. An automated revoke
 * on that signal logs out every enterprise on the platform at once, which is a
 * far worse outage than the risk being closed. Same shape as
 * `reverify-plugin-versions` next door ("a lint that can stop a plugin in
 * every workspace is a kill switch with no human in it"), and the same
 * direction lockdown chose when it decided an unreachable Firestore is an
 * outage rather than a verdict.
 *
 * So: `probeChallengeTxt` adds a third state, `unreachable`, which is counted
 * as nothing in either direction; `assessDomainDrift` needs three consecutive
 * CONCLUSIVE failures spanning at least fourteen days before it will even say
 * the word "drifted"; and the loudest thing that then happens is an email.
 * Revocation stays `revokeDomain`, an explicit act by a person.
 *
 * ## What it deliberately does NOT write
 *
 * `verified` is owned by `verifyDomainClaim`, the admin-clicked path. This
 * route never writes it, and that is load-bearing rather than tidy:
 * `publishSsoDomains` re-reads `verified` and skips a claim that is false, so
 * a sweep that flipped it during a DNS outage would silently un-route every
 * domain on the platform's next publish — the automated lockout by the back
 * door. The drift bookkeeping lives in its own `drift*` fields.
 *
 * ## Cost and scope
 *
 * Reads the top-level `ssoDomains` collection — one document per live routing
 * domain, single digits today — and filters `active` in memory rather than in
 * the query, so it needs no index and cannot be broken by one being missing.
 * Only DNS-proven claims are probed: a staff-attested domain (AGL-1887) never
 * had a challenge record, so re-checking one would report a failure every week
 * forever, which is how a board gets ignored.
 */
import {
  assessDomainDrift,
  challengeValue,
  firebaseAdmin,
  isStaffAttestedClaim,
  notifyOrgAdmins,
  notifyStaff,
  probeChallengeTxt,
  SSO_CHALLENGE_PREFIX,
  SSO_DRIFT_FAILURES_BEFORE_REPORT,
  SSO_DRIFT_MIN_AGE_MS,
} from '@aglyn/tenant-data-admin'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { FieldValue } from 'firebase-admin/firestore'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import {
  consoleOrigin,
  emailFailureReason,
  emailOrgAdmins,
  emailStaffAlert,
} from '../../_lib/usage-alert-email'
import {
  driftOrgEmailText,
  driftStaffAlertText,
  summariseSsoDrift,
  type SsoDomainDriftEntry,
} from '../../../../utils/server/sso-domain-drift'

/** A ceiling on time and DNS traffic, not on truth. */
const MAX_DOMAINS = 500

const DAY_MS = 24 * 60 * 60_000

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query, body } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'Re-verification is not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  // AGL-1955 — the mark `/api/health/crons` reads to notice this job going
  // AWAY. Stamped on the INVOCATION, not on the work: a sweep that finds every
  // domain healthy still proves the schedule is alive. Without it a job that
  // silently stopped being scheduled would leave a stale domain undetected AND
  // leave nothing saying the detector itself had died.
  if (method === 'POST') await recordCronBeat('reverify-sso-domains')

  // A GET reports and writes nothing — somebody's curl, or a staff member
  // checking. The scheduler POSTs, and the drift bookkeeping has to persist
  // between sweeps or the consecutive-failure count can never reach two.
  const dryRun = isCronDryRun({ method, query, body })

  try {
    const firestore = firebaseAdmin.app().firestore()
    const now = Date.now()

    const routing = await firestore.collection('ssoDomains').get()
    const live = routing.docs
      // Filtered in memory on purpose — see the docblock. `active` is set
      // false by `revokeDomain`/`unpublishSsoDomains`, and a deactivated
      // domain routes nothing, so there is nothing to re-verify.
      .filter((doc) => doc.get('active') === true)
      .slice(0, MAX_DOMAINS)

    const entries: SsoDomainDriftEntry[] = []

    for (const doc of live) {
      const domain = doc.id
      const orgId = String(doc.get('orgId') ?? '')
      if (!orgId) continue

      const claimRef = firestore
        .collection('orgs')
        .doc(orgId)
        .collection('ssoDomains')
        .doc(domain)
      const claim = await claimRef.get()

      // A live routing doc with no claim behind it. `publishSsoDomains` cannot
      // produce this, so it means something wrote routing another way or a
      // claim was deleted underneath it. Reported so a human looks; never
      // acted on here, because acting on a state we cannot explain is how a
      // detector becomes an outage.
      if (!claim.exists) {
        entries.push({
          orgId,
          domain,
          outcome: 'orphan-routing',
          consecutiveFailures: 0,
          daysFailing: null,
          records: [],
        })
        continue
      }

      const token = String(claim.get('token') ?? '')
      // Staff-attested and never DNS-proven (AGL-1887): there is no challenge
      // record, so probing would manufacture a weekly failure for a domain
      // nobody ever claimed had one.
      if (
        claim.get('verified') !== true ||
        !token ||
        isStaffAttestedClaim(claim.get('attestedBy'))
      ) {
        entries.push({
          orgId,
          domain,
          outcome: 'skipped-attested',
          consecutiveFailures: 0,
          daysFailing: null,
          records: [],
        })
        continue
      }

      const probe = await probeChallengeTxt(domain, token)
      const verdict = assessDomainDrift(
        probe,
        {
          consecutiveFailures: Number(claim.get('driftFailures')) || 0,
          firstFailureAtMs: Number(claim.get('driftFirstFailureAtMs')) || null,
        },
        now,
      )

      const daysFailing =
        verdict.firstFailureAtMs === null
          ? null
          : Math.floor((now - verdict.firstFailureAtMs) / DAY_MS)

      entries.push({
        orgId,
        domain,
        outcome:
          probe.status === 'unreachable'
            ? 'unreachable'
            : verdict.action === 'clear'
              ? 'proven'
              : verdict.action === 'report'
                ? 'drifted'
                : 'counting',
        consecutiveFailures: verdict.consecutiveFailures,
        daysFailing,
        records: probe.records,
      })

      // `hold` writes NOTHING. An outage must leave the bookkeeping exactly as
      // it found it — not even a `lastProbeAt`, which would make an unreachable
      // sweep look like a completed one on the claim document.
      if (dryRun || verdict.action === 'hold') continue

      await claimRef
        .set(
          {
            driftFailures: verdict.consecutiveFailures,
            driftFirstFailureAtMs: verdict.firstFailureAtMs,
            driftStatus: verdict.action === 'report' ? 'drifted' : 'ok',
            driftLastProbeAt: FieldValue.serverTimestamp(),
            // What we saw instead, for the card to render. Cleared on success
            // so a fixed domain does not keep showing its old wrong answer.
            driftLastRecords:
              verdict.action === 'clear' ? FieldValue.delete() : probe.records,
            ...(verdict.action === 'report'
              ? { driftReportedAt: FieldValue.serverTimestamp() }
              : {}),
          },
          // MERGE, and never a field named `verified`. See the docblock.
          { merge: true },
        )
        .catch(() => undefined)
    }

    const summary = summariseSsoDrift(entries)
    const origin = consoleOrigin()
    const orgEmails: Array<{ domain: string; sent: boolean; reason?: string }> =
      []

    if (!dryRun && summary.drifted.length) {
      for (const entry of summary.drifted) {
        const title = `Action needed: ${entry.domain} no longer proves domain ownership`
        const text = driftOrgEmailText(entry, origin)
        // Both channels, with one hoisted title/body — the console bell and
        // the mail must not disagree about what happened (AGL-2052).
        await notifyOrgAdmins(entry.orgId, {
          type: 'system.ssoDomainUnverified',
          title,
          body:
            `Single sign-on for ${entry.domain} still works and nothing has ` +
            `been turned off. Its DNS verification record is missing.`,
          orgId: entry.orgId,
          link: '/settings/sso',
        })
        const sent = await emailOrgAdmins({
          firestore,
          orgId: entry.orgId,
          subject: title,
          text,
          context: 'sso-domain-drift',
        })
        // A discarded send result is a bug (AGL-2234): "we notified them" is
        // the whole justification for not revoking, so whether the mail
        // actually left has to be in the response.
        orgEmails.push({
          domain: entry.domain,
          sent: sent.sent,
          ...(sent.sent ? {} : { reason: emailFailureReason(sent) }),
        })
      }

      const staffTitle = `${summary.drifted.length} SSO domain(s) no longer prove ownership`
      await notifyStaff({
        type: 'system.ssoDomainUnverified',
        title: staffTitle,
        body:
          `${summary.drifted[0].domain} and ${summary.drifted.length - 1} other(s). ` +
          `Routing is unchanged — revoking is a human decision.`,
        link: '/admin/orgs',
      })
      const staffMail = await emailStaffAlert({
        subject: staffTitle,
        text: driftStaffAlertText(summary, origin),
        context: 'sso-domain-drift',
      })

      await firestore
        .collection('adminAudit')
        .add({
          actorUid: 'system:cron',
          action: 'sso.domain.driftDetected',
          target: `sso-domains:${summary.drifted.length}`,
          after: {
            drifted: summary.drifted.map((entry) => ({
              orgId: entry.orgId,
              domain: entry.domain,
              consecutiveFailures: entry.consecutiveFailures,
              daysFailing: entry.daysFailing,
              records: entry.records,
            })),
            // Stated in the audit row too: this job revoked nothing. A future
            // reader finding a lockout near this timestamp should not have to
            // guess whether this was the cause.
            revoked: false,
            staffEmailed: staffMail.sent,
          },
          at: FieldValue.serverTimestamp(),
        })
        .catch(() => undefined)
    }

    return Response.json(
      {
        dryRun,
        // Stated in the response so nobody has to infer it from the absence
        // of a revocation: this endpoint has no code path that revokes.
        revokes: false,
        thresholds: {
          failuresBeforeReport: SSO_DRIFT_FAILURES_BEFORE_REPORT,
          minAgeDays: Math.round(SSO_DRIFT_MIN_AGE_MS / DAY_MS),
          challengeHost: `${SSO_CHALLENGE_PREFIX}.<domain>`,
          expectedValuePrefix: challengeValue(''),
        },
        ...summary,
        orgEmails,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json(
      { error: 'SSO domain re-verification failed' },
      { status: 500 },
    )
  }
}

export const GET = handler
export const POST = handler
export const dynamic = 'force-dynamic'

/**
 * One DNS lookup per live SSO domain, sequentially. Vercel defaults a function
 * to 10s and a sweep sitting on the boundary fails intermittently, which reads
 * as flaky rather than as a limit (the AGL-1141 lesson `report-usage` learned
 * the expensive way).
 */
export const maxDuration = 60
