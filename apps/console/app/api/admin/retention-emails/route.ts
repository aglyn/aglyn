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

import { buildRoute, pluginRequestFromWeb, Route } from '@aglyn/aglyn/server'
import { readPlatformMarketingConsent } from '@aglyn/aglyn/app-utils/platform-marketing-consent'
import {
  isEmailConfigured,
  PRODUCT_TIP_RETENTION_EMAILS,
  RETENTION_VERIFY_REMINDER_EMAIL,
  sendEmail,
} from '@aglyn/shared-util-email'
import {
  firebaseAdmin,
  isEmailSuppressed,
  listUsersAcrossPools,
  meterPlatformEmail,
} from '@aglyn/tenant-data-admin'
import { hostOrigin } from '@aglyn/tenant-data-admin/server/held-page-subject'
import { generateAuthActionLink } from '../../_lib/auth-action-link'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { renderSystemEmail } from '../../_lib/render-system-email'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import {
  isRetentionCandidate,
  LIFECYCLE_EMAILS_FIELD,
  planRetentionEmail,
  summarizePages,
  type RetentionDecision,
  type RetentionPage,
} from '../../../../utils/server/retention-emails'
import {
  consoleOriginForEmail,
  greetingName,
} from '../../../../utils/server/staff-system-email'

// lockdown-423: exempt — a platform cron; it mails accounts, it changes no org.

/**
 * THE GETTING-STARTED EMAILS, HOURLY (AGL-3692).
 *
 * Walks the project's accounts and sends each one the getting-started email
 * its activation stage owes it, once per crossing. `planRetentionEmail`
 * holds every rule about which email is owed; this route reads the facts,
 * sends, and records the crossing on `users/{uid}.lifecycleEmails`.
 *
 * - A GET reports the plan and sends nothing; the scheduled POST sends.
 *   `?dryRun=1` on a POST reports too. A staff ID token may read the plan
 *   (always a dry run) but never send.
 * - Suppressed addresses, disabled and staff accounts are never mailed. The
 *   product tips skip anyone who answered No to product email. The
 *   verification reminder is account mail and is governed by the suppression
 *   list alone.
 * - The send is `bulk` priority: a refusal from the platform send-rate
 *   governor leaves the crossing unrecorded, and the next hour's run tries
 *   again. So does an Identity Platform throttle on a verification link.
 * - The crossing is recorded only after a send, so a failed send is retried
 *   and a sent one never repeats.
 */

export const RETENTION_EMAILS_JOB_ID = 'retention-emails'

/** Auth pages walked per run (1,000 accounts each). */
const MAX_AUTH_PAGES = 20
/** Accounts whose Firestore facts are read per run. */
const MAX_CANDIDATES = 600
/** Emails sent per run; the rest wait an hour. */
const MAX_SENDS = 60
/** Sites and pages read per account. */
const MAX_SITES = 3
const MAX_PAGES = 100

function ms(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const toMillis = (value as { toMillis?: () => number } | null)?.toMillis
  return typeof toMillis === 'function' ? toMillis.call(value) : null
}

interface PrimarySite {
  name: string
  orgSlug: string
  host: string
  siteUrl: string | null
}

interface AccountFacts {
  firstName: string | null
  declinedProductEmail: boolean
  sent: Record<string, number>
  orgSlug: string | null
  site: PrimarySite | null
  pages: RetentionPage[]
}

