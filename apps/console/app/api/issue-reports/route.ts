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

import { BUILD_ID, PACKAGE_VERSION } from '@aglyn/shared-data-enums'
import {
  consumeRateLimit,
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForUser,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { summarizeUserAgent } from '../_lib/security-alerts'
import {
  buildReportBody,
  createLinearIssue,
  isReportKind,
  linearConfigFromEnv,
  MAX_DESCRIPTION,
  reportTitle,
} from '../_lib/linear-issues'

// lockdown-423: exempt — the same reasoning as support (AGL-1506): a member of a locked
// org must still be able to tell us something is broken, and the bug they hit may be the
// reason they are locked. This writes nothing into the org's own subtree — it files into
// Aglyn's tracker — so the verdict has no org-scoped write to refuse, and refusing the
// report would only cost us the report.

/**
 * Customer issue reports (AGL-2185) → Linear team `CUS`.
 *
 * Zach asked for an issue-reporting tool in the console, "tracked in linear …
 * but a new linear team and not our primary one". Support tickets already
 * exist but start on Pro, so a Free or Starter org that hits a bug has no
 * channel at all — and a ticket is a support conversation, not a tracked
 * defect. This is the defect channel, open to every signed-in member.
 *
 * ## Why the reports do not go to `AGL`
 *
 * `AGL`'s open count is the Sept-1 release signal. An unbounded inbound
 * stream lands in `CUS` instead; triage promotes a genuinely release-blocking
 * report into `AGL` by hand. That separation is enforced by configuration
 * (`LINEAR_CUSTOMER_REPORTS_TEAM_ID`), not by a convention someone has to
 * remember.
 *
 * ## Refusal order, and why it is not the Assist order
 *
 * `405 → 401 → 429 → 501 → 400`. The Assist route answers 501 before 401,
 * which is fine for a feature whose availability is already public. Here the
 * order is deliberately inverted: an anonymous prober learns nothing about
 * whether this deployment has Linear credentials, and the rate limiter is
 * keyed on a *verified* uid rather than on anything the caller asserts.
 *
 * ## Trust boundary
 *
 * Only four values arrive from the client — `kind`, `summary`, `description`
 * and `route` (plus a viewport, coerced to integers). Everything else the
 * issue records is derived server-side: the reporter from the verified token,
 * the org from the membership read, the host and user-agent from request
 * headers, the version and build id from this build's own constants. That is
 * the point — a report a customer can forge is a report a triager cannot
 * trust. `../_lib/linear-issues` escapes what remains.
 */

/** One report per member per minute, 20 an hour — durable, cross-instance. */
const PER_MINUTE = 2
const PER_HOUR = 20

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const app = firebaseAdmin.app()
    let decoded: Awaited<ReturnType<ReturnType<typeof app.auth>['verifyIdToken']>>
    try {
      decoded = await app.auth().verifyIdToken(idToken)
    } catch {
      return Response.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }

    // Authenticated, so the limiter can key on a uid nobody can spoof. An
    // unauthenticated, unlimited filing endpoint is a spam relay straight
    // into our tracker; both windows must pass, so a burst cannot be spread
    // out into a steady drip that still floods triage.
    for (const [window, limit, ms] of [
      ['minute', PER_MINUTE, 60_000],
      ['hour', PER_HOUR, 60 * 60_000],
    ] as const) {
      const limited = await consumeRateLimit(
        `issue-report-${window}:${decoded.uid}`,
        { limit, windowMs: ms },
      )
      if (!limited.allowed) {
        return Response.json(
          { error: 'You have filed several reports just now — try again shortly.' },
          { status: 429 },
        )
      }
    }

    // Degrades cleanly rather than pretending: a self-host operator has no
    // Aglyn Linear workspace, and their reports must never be pointed at ours.
    const config = linearConfigFromEnv()
    if (!config) {
      return Response.json(
        {
          error:
            'Issue reporting is not configured on this deployment ' +
            '(LINEAR_API_KEY, LINEAR_CUSTOMER_REPORTS_TEAM_ID).',
        },
        { status: 501 },
      )
    }

    const payload = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    const kind = payload?.['kind']
    const summary = String(payload?.['summary'] ?? '').trim()
    const description = String(payload?.['description'] ?? '').trim()
    if (!isReportKind(kind)) {
      return Response.json(
        { error: 'Pick what kind of report this is.' },
        { status: 400 },
      )
    }
    if (!summary || !description) {
      return Response.json(
        { error: 'Add a short summary and a description.' },
        { status: 400 },
      )
    }

    const resolved = await getOrgForUser(
      decoded.uid,
      String(payload?.['orgId'] ?? '') || null,
    )
    const userAgent = request.headers.get('user-agent')

    const title = reportTitle(kind, summary)
    const body = buildReportBody(description.slice(0, MAX_DESCRIPTION), {
      kind,
      route: payload?.['route'],
      viewportWidth: payload?.['viewportWidth'],
      viewportHeight: payload?.['viewportHeight'],
      browser: summarizeUserAgent(userAgent),
      userAgent,
      host: request.headers.get('host'),
      reporterUid: decoded.uid,
      reporterEmail: decoded.email ?? null,
      orgId: resolved?.orgId ?? null,
      orgName: resolved?.org?.name ?? null,
      orgPlan: (resolved?.org?.plan as string | undefined) ?? null,
      version: PACKAGE_VERSION,
      buildId: BUILD_ID,
      contactConsent: payload?.['contactConsent'] === true,
      filedAt: new Date().toISOString(),
    })

    const created = await createLinearIssue({ config, title, description: body })
    if (!created.ok) {
      // Never 200 on a report that was not filed. The reporter still has
      // their text in the open dialog, which is the whole reason this says
      // so plainly instead of closing on a false success.
      console.error('[issue-reports] Linear filing failed', created.reason)
      return Response.json(
        { error: 'We could not file that report just now. Please try again.' },
        { status: 502 },
      )
    }

    // The Linear URL is deliberately NOT returned: it is an internal tracker
    // link a customer cannot open, and handing it back only invites them to
    // try. The identifier is enough to quote back to support.
    return Response.json({ ok: true, reference: created.identifier }, { status: 200 })
  } catch (error) {
    console.error('[issue-reports] failed', error)
    return Response.json({ error: 'Filing that report failed.' }, { status: 500 })
  }
}
