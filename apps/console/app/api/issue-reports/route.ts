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

import { randomUUID } from 'node:crypto'
// The deep path, not the `@aglyn/aglyn` barrel: the barrel reaches
// `createContext` and is CLIENT-ONLY, which App Router forbids in a server
// graph — `nx build` would fail at promotion time, not here (AGL-1349).
import {
  RELEASE_FLAGS,
  isReleaseFlagOnForOrg,
} from '@aglyn/aglyn/app-utils/release-flags'
import { BUILD_ID, PACKAGE_VERSION } from '@aglyn/shared-data-enums'
import {
  consumeRateLimit,
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForUser,
  getOrgReleaseFlagTargeting,
  getServerReleaseFlagValues,
  isImpersonationSession,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
import { summarizeUserAgent } from '../_lib/security-alerts'
import {
  deflectToDocs,
  sectionLabel,
  sectionUrl,
  trimToSentence,
} from '../_lib/assist-deflection'
import { retrieveDocsSections } from '../_lib/assist-retrieval'
import {
  buildReportBody,
  createLinearIssue,
  isReportKind,
  linearConfigFromEnv,
  normalizeAnswers,
  reportFieldsForKind,
  reportTitle,
} from '../_lib/linear-issues'

// lockdown-423: exempt — the same reasoning as support (AGL-1506): a member of a locked
// org must still be able to tell us something is broken, and the bug they hit may be the
// reason they are locked. This writes nothing into the org's own subtree — it files into
// Aglyn's tracker — so the verdict has no org-scoped write to refuse, and refusing the
// report would only cost us the report.

/**
 * Customer issue reports (AGL-2185) → the Linear "Customer bug reports"
 * project.
 *
 * the requirement was for an issue-reporting tool in the console, "tracked in a
 * separate linear project then our primary one". Support tickets already
 * exist but start on Pro, so a Free or Starter org that hits a bug has no
 * channel at all — and a ticket is a support conversation, not a tracked
 * defect. This is the defect channel, open to every signed-in member.
 *
 * ## Why the reports are kept out of the engineering queue
 *
 * The primary project is our own triaged backlog, where the `launch-blocker`
 * label and the issue state mean specific things. Customer reports arrive
 * unfiltered, at whatever severity the reporter felt. Inbound volume is not
 * something we control, so mixing the two would let it drift our release
 * counts while burying real customer pain under internal tasks.
 *
 * The destination is configuration
 * (`LINEAR_CUSTOMER_REPORTS_TEAM_ID` + `LINEAR_CUSTOMER_REPORTS_PROJECT_ID`),
 * not a convention someone has to remember. Triage promotes a genuinely
 * release-blocking report by creating a LINKED issue in the primary project;
 * the report itself is never moved or relabelled.
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
 * Six values arrive from the client — `kind`, `summary`, an `answers` bag,
 * `route`, a viewport coerced to integers, and two ids (`orgId`, `hostId`)
 * that are HINTS, not assertions: both are re-resolved against this session's
 * own access before anything is recorded, so naming an org or a site the
 * reporter cannot reach yields no org and no site rather than someone else's.
 *
 * `answers` is normalised against `REPORT_FIELDS` for the stated kind, which
 * is the same schema the dialog renders — unknown ids are dropped rather than
 * recorded, and a single-choice field accepts only its own choices, so no
 * hand-made payload can add a section to an issue body or write free text
 * into a field the console shows as four fixed options.
 *
 * Everything else the issue records is derived server-side: the reporter from
 * the verified token, the org, plan and role from the membership read, the
 * release-flag state from the resolved org, the console host and user-agent
 * from request headers, the version and build id from this build's own
 * constants, and the correlation id generated here. That is the point — a
 * report a customer can forge is a report a triager cannot trust.
 * `../_lib/linear-issues` escapes what remains.
 *
 * ## What is deliberately NOT attached
 *
 * No credentials or tokens of any kind — not the caller's id token, not the
 * Linear key, no cookie or session material. No IP address: it identifies the
 * reporter's location and adds nothing a triager can act on. Nothing about any
 * other customer — every id recorded is one this session already had access
 * to. Release flags are recorded as KEYS only, which name product surfaces
 * rather than carrying any value or subject data.
 */

/** One report per member per minute, 20 an hour — durable, cross-instance. */
const PER_MINUTE = 2
const PER_HOUR = 20

export const dynamic = 'force-dynamic'

/**
 * The site the reporter says they were on — recorded only if they can see it.
 *
 * The client knows the host id; the server must not take its word for it. An
 * unverified id would let any signed-in member stamp another customer's site
 * onto a report, which is both a privacy leak into our tracker and a way to
 * send triage after the wrong system. Two reads decide it, mirroring the
 * `hosts/usage` contract: direct host membership, else org membership over
 * the host's owning org.
 *
 * Failure is "no site", never an error: a bad id must not cost us the report.
 */
async function verifiedHost(
  uid: string,
  hostId: unknown,
): Promise<{ hostId: string; hostName: string | null } | null> {
  const id = String(hostId ?? '').trim()
  if (!id || id.length > 200) return null
  try {
    const firestore = firebaseAdmin.app().firestore()
    const snapshot = await firestore.collection('hosts').doc(id).get()
    if (!snapshot.exists) return null

    let allowed = Boolean((snapshot.get('memberRoles') ?? {})[uid])
    if (!allowed) {
      const orgId = await resolveOrgIdForHost(id)
      if (orgId) {
        allowed = (
          await firestore
            .collection('orgs')
            .doc(orgId)
            .collection('members')
            .doc(uid)
            .get()
        ).exists
      }
    }
    if (!allowed) return null

    const name = snapshot.get('displayName') ?? snapshot.get('subdomain')
    return { hostId: id, hostName: name ? String(name) : null }
  } catch {
    return null
  }
}

/**
 * Which release flags are ON for this org, so a report against a flagged-off
 * surface is recognisable rather than triaged as a phantom bug.
 *
 * Keys only. A flag key names a product surface — it is not a secret, and it
 * carries nothing about any other customer. `null` means the read failed,
 * which the issue renders distinctly from "none are on": those are different
 * facts and collapsing them would make an empty list unfalsifiable.
 */
async function releaseFlagsOnForOrg(
  orgId: string | null,
): Promise<string[] | null> {
  try {
    // Overrides AND the org's tier from ONE document read (AGL-2486). The
    // report is meant to say what this org can actually reach, so it has to
    // apply the same tier filter the product surfaces do — reading a
    // `plans`-targeted flag as OFF here would put a triager onto a phantom
    // bug for a feature the customer plainly has.
    const [values, targeting] = await Promise.all([
      getServerReleaseFlagValues(),
      getOrgReleaseFlagTargeting(orgId),
    ])
    return RELEASE_FLAGS.filter((definition) =>
      isReleaseFlagOnForOrg(
        definition.key,
        // `isReleaseFlagOn` dereferences the value, so a key the Remote
        // Config template has not got yet would throw and blank the WHOLE
        // row — one newly-registered flag costing every other flag's state.
        // The registry default is what the gate itself falls back to.
        values?.[definition.key] ?? { enabled: definition.defaultEnabled },
        orgId,
        targeting.overrides,
        targeting.plan,
      ),
    ).map((definition) => definition.key)
  } catch {
    return null
  }
}

export async function POST(request: Request): Promise<Response> {
  // Generated before anything can fail, so the log line for a refused or
  // broken request carries the same id the reporter is handed.
  const correlationId = randomUUID()
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

    const payload = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    const kind = payload?.['kind']
    const summary = String(payload?.['summary'] ?? '').trim()
    if (!isReportKind(kind)) {
      return Response.json(
        { error: 'Pick what kind of report this is.' },
        { status: 400 },
      )
    }
    if (!summary) {
      return Response.json(
        { error: 'Add a short summary.' },
        { status: 400 },
      )
    }

    // Validated against the SAME schema the dialog renders from, so a field
    // the customer was asked for is a field that is actually enforced — and
    // one nobody was asked for cannot be smuggled into the issue body.
    const { answers, missing } = normalizeAnswers(kind, payload?.['answers'])
    if (missing.length) {
      const fields = reportFieldsForKind(kind)
      const labels = missing.map(
        (id) => fields.find((field) => field.id === id)?.label ?? id,
      )
      return Response.json(
        { error: `Please answer: ${labels.join(' · ')}`, missing },
        { status: 400 },
      )
    }

    // A question the documentation already answers must never become a Linear
    // issue (AGL-2486). Retrieval runs BEFORE the filing path and before the
    // configuration check: it costs a map lookup and a string join, needs no
    // provider key and no `release_assist`, so even a deployment that files
    // nowhere still answers what its own docs answer.
    //
    // Deliberately NOT routed through `/api/assist/chat`, which 404s for a
    // non-staff caller whenever `release_assist` is off — its shipped default.
    // Borrowing that route would put the reporter behind a flag that is dark
    // for every customer, which is the opposite of the point.
    if (kind === 'question' && payload?.['skipDeflection'] !== true) {
      const question = `${summary}\n${answers['question'] ?? ''}`.trim()
      const scored = retrieveDocsSections(question)
      const deflection = deflectToDocs(question, scored, false)
      if (deflection.answered) {
        console.info('[issue-reports] deflected to docs', {
          correlationId,
          page: deflection.page,
          uid: decoded.uid,
        })
        return Response.json(
          {
            deflected: true,
            // Verbatim docs text and the page it came from — never a
            // paraphrase. `assist-deflection` owns that guarantee and its
            // spec asserts it by reconstruction.
            sections: deflection.quoted.slice(0, 3).map((section) => ({
              title: sectionLabel(section),
              url: sectionUrl(section),
              text: trimToSentence(section.text, 700),
            })),
          },
          { status: 200 },
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

    const resolved = await getOrgForUser(
      decoded.uid,
      String(payload?.['orgId'] ?? '') || null,
    )
    const userAgent = request.headers.get('user-agent')

    // Both scoped to this session: the host is verified against what the
    // reporter may actually see, and the flags are read for the org the
    // membership lookup returned — never for an org id the payload asserted.
    const [host, releaseFlagsOn] = await Promise.all([
      verifiedHost(decoded.uid, payload?.['hostId']),
      releaseFlagsOnForOrg(resolved?.orgId ?? null),
    ])

    const title = reportTitle(kind, summary)
    const body = buildReportBody(answers, {
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
      orgRole: (resolved?.member?.role as string | undefined) ?? null,
      orgRoleId: (resolved?.member?.roleId as string | undefined) ?? null,
      hostId: host?.hostId ?? null,
      hostName: host?.hostName ?? null,
      correlationId,
      releaseFlagsOn,
      version: PACKAGE_VERSION,
      buildId: BUILD_ID,
      contactConsent: payload?.['contactConsent'] === true,
      filedAt: new Date().toISOString(),
    })

    const created = await createLinearIssue({
      config,
      kind,
      title,
      description: body,
    })
    if (!created.ok) {
      // Never 200 on a report that was not filed. The reporter still has
      // their text in the open dialog, which is the whole reason this says
      // so plainly instead of closing on a false success.
      //
      // Told plainly rather than queued for retry, deliberately. A durable
      // queue needs a writer, a retry worker AND a reader, and the failure
      // this repo keeps finding is the third one missing — a queue nobody
      // drains loses reports exactly like a dropped POST, but silently and
      // with a green check on top. The reporter keeps their text, learns it
      // did not send, and gets an id support can find the log line by.
      console.error('[issue-reports] Linear filing failed', {
        correlationId,
        reason: created.reason,
        uid: decoded.uid,
      })
      return Response.json(
        {
          error:
            'We could not file that report just now. Your text is still ' +
            'here — try again, or quote this reference to support: ' +
            correlationId,
          correlationId,
        },
        { status: 502 },
      )
    }
    console.info('[issue-reports] filed', {
      correlationId,
      reference: created.identifier,
      uid: decoded.uid,
    })

    // The Linear URL is deliberately NOT returned: it is an internal tracker
    // link a customer cannot open, and handing it back only invites them to
    // try. The identifier is enough to quote back to support.
    return Response.json({ ok: true, reference: created.identifier }, { status: 200 })
  } catch (error) {
    console.error('[issue-reports] failed', error)
    return Response.json({ error: 'Filing that report failed.' }, { status: 500 })
  }
}