async function readAccountFacts(uid: string): Promise<AccountFacts> {
  const db = firebaseAdmin.app().firestore()
  const userRef = db.collection('users').doc(uid)
  const [profile, orgIndex] = await Promise.all([
    userRef.get(),
    userRef.collection('orgs').limit(5).get(),
  ])
  const data = (profile.exists ? profile.data() : null) ?? {}
  const sentRaw = (data as Record<string, unknown>)[LIFECYCLE_EMAILS_FIELD]
  const sent: Record<string, number> = {}
  if (sentRaw && typeof sentRaw === 'object') {
    for (const [key, value] of Object.entries(sentRaw as Record<string, unknown>)) {
      const at = ms(value)
      if (at !== null) sent[key] = at
    }
  }
  const facts: AccountFacts = {
    firstName:
      typeof (data as Record<string, unknown>)['firstName'] === 'string'
        ? ((data as Record<string, unknown>)['firstName'] as string)
        : null,
    declinedProductEmail:
      readPlatformMarketingConsent(data as Record<string, unknown>).decision === 'declined',
    sent,
    orgSlug: null,
    site: null,
    pages: [],
  }

  let sitesRead = 0
  for (const orgEntry of orgIndex.docs) {
    const org = await db.collection('orgs').doc(orgEntry.id).get()
    if (!org.exists) continue
    const slug = String(org.get('slug') ?? '')
    if (slug && !facts.orgSlug) facts.orgSlug = slug
    const hostIds = Object.keys((org.get('hosts') as Record<string, unknown>) ?? {})
    for (const hostId of hostIds) {
      if (sitesRead >= MAX_SITES) break
      sitesRead += 1
      const [host, screens] = await Promise.all([
        db.collection('hosts').doc(hostId).get(),
        db.collection('hosts').doc(hostId).collection('screens').limit(MAX_PAGES).get(),
      ])
      if (!host.exists) continue
      const hostData = host.data() ?? {}
      if (!facts.site && slug) {
        facts.site = {
          name: String(hostData['displayName'] ?? hostData['subdomain'] ?? 'your site'),
          orgSlug: slug,
          host: String(hostData['subdomain'] ?? hostId),
          siteUrl: hostOrigin(hostData),
        }
      }
      for (const screen of screens.docs) {
        const page = screen.data() ?? {}
        facts.pages.push({
          createdAtMs: ms(page['createdAt']),
          updatedAtMs: ms(page['updatedAt']),
          publishedAtMs: ms(page['publishedAt']),
          createdBy: typeof page['createdBy'] === 'string' ? page['createdBy'] : null,
          deleted: Boolean(page['deletedAt']),
        })
      }
    }
  }
  return facts
}

/** The merge values for one email, from the account's facts. */
function mergeFor(
  facts: AccountFacts,
  displayName: string | null,
  email: string,
): Record<string, string> {
  const origin = consoleOriginForEmail()
  const site = facts.site
  const siteRoute = site
    ? buildRoute(Route.HOST_DASHBOARD, { orgSlug: site.orgSlug, host: site.host })
    : facts.orgSlug
      ? buildRoute(Route.ORG_HOME, { orgSlug: facts.orgSlug })
      : ''
  return {
    name: greetingName({ email, firstName: facts.firstName, displayName }),
    'site.name': site?.name ?? 'your site',
    ctaUrl: `${origin}${siteRoute || '/signin'}`,
    siteUrl: site?.siteUrl ?? '',
    domainUrl: site
      ? `${origin}${buildRoute(Route.HOST_ADMIN_DOMAIN, { orgSlug: site.orgSlug, host: site.host })}`
      : `${origin}${siteRoute}`,
    formsUrl: site
      ? `${origin}${buildRoute(Route.HOST_FORMS, { orgSlug: site.orgSlug, host: site.host })}`
      : `${origin}${siteRoute}`,
    preferencesUrl: `${origin}${buildRoute(Route.MANAGE_USER_EMAILS)}`,
  }
}

interface PlanRow {
  uid: string
  key: string
  crossing: string
  outcome: 'planned' | 'sent' | 'suppressed' | 'failed' | 'throttled' | 'deferred'
}

function isTooManyAttempts(error: unknown): boolean {
  const probe = error as { code?: unknown; message?: unknown; cause?: { response?: { text?: unknown } } } | null
  if (!probe || probe.code !== 'auth/internal-error') return false
  const body = probe.cause?.response?.text
  return `${typeof body === 'string' ? body : ''} ${String(probe.message ?? '')}`.includes(
    'TOO_MANY_ATTEMPTS_TRY_LATER',
  )
}

