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

import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { writeCronBeat } from '@aglyn/aglyn/app-utils/health-report'
import {
  DIGEST_PREFS_FIELD,
  digestEnabled,
  INSIGHT_DIGESTS_FIELD,
  insightDigestSubscribed,
} from '@aglyn/aglyn/app-utils/notifications'
import { liveCustomDomain, TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import { hostRoleFor } from '@aglyn/aglyn/app-utils/organizations'
import {
  checkEntitlement,
  resolveBrandingProfile,
  resolveEffectivePlan,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  isReleaseFlagOnForOrg,
  parseOrgReleaseFlagOverrides,
  type ReleaseFlagKey,
} from '@aglyn/aglyn/app-utils/release-flags'
import {
  composeWeeklySummaryOverviewEmail,
  composeWeeklySummarySiteEmail,
  WEEKLY_SUMMARY_DAYS,
  WEEKLY_SUMMARY_DIGEST_KEY,
  weeklySummaryHasNews,
  weeklySummaryPeriod,
  type WeeklySummaryColors,
  type WeeklySummaryEmail,
  type WeeklySummarySite,
} from '@aglyn/aglyn/app-utils/weekly-summary'
import {
  normalizePluginFigureTable,
  pluginFigureSummarySection,
  type PluginFigureSummaryPart,
  type ResolvedPluginFigureReader,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { emailAccent, rateLimitedRetryAtMs, resolveEmailColor, sendEmail } from '@aglyn/shared-util-email'
import { withoutMailWithheldAccounts } from './account-mail'
import { findUserByUidAcrossPools } from './auth-pools'
import { isCronAuthorized, isCronDryRun } from './cron-auth'
import { meterPlatformEmail } from './email-metering'
import { filterSuppressedEmails } from './email-suppression'
import { eligibleFigureReaders, type FigureReaderContext } from './figure-readers'
import firebaseAdmin from './firebase-admin'
import { listOrgMembers } from './organizations'
import { getServerReleaseFlagValues } from './release-flags'
import {
  loadSystemEmail,
  renderLoadedSystemEmail,
  systemEmailBrand,
  systemEmailContent,
  systemEmailTheme,
  type LoadedSystemEmail,
} from './render-system-email'

/**
 * THE WEEKLY SUMMARY'S SENDS (AGL-3867): `POST /api/admin/weekly-summary`,
 * Mondays at 13:00 UTC (08:00 Central) from `scheduled-crons.yml`.
 *
 * ## What is sent, and to whom
 *
 * One email for each of a workspace's sites that had something to report,
 * and a workspace overview that adds them up: totals across the sites, a line
 * for each, and the workspace's own figures, such as its deals.
 *
 *  - The workspace's owners and admins get the overview and every site's
 *    email. In a workspace where only one site had anything to report, the
 *    overview would repeat it, so that site's email carries the workspace's
 *    own figures instead and no overview is sent.
 *  - A member who is an admin of a site, without being one of the
 *    workspace's, gets that site's email: they run it.
 *
 * The **Weekly summary** switch on each person's account
 * (`users/{uid}.digestPrefs.weeklySummary`, on until turned off) governs all
 * of it. A locked or disabled account, a suppressed address and a suspended
 * member are not mailed.
 *
 * ## What it reads
 *
 * The workspace's busiest `WEEKLY_SUMMARY_MAX_SITES` sites by last week's
 * page views, each through every site reader that declares a
 * `weeklySummary`, and the workspace through every workspace reader that
 * does. Each reader is offered only where its plan feature is included and
 * its plugin runs (`eligibleFigureReaders`), read over the seven whole days
 * before the run, and summarized by its owner. A reader that fails is left
 * out; the rest are still read. Every figure is read once per workspace, and
 * every recipient is sent the same figures.
 *
 * ## Once a week, and resumable
 *
 * `orgs/{orgId}/weeklySummaries/{week}.sent.{uid}.{email}` records each
 * email sent — `overview`, or a site's id — stamped after each send, so a run
 * that dies mid-workspace sends only what never went, and a second run in the
 * same week sends nothing. Workspaces are swept in id order behind a cursor,
 * the `done: false` loop the workflow already runs for the CRM digest.
 *
 * The email is a `bulk` send under the platform send-rate governor: a refusal
 * stops the run and answers `done: true`, and a manual re-run in the same week
 * picks up the rest. Metered as PLATFORM mail, not the workspace's: it is the
 * platform reporting to the people who run it.
 */

type Firestore = FirebaseFirestore.Firestore
type Snapshot = FirebaseFirestore.QueryDocumentSnapshot

/** The beat `/api/health/crons` reads, once this job joins its inventory. */
export const WEEKLY_SUMMARY_JOB_ID = 'weekly-summary'

/** `orgs/{orgId}/weeklySummaries/{week}` — server-written, matched by no rule. */
export const WEEKLY_SUMMARY_MARKERS = 'weeklySummaries'

/** The marker key of the overview; a site's email is keyed by the site's id. */
export const WEEKLY_SUMMARY_OVERVIEW = 'overview'

/** The system emails: the overview, and one site's. */
export const WEEKLY_SUMMARY_TEMPLATE = 'weekly-summary'
export const WEEKLY_SUMMARY_SITE_TEMPLATE = 'weekly-summary-site'

/** Workspaces per invocation; a chunk that times out never advances its cursor. */
export const WEEKLY_SUMMARY_ORG_CHUNK = 20

/** Sites a workspace's sweep ranks, by document id. */
export const WEEKLY_SUMMARY_HOST_READ_LIMIT = 50

/** Sites a week's summary reports on: the busiest by last week's page views. */
export const WEEKLY_SUMMARY_MAX_SITES = 5

/** Members per workspace whose address is chased through the auth pools when their member document has none. */
export const WEEKLY_SUMMARY_MAX_UID_LOOKUPS = 5

/** How long one call works before it stops and leaves the rest to the next. */
export const WEEKLY_SUMMARY_RUN_BUDGET_MS = 45_000

/** The theme tokens each color of the layout is drawn from. */
const COLOR_TOKENS: Record<keyof WeeklySummaryColors, string> = {
  text: 'text.primary',
  muted: 'text.secondary',
  border: 'divider',
  surface: 'grey.50',
  accent: 'primary.main',
  link: 'primary.main',
  up: 'success.dark',
  down: 'error.dark',
}

/** Last resort for a token a palette cannot resolve; the platform palette's own values. */
const COLOR_FALLBACKS: WeeklySummaryColors = {
  text: '#212121',
  muted: '#666666',
  border: '#e0e0e0',
  surface: '#fafafa',
  accent: '#00b0ff',
  link: '#0077ad',
  up: '#357a38',
  down: '#9e1e1b',
}

export interface WeeklySummarySendResult {
  sent: boolean
  /** The platform's send rate refused it for now. */
  rateLimited: boolean
  reason?: string
}

export interface WeeklySummaryMessage {
  to: string
  template: typeof WEEKLY_SUMMARY_TEMPLATE | typeof WEEKLY_SUMMARY_SITE_TEMPLATE
  email: WeeklySummaryEmail
  org: Record<string, unknown>
  merge: Record<string, string>
}

/** Everything the sweep reaches beyond Firestore, so a spec can hold each one. */
export interface WeeklySummaryDeps {
  firestore: Firestore
  runAt: Date
  dryRun: boolean
  /** The console's absolute origin, or `''` when none is configured. */
  origin: string
  /** Whether a release flag is on for an org. */
  flagOn: (flag: ReleaseFlagKey, orgId: string, org: Record<string, unknown>) => boolean
  orgMembers: (orgId: string) => Promise<AglynOrgMember[]>
  /** The uids whose accounts may be mailed. */
  reachable: (uids: string[]) => Promise<string[]>
  /** The readers that declare a `weeklySummary` and pass the gates here. */
  readers: (context: Omit<FigureReaderContext, 'accept'>) => Promise<ResolvedPluginFigureReader[]>
  /** The org's email colors, from its theme. */
  colors: (org: Record<string, unknown>) => WeeklySummaryColors
  /** The member's deliverable address, or `null` when there is none or it is suppressed. */
  address: (member: AglynOrgMember, lookups: { left: number }) => Promise<string | null>
  send: (message: WeeklySummaryMessage) => Promise<WeeklySummarySendResult>
  budgetMs?: number
}

export interface WeeklySummaryOrgReport {
  skipped?: string
  sites: number
  recipients: number
  sent: number
  failed?: number
  /** Why the workspace stopped short: the call's time ran out, or the send rate refused. */
  deferred?: 'time' | 'rate'
}

export interface WeeklySummaryReport {
  week: string
  dryRun: boolean
  swept: number
  sent: number
  orgs: Record<string, WeeklySummaryOrgReport>
  deferred: false | 'time' | 'rate'
  nextCursor: string | null
  done: boolean
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

function siteName(data: Record<string, unknown>, id: string): string {
  return str(data['displayName']) || str(data['name']) || str(data['subdomain']) || id
}

/** Last week's page views for each site, read from the daily analytics documents. */
async function weekViews(
  firestore: Firestore,
  hosts: readonly Snapshot[],
  days: readonly string[],
): Promise<Map<string, number>> {
  const views = new Map<string, number>()
  if (!hosts.length) return views
  const refs = hosts.flatMap((host) => days.map((day) => host.ref.collection('analytics').doc(day)))
  const docs = await firestore.getAll(...refs)
  for (const doc of docs) {
    const hostId = doc.ref.parent.parent?.id ?? ''
    views.set(hostId, (views.get(hostId) ?? 0) + (Number(doc.get('total') ?? 0) || 0))
  }
  return views
}

function weekDays(from: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  return Array.from({ length: WEEKLY_SUMMARY_DAYS }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  )
}

/**
 * Each reader's part, in its declared order: read over the week, then
 * summarized by its owner. A reader that fails, answers no table, has nothing
 * to say or cannot be read over seven days is left out.
 */
async function readParts(
  readers: readonly ResolvedPluginFigureReader[],
  base: { orgId: string; hostId: string | null; now: Date },
): Promise<PluginFigureSummaryPart[]> {
  const ordered = readers
    .filter(({ reader }) => reader.weeklySummary)
    .sort(
      (a, b) =>
        (a.reader.weeklySummary?.order ?? 0) - (b.reader.weeklySummary?.order ?? 0) ||
        a.reader.id.localeCompare(b.reader.id),
    )
  const parts: PluginFigureSummaryPart[] = []
  for (const { reader } of ordered) {
    const summary = reader.weeklySummary
    if (!summary) continue
    const days = reader.windows.length ? (reader.windows.includes(WEEKLY_SUMMARY_DAYS) ? WEEKLY_SUMMARY_DAYS : null) : 0
    if (days === null) continue
    try {
      const read = await reader.read({ ...base, days, uid: null, params: {} })
      if (read.ok === false) continue
      const table = normalizePluginFigureTable(read.table)
      if (!table) continue
      const part = summary.summarize(table)
      if (part && (part.stats?.length || part.rows?.length)) parts.push(part)
    } catch (error) {
      console.error('[weekly-summary] reader failed', { reader: reader.id, orgId: base.orgId, error })
    }
  }
  return parts
}

/** The emails one person is owed this week, by marker key, in the order they are sent. */
function emailsFor(
  member: AglynOrgMember,
  manager: boolean,
  sites: ReadonlyArray<{ hostId: string; site: WeeklySummarySite }>,
  workspace: readonly PluginFigureSummaryPart[],
): Array<{ key: string; hostId: string | null; withWorkspace: boolean }> {
  const active = sites.filter(({ site }) => weeklySummaryHasNews(site))
  if (!manager) {
    return active
      .filter(({ hostId }) => hostRoleFor(member, hostId) === 'admin')
      .map(({ hostId }) => ({ key: hostId, hostId, withWorkspace: false }))
  }
  // One active site: its email carries the workspace's figures, and an
  // overview would only say it again.
  if (active.length === 1) {
    return [{ key: active[0].hostId, hostId: active[0].hostId, withWorkspace: true }]
  }
  return [
    ...(active.length || workspace.length ? [{ key: WEEKLY_SUMMARY_OVERVIEW, hostId: null, withWorkspace: false }] : []),
    ...active.map(({ hostId }) => ({ key: hostId, hostId, withWorkspace: false })),
  ]
}

async function summarizeOrg(
  deps: WeeklySummaryDeps,
  orgDoc: Snapshot,
  period: ReturnType<typeof weeklySummaryPeriod>,
  overBudget: () => boolean,
): Promise<WeeklySummaryOrgReport> {
  const { firestore } = deps
  const orgId = orgDoc.id
  const org = (orgDoc.data() ?? {}) as Record<string, unknown>
  const report: WeeklySummaryOrgReport = { sites: 0, recipients: 0, sent: 0 }

  const markerRef = orgDoc.ref.collection(WEEKLY_SUMMARY_MARKERS).doc(period.week)
  const sentAlready = ((await markerRef.get()).get('sent') ?? {}) as Record<string, Record<string, unknown>>

  // Who could be told: owners and admins, and each site's own admins. Not
  // suspended, an account that may be mailed, the switch kept on.
  const members = (await deps.orgMembers(orgId)).filter((member) => member.orgSuspended !== true)
  const isManager = (member: AglynOrgMember) => member.role === 'owner' || member.role === 'admin'
  const candidates = members.filter(
    (member) => isManager(member) || Object.values(member.hostAccess ?? {}).includes('admin'),
  )
  const reachable = new Set(await deps.reachable(candidates.map((member) => member.$id)))
  const reached = candidates.filter((member) => reachable.has(member.$id)).sort((a, b) => a.$id.localeCompare(b.$id))
  if (!reached.length) return { ...report, skipped: candidates.length ? 'nobody-reachable' : 'no-managers' }
  const userDocs = await firestore.getAll(...reached.map((member) => firestore.collection('users').doc(member.$id)))
  const users = new Map(userDocs.map((doc) => [doc.id, doc]))
  const recipients = reached.filter((member) =>
    digestEnabled(users.get(member.$id)?.get(DIGEST_PREFS_FIELD), WEEKLY_SUMMARY_DIGEST_KEY),
  )
  report.recipients = recipients.length
  if (!recipients.length) return { ...report, skipped: 'summary-off' }

  // The busiest sites by last week's page views, ties by id.
  const hostPage = await firestore
    .collection('hosts')
    .where('orgId', '==', orgId)
    .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
    .limit(WEEKLY_SUMMARY_HOST_READ_LIMIT)
    .get()
  const hosts = hostPage.docs.filter((doc) => !doc.get('deletedAt'))
  const views = await weekViews(firestore, hosts, weekDays(period.from))
  const chosen = [...hosts]
    .sort((a, b) => (views.get(b.id) ?? 0) - (views.get(a.id) ?? 0) || a.id.localeCompare(b.id))
    .slice(0, WEEKLY_SUMMARY_MAX_SITES)

  const orgSlug = str(org['slug'])
  const sites: Array<{ hostId: string; site: WeeklySummarySite; subdomain: string }> = []
  for (const host of chosen) {
    const data = (host.data() ?? {}) as Record<string, unknown>
    const readers = (await deps.readers({ orgId, hostId: host.id, org, host: data })).filter(
      ({ reader }) => pluginFigureSummarySection(reader) === 'site',
    )
    const parts = await readParts(readers, { orgId, hostId: host.id, now: period.now })
    const subdomain = str(data['subdomain'])
    const domain = liveCustomDomain(data as never) ?? (subdomain ? `${subdomain}.${TENANT_APEX}` : '')
    sites.push({
      hostId: host.id,
      subdomain,
      site: {
        name: siteName(data, host.id),
        address: domain ? { label: domain, url: `https://${domain}` } : null,
        url:
          deps.origin && orgSlug && subdomain
            ? `${deps.origin}${buildRoute(Route.HOST_DASHBOARD, { orgSlug, host: subdomain })}`
            : null,
        parts,
      },
    })
  }
  const orgReaders = await deps.readers({ orgId, hostId: null, org, host: null })
  const workspace = await readParts(
    orgReaders.filter(({ reader }) => pluginFigureSummarySection(reader) === 'workspace'),
    { orgId, hostId: null, now: period.now },
  )
  report.sites = sites.filter(({ site }) => weeklySummaryHasNews(site)).length
  if (!report.sites && !workspace.length) return { ...report, skipped: 'nothing-to-report' }

  const branding = resolveBrandingProfile(org as never)
  const workspaceName = str(org['name']) || orgSlug || 'your workspace'
  const settingsUrl = `${deps.origin}${buildRoute(Route.MANAGE_NOTIFICATION_SETTINGS)}`
  const colors = deps.colors(org)
  // AI weekly insights, pointed to only where the plan includes them and they are released.
  const offersInsights =
    checkEntitlement(org as never, 'aiGenerative') && deps.flagOn('release_ai_generative', orgId, org)
  const analyticsUrl = (subdomain: string) =>
    offersInsights && deps.origin && orgSlug && subdomain
      ? `${deps.origin}${buildRoute(Route.HOST_ANALYTICS, { orgSlug, host: subdomain })}`
      : null
  const common = {
    workspaceName,
    productName: branding.productName,
    periodLabel: period.label,
    colors,
    settingsUrl,
  }
  const lookups = { left: WEEKLY_SUMMARY_MAX_UID_LOOKUPS }
  const busiest = sites.find(({ site }) => weeklySummaryHasNews(site)) ?? sites[0]

  for (const member of recipients) {
    const owed = emailsFor(member, isManager(member), sites, workspace).filter(
      ({ key }) => !sentAlready[member.$id]?.[key],
    )
    if (!owed.length) continue
    const subscribed = insightDigestSubscribed(users.get(member.$id)?.get(INSIGHT_DIGESTS_FIELD), orgId)
    const to = deps.dryRun ? '' : await deps.address(member, lookups)
    if (!deps.dryRun && !to) continue
    for (const { key, hostId, withWorkspace } of owed) {
      if (overBudget()) return { ...report, deferred: 'time' }
      const entry = hostId ? sites.find((site) => site.hostId === hostId) : null
      const aiInsightsUrl = subscribed ? null : analyticsUrl(entry?.subdomain ?? busiest?.subdomain ?? '')
      const email = entry
        ? composeWeeklySummarySiteEmail({
            ...common,
            aiInsightsUrl,
            site: entry.site,
            ...(withWorkspace ? { workspace } : {}),
          })
        : composeWeeklySummaryOverviewEmail({
            ...common,
            aiInsightsUrl,
            sites: sites.map(({ site }) => site),
            workspace,
            url: deps.origin && orgSlug ? `${deps.origin}${buildRoute(Route.ORG_HOME, { orgSlug })}` : '',
          })
      if (!email) continue
      if (deps.dryRun) {
        report.sent += 1
        continue
      }
      const result = await deps.send({
        to: to as string,
        template: entry ? WEEKLY_SUMMARY_SITE_TEMPLATE : WEEKLY_SUMMARY_TEMPLATE,
        email,
        org,
        merge: {
          'summary.subject': email.subject,
          'summary.title': email.title,
          'summary.period': email.period,
          'summary.html': email.html,
          'summary.buttonLabel': email.buttonLabel,
          'summary.url': email.url,
          'org.name': workspaceName,
          settingsUrl,
        },
      })
      if (result.sent) {
        report.sent += 1
        await markerRef.set(
          {
            week: period.week,
            sent: { [member.$id]: { [key]: true } },
            updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      } else if (result.rateLimited) {
        return { ...report, deferred: 'rate' }
      } else {
        report.failed = (report.failed ?? 0) + 1
      }
    }
  }
  return report
}

/** One chunk of the sweep: workspaces in id order after `cursor`. */
export async function runWeeklySummarySweep(
  deps: WeeklySummaryDeps,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<WeeklySummaryReport> {
  const { firestore } = deps
  const startedAt = Date.now()
  const budget = deps.budgetMs ?? WEEKLY_SUMMARY_RUN_BUDGET_MS
  const overBudget = () => Date.now() - startedAt > budget
  const period = weeklySummaryPeriod(deps.runAt)
  const pageSize = Math.max(1, Math.min(Math.floor(options.limit ?? WEEKLY_SUMMARY_ORG_CHUNK), WEEKLY_SUMMARY_ORG_CHUNK))
  let query = firestore
    .collection('orgs')
    .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
    .limit(pageSize + 1)
  if (options.cursor) query = query.startAfter(firestore.collection('orgs').doc(options.cursor))
  const page = await query.get()
  const hasMore = page.docs.length > pageSize
  const orgDocs = hasMore ? page.docs.slice(0, pageSize) : page.docs

  const report: WeeklySummaryReport = {
    week: period.week,
    dryRun: deps.dryRun,
    swept: 0,
    sent: 0,
    orgs: {},
    deferred: false,
    nextCursor: null,
    done: true,
  }
  let last: string | null = null
  for (const orgDoc of orgDocs) {
    if (overBudget()) {
      report.deferred = 'time'
      break
    }
    try {
      const orgReport = await summarizeOrg(deps, orgDoc, period, overBudget)
      report.orgs[orgDoc.id] = orgReport
      report.sent += orgReport.sent
      if (orgReport.deferred) {
        report.deferred = orgReport.deferred
        break
      }
    } catch (error) {
      console.error('[weekly-summary] workspace failed', orgDoc.id, error)
      report.orgs[orgDoc.id] = { skipped: 'failed', sites: 0, recipients: 0, sent: 0 }
    }
    report.swept += 1
    last = orgDoc.id
  }
  /*
   * Out of time: the next call starts after the last workspace that finished,
   * and the marker skips whoever the unfinished one already reached. Refused
   * by the send rate: the window is full, so the run stops (`done: true`)
   * rather than re-POSTing into it; a re-run in the same week reaches the rest.
   */
  if (report.deferred === 'time') {
    report.nextCursor = last ?? options.cursor ?? null
    report.done = false
  } else if (report.deferred === 'rate') {
    report.done = true
  } else {
    report.nextCursor = hasMore ? last : null
    report.done = report.nextCursor === null
  }
  return report
}

/** The sweep's reach into the real platform: Firestore, the flags, the roster, the mail. */
/** The sweep's reach into the real platform: Firestore, the flags, the roster, the mail. */
export async function weeklySummaryDeps(options: { runAt: Date; dryRun: boolean }): Promise<WeeklySummaryDeps> {
  const firestore = firebaseAdmin.app().firestore()
  const flags = await getServerReleaseFlagValues()
  // Each designed email is read once per call and rendered per recipient.
  const loaded = new Map<string, Promise<LoadedSystemEmail | null>>()
  return {
    firestore,
    runAt: options.runAt,
    dryRun: options.dryRun,
    origin: platformConsoleOrigin(),
    flagOn: (flag, orgId, org) =>
      isReleaseFlagOnForOrg(
        flag,
        (flags as Record<string, never>)[flag],
        orgId,
        parseOrgReleaseFlagOverrides(org['releaseFlags']),
        resolveEffectivePlan(org as never),
      ),
    orgMembers: (orgId) => listOrgMembers(orgId),
    reachable: (uids) => withoutMailWithheldAccounts(uids),
    readers: (context) => eligibleFigureReaders({ ...context, accept: (reader) => Boolean(reader.weeklySummary) }),
    colors: (org) => {
      const { palette } = systemEmailTheme(systemEmailBrand(org as never).options)
      const colors = { ...COLOR_FALLBACKS }
      for (const key of Object.keys(COLOR_TOKENS) as Array<keyof WeeklySummaryColors>) {
        colors[key] = resolveEmailColor(COLOR_TOKENS[key], palette) ?? COLOR_FALLBACKS[key]
      }
      // Links take the color the renderer gives every other link in the
      // email, not the raw primary, which is too light to read as text.
      colors.link = emailAccent(palette).link
      return colors
    },
    address: async (member, lookups) => {
      let address = str(member.email).toLowerCase()
      if (!address.includes('@') && lookups.left > 0) {
        lookups.left -= 1
        const pooled = await findUserByUidAcrossPools(member.$id).catch(() => null)
        address = str(pooled?.record?.email).toLowerCase()
      }
      if (!address.includes('@')) return null
      const [kept] = await filterSuppressedEmails([address], firestore)
      return kept ?? null
    },
    send: async ({ to, template, email, org, merge }) => {
      if (!loaded.has(template)) loaded.set(template, loadSystemEmail(template).catch(() => null))
      const design = await loaded.get(template)
      const brand = systemEmailBrand(org as never)
      const rendered = design ? renderLoadedSystemEmail(design, { ...brand.merge, ...merge }, brand.options) : null
      const content = systemEmailContent(rendered, { subject: email.subject, text: email.text })
      const result = await sendEmail({
        to: [to],
        ...content,
        // The figures' plain text, rather than the drawn block with its tags stripped.
        text: email.text,
        fromName: resolveBrandingProfile(org as never).fromName,
        context: template,
        priority: 'bulk',
      })
      if (result.sent) {
        await meterPlatformEmail().catch(() => undefined)
        return { sent: true, rateLimited: false }
      }
      return {
        sent: false,
        rateLimited: rateLimitedRetryAtMs(result) !== null,
        reason: (result as { reason?: string }).reason ?? 'failed',
      }
    },
  }
}

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller; it reads each workspace's figures to report them to its owners and admins and writes nothing a locked org could lose.

/**
 * `POST /api/admin/weekly-summary` sends; a GET, or `{"dryRun": true}`,
 * reports who would be sent what and sends nothing. The body may carry the
 * `cursor` a previous chunk answered and a smaller `limit`.
 */
export async function weeklySummaryRoute(request: Request): Promise<Response> {
  const method = request.method.toUpperCase()
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } })
  }
  if (!process.env['CRON_SECRET']) {
    return Response.json({ error: 'The weekly summary is not configured (CRON_SECRET).' }, { status: 501 })
  }
  const headers = Object.fromEntries(request.headers.entries()) as Partial<Record<string, string>>
  if (!isCronAuthorized(headers)) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const body = method === 'POST' ? ((await request.json().catch(() => null)) as Record<string, unknown> | null) : null
  const query = Object.fromEntries(new URL(request.url).searchParams.entries())
  const dryRun = isCronDryRun({ method, body: body ?? undefined, query })
  // Stamped on the invocation, not on the work (AGL-1955), so the beat is
  // already there the day this job joins `SCHEDULED_JOBS`.
  if (method === 'POST') {
    try {
      await writeCronBeat(firebaseAdmin.app().firestore(), WEEKLY_SUMMARY_JOB_ID)
    } catch {
      // A job that stops stamping reds its own row; it never fails the run.
    }
  }
  try {
    const rawCursor = body?.['cursor']
    const cursor =
      typeof rawCursor === 'string' && rawCursor.length > 0 && !rawCursor.includes('/') ? rawCursor : null
    const limit = Number(body?.['limit'])
    const report = await runWeeklySummarySweep(await weeklySummaryDeps({ runAt: new Date(), dryRun }), {
      cursor,
      ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    })
    return Response.json(report, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[weekly-summary] run failed', error)
    return Response.json({ error: 'Weekly summary run failed' }, { status: 500 })
  }
}