async function sendOne(
  uid: string,
  email: string,
  decision: RetentionDecision,
  merge: Record<string, string>,
): Promise<PlanRow['outcome']> {
  if (await isEmailSuppressed(email)) return 'suppressed'
  const values = { ...merge }
  if (decision.key === RETENTION_VERIFY_REMINDER_EMAIL) {
    try {
      values['verifyUrl'] = await generateAuthActionLink(
        'verifyEmail',
        email,
        consoleOriginForEmail(),
      )
    } catch (error) {
      if (isTooManyAttempts(error)) return 'throttled'
      throw error
    }
  }
  const rendered = await renderSystemEmail(decision.key, values)
  if (!rendered) return 'failed'
  const productTip = PRODUCT_TIP_RETENTION_EMAILS.has(decision.key)
  const result = await sendEmail({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    context: decision.key,
    priority: 'bulk',
    ...(productTip
      ? { headers: { 'List-Unsubscribe': `<${values['preferencesUrl']}>` } }
      : { owedFor: 'account' as const }),
  })
  if (!result.sent) {
    const reason = (result as { reason?: string }).reason
    return reason === 'rate-limited' || reason === 'frequency-capped' ? 'deferred' : 'failed'
  }
  await meterPlatformEmail().catch(() => undefined)
  await firebaseAdmin
    .app()
    .firestore()
    .collection('users')
    .doc(uid)
    .set({ [LIFECYCLE_EMAILS_FIELD]: { [decision.crossing]: Date.now() } }, { merge: true })
  return 'sent'
}

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
    // A refused credential is a 401 (AGL-1993); anything else is ours.
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
  // The scheduler sends; a staff member may only READ the plan. This route
  // lists accounts, so anything else is refused (AGL-1881).
  const cron = isCronAuthorized(headers)
  if (!cron) {
    const staff = await isStaffCaller(headers)
    if (staff !== true) return staff
  }
  const dryRun =
    !cron ||
    isCronDryRun({
      method,
      body,
      query: query as Record<string, string | string[] | undefined>,
    })
  if (cron && method === 'POST') await recordCronBeat(RETENTION_EMAILS_JOB_ID)
  if (!dryRun && !isEmailConfigured()) {
    return Response.json({ ok: true, skipped: 'email-unconfigured' }, { status: 200 })
  }

  const nowMs = Date.now()
  const rows: PlanRow[] = []
  let scanned = 0
  let candidates = 0
  let sends = 0
  let pageToken: string | undefined
  try {
    for (let page = 0; page < MAX_AUTH_PAGES; page += 1) {
      // Every pool, so an SSO account is not silently left out (AGL-1122).
      const listed = await listUsersAcrossPools(1000, pageToken)
      for (const { record: user, tenantId } of listed.users) {
        scanned += 1
        if (candidates >= MAX_CANDIDATES || sends >= MAX_SENDS) break
        const email = String(user.email ?? '').trim().toLowerCase()
        if (!email || user.disabled || user.customClaims?.['staff']) continue
        // An SSO account's address is its identity provider's to confirm, and
        // its links are not ours to mint: no verification reminder for it.
        if (tenantId && !user.emailVerified) continue
        const createdAtMs = ms(user.metadata.creationTime)
        if (createdAtMs === null) continue
        const seen = [ms(user.metadata.lastSignInTime), ms(user.metadata.lastRefreshTime)]
          .filter((value): value is number => value !== null)
        const lastSeenMs = seen.length ? Math.max(...seen) : null
        if (!isRetentionCandidate({ nowMs, createdAtMs, lastSeenMs, emailVerified: user.emailVerified })) {
          continue
        }
        candidates += 1
        const facts = await readAccountFacts(user.uid)
        const decision = planRetentionEmail({
          nowMs,
          createdAtMs,
          lastSeenMs,
          emailVerified: user.emailVerified,
          declinedProductEmail: facts.declinedProductEmail,
          sent: facts.sent,
          ...summarizePages(facts.pages),
        })
        if (!decision) continue
        if (dryRun) {
          rows.push({ uid: user.uid, ...decision, outcome: 'planned' })
          continue
        }
        sends += 1
        const outcome = await sendOne(
          user.uid,
          email,
          decision,
          mergeFor(facts, user.displayName ?? null, email),
        ).catch((error: unknown) => {
          console.error('[retention-emails] send failed', user.uid, decision.key, error)
          return 'failed' as const
        })
        rows.push({ uid: user.uid, ...decision, outcome })
      }
      pageToken = listed.nextPageToken
      if (!pageToken || candidates >= MAX_CANDIDATES || sends >= MAX_SENDS) break
    }
  } catch (error) {
    console.error('[retention-emails] sweep failed', error)
    return Response.json({ error: 'Sweep failed', rows }, { status: 500 })
  }

  const counts: Record<string, number> = {}
  for (const row of rows) counts[`${row.key}:${row.outcome}`] = (counts[`${row.key}:${row.outcome}`] ?? 0) + 1
  return Response.json(
    { ok: true, dryRun, scanned, candidates, counts, rows },
    { status: 200 },
  )
}

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export { handler as GET, handler as POST }
