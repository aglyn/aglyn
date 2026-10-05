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

/*==========================================
 * notifyRiskEvent: ONE WAY TO TELL PEOPLE SOMETHING WAS HELD (AGL-3368).
 *
 * Every place the platform holds, flags, locks or pauses something on a
 * workspace calls this, with the kind from the catalog
 * (`@aglyn/shared-util-email/risk-notice-catalog`) and the facts it knows.
 * This decides who hears, on which channel, and in which words:
 *
 * - THE WORKSPACE'S OWNERS AND ADMINS (the org roster's `owner`/`admin`
 *   roles, the audience `notifyOrgAdmins` reaches), plus — for a kind about
 *   one site's sales or pages — the site's managers, the audience
 *   `notifyHostManagers` reaches and the one a sale's fraud signal always
 *   went to. An account lock goes to the account's own person instead.
 *   They get an in-app notification (`system.riskNotice`) and, for every
 *   kind the catalog marks `emailOwners`, an email.
 * - STAFF, through `notifyStaff`, for the kinds the catalog marks
 *   `alertStaff`. A row-backed alert links the row itself.
 *
 * ## The owner email is account mail from the platform
 *
 * It is sent with no sending identity and no `audience: 'tenant'`, so it
 * leaves on the platform's own configured sender — never the workspace's.
 * That is what lets a LOCKED workspace's owners receive their lock notice:
 * a suspended workspace's own identity refuses every send
 * (`workspace-suspended`), but this mail is not the workspace's. It is
 * `owedFor: 'account'`, carries no marketing context, and ignores
 * notification preferences: the owner did not opt into it and cannot opt
 * out of being told their email was held. The tenant phishing screen never
 * sees it — that screen asks only about a site's mail.
 *
 * ## One notice per event, and a digest under a burst
 *
 * A notice's id is a hash of its dedupe key (by default the kind and the
 * abuse-queue row), created once — so a redelivered webhook or a re-held
 * message never tells anyone twice, on top of the one-alert-per-row rule
 * the row writers already keep.
 *
 * Past {@link RISK_NOTICE_BURST.owners} notices in an hour for one
 * workspace (and {@link RISK_NOTICE_BURST.staff} for staff), further notices
 * are recorded but not delivered one by one. The first one folded sends a
 * short "more are arriving" note in-app; when the hour closes,
 * {@link flushRiskNoticeDigests} (hourly cron, and the next notice after the
 * window) sends ONE summary. A workspace under attack gets a digest, not
 * five hundred emails. Locks, lifts, cancellations, disputes and card-testing
 * warnings (`neverDigest`) always go out on their own.
 *
 * ## Never throws
 *
 * Every caller is a write that has already happened — a hold, a lock, a
 * webhook. A failed notice is reported in the result (the lockdown route
 * shows it as an unconfirmed step) and logged; it never undoes the event.
 *=========================================*/

import { createHash } from 'crypto'
import { ABUSE_REPORT_COLLECTION, abuseReportContactEmail } from '@aglyn/aglyn/app-utils/abuse-report'
import { DOCS_BASE_URL } from '@aglyn/aglyn/app-utils/docs-help'
import { PLATFORM_BRAND_MERGE_TOKENS } from '@aglyn/aglyn/app-utils/system-email-chrome'
import {
  isRiskEventKind,
  renderOwnerRiskNotice,
  renderRiskNoticeText,
  renderStaffRiskNotice,
  resolveOwnerRiskActions,
  RISK_NOTICE_CATALOG,
  RISK_NOTICE_CLOSING_KINDS,
  RISK_NOTICE_DIGEST_EMAIL_KEY,
  RISK_NOTICE_HELP_PATH,
  RISK_NOTICE_WORKSPACE_BRANDED,
  riskNoticeEmailKey,
  riskPayoutDelayText,
  type ResolvedRiskAction,
  type RiskActionParams,
  type RiskEventKind,
  type RiskNoticeSeverity,
  type RiskNoticeValues,
} from '@aglyn/shared-util-email/risk-notice-catalog'
import type { NotificationLevel } from '@aglyn/aglyn/server'
import {
  sendEmail as sendEmailImpl,
  type SendEmailOptions,
  type SendEmailResult,
} from '@aglyn/shared-util-email'
import {
  heldPageDetails,
  heldPageLabel,
  heldPageTargets,
  heldPageVisitorSentence,
  isOpenPageHoldStatus,
  isPageHoldNoticeKind,
  PAGE_HOLD_NOTICE_KINDS,
  pageHoldChip,
  parseHeldPageItemPath,
  type HeldPageSubject,
  type HeldPageTarget,
  type PageHoldNoticeKind,
} from '@aglyn/shared-util-email/held-page'
import { FieldValue } from 'firebase-admin/firestore'
import { findUserByUidAcrossPools } from './auth-pools'
import firebaseAdmin from './firebase-admin'
import {
  type NotificationPayload,
  notifyStaff as notifyStaffImpl,
  notifyUsers as notifyUsersImpl,
  type NotifyUsersOptions,
} from './notifications'
import { meterPlatformEmail } from './email-metering'
import { listOrgMembers } from './organizations'
import {
  orgSystemEmailBrand,
  renderSystemEmailContent,
  type SystemEmailBrand,
  systemEmailBrand,
} from './render-system-email'
import { RISK_REVIEW_REQUESTED_EMAIL_KEY } from '@aglyn/shared-util-email/risk-notice-emails'

/** Admin-SDK only; no client rule opens it. One document per notice. */
export const RISK_NOTICE_COLLECTION = 'riskNotices'

/** Admin-SDK only: each workspace's burst window and folded notices. */
export const RISK_NOTICE_LEDGER_COLLECTION = 'riskNoticeLedger'

/** The in-app notification type every owner notice is written as. */
export const RISK_NOTICE_NOTIFICATION_TYPE = 'system.riskNotice' as const

/**
 * The level an owner notice is drawn at (AGL-3437), from its kind's
 * severity: a release or a lift is `info`, not the red of the hold it ends.
 */
export const RISK_NOTICE_LEVELS: Record<RiskNoticeSeverity, NotificationLevel> = {
  urgent: 'critical',
  warning: 'warning',
  info: 'info',
}

/**
 * The burst allowance: how many notices one workspace's owners, and staff
 * about one workspace, receive one by one in {@link RISK_NOTICE_BURST.windowMs}
 * before the rest are folded into a digest.
 */
export const RISK_NOTICE_BURST = {
  owners: 5,
  staff: 10,
  windowMs: 60 * 60 * 1000,
  /** How many folded notices a digest lists by name. */
  digestListMax: 25,
} as const

/** Longest review-request note stored. */
export const RISK_REVIEW_NOTE_MAX = 2000
/** How many review requests one row keeps. */
export const RISK_REVIEW_REQUESTS_MAX = 20
/** How soon the same workspace may ask again about the same row. */
export const RISK_REVIEW_REQUEST_COOLDOWN_MS = 10 * 60 * 1000

/** What a source knows about the thing the notice is about. */
export interface RiskEventItem {
  /** In the owner's words: `the campaign "Spring sale"`, `order 1042`. */
  label: string
  /**
   * Its console page, in the stored-notification shape (`/org/…` or
   * `/{hostId}/…`) the console rewrites when the link is followed.
   */
  path?: string | null
}

export interface RiskEventInput {
  kind: RiskEventKind
  orgId: string | null
  hostId?: string | null
  /** An account lock's person. */
  userUid?: string | null
  /** The abuse-queue row, when the event has one. */
  reviewId?: string | null
  reference?: string | null
  item?: RiskEventItem | null
  occurredAtMs?: number
  /** `$56.00 USD`. */
  amount?: string | null
  /**
   * What happened to the payment, finishing "the payment was …"
   * (`RISK_PAYMENT_EVENTS`): a fraud report, a review, a dispute.
   */
  paymentEvent?: string | null
  evidenceDueByMs?: number | null
  /**
   * A new publisher's payout schedule: how many days each payout waits, and
   * the workspace age it waits until.
   */
  payout?: { delayDays: number; untilWorkspaceAgeDays: number } | null
  /** Staff only: the Stripe Dashboard page for the charge, review or dispute. */
  stripeUrl?: string | null
  lock?: {
    /** The customer-facing message the lock stores, verbatim. */
    message?: string | null
    /** What the lock or pause covers, in plain words. */
    affected?: string | null
    scope?: string | null
    targetId?: string | null
  } | null
  /**
   * A held or flagged page, described (AGL-3374). Stored on the notice so
   * the console can put the hold on the page, template, layout or component
   * it is about, and name it there. Owner-safe: no signal, no evidence.
   */
  page?: HeldPageSubject | null
  /** Staff only: what the screen or Stripe reported. Never shown to owners. */
  staffEvidence?: string | null
  /** Overrides the default dedupe key. */
  dedupeKey?: string | null
  /**
   * A closing notice's opening kind. The closing goes to the people the
   * opening went to: the site's managers too, when the opening told them.
   */
  openedAs?: RiskEventKind | null
  /**
   * `false` to send no owner EMAIL for this event (a lock placed under a
   * legal hold). The in-app notice and the record are still written.
   */
  emailOwners?: boolean
  /**
   * Exactly who the owner half goes to, in place of the workspace's owners
   * and admins: a batch that already resolved its people and groups several
   * events into one notice per person (the lockdown's "Resend owner
   * notice").
   */
  recipients?: ReadonlyArray<{ uid: string; email: string | null }>
}

export interface RiskNoticeDelivery {
  /** How many people the owner half was for. */
  recipients: number
  /** In-app notifications written (before per-person mutes). */
  inApp: number
  emailed: number
  emailFailed: number
  /** Why no email went, when none did. */
  emailSkipped: string | null
  /** Folded into the next digest instead of delivered now. */
  digested: boolean
}

export interface RiskNoticeResult {
  noticeId: string | null
  /** The same notice was already delivered: nothing was sent now. */
  duplicate: boolean
  owners: RiskNoticeDelivery
  staff: { alerted: boolean; digested: boolean }
  /** Set when the notice could not be processed at all. */
  error: string | null
}

/** Everything the seam touches, injectable for specs. */
export interface RiskNoticeDeps {
  firestore: FirebaseFirestore.Firestore
  sendEmail: (options: SendEmailOptions) => Promise<SendEmailResult>
  notifyUsers: (
    uids: Iterable<string>,
    payload: NotificationPayload,
    options?: NotifyUsersOptions,
  ) => Promise<void>
  notifyStaff: (payload: NotificationPayload) => Promise<void>
  listOwners: (orgId: string) => Promise<Array<{ uid: string; email: string | null }>>
  lookupEmail: (uid: string) => Promise<string | null>
  nowMs: () => number
}

async function defaultListOwners(orgId: string) {
  const members = await listOrgMembers(orgId)
  return members
    .filter((member) => member.role === 'owner' || member.role === 'admin')
    .map((member) => ({
      uid: String(member.$id),
      email: (member as { email?: string | null }).email ?? null,
    }))
}

async function defaultLookupEmail(uid: string): Promise<string | null> {
  const found = await findUserByUidAcrossPools(uid).catch(() => null)
  const email = String(found?.record?.email ?? '').trim()
  return email.includes('@') ? email : null
}

function resolveDeps(overrides: Partial<RiskNoticeDeps> = {}): RiskNoticeDeps {
  return {
    firestore: overrides.firestore ?? firebaseAdmin.app().firestore(),
    sendEmail: overrides.sendEmail ?? sendEmailImpl,
    notifyUsers: overrides.notifyUsers ?? notifyUsersImpl,
    notifyStaff: overrides.notifyStaff ?? notifyStaffImpl,
    listOwners: overrides.listOwners ?? defaultListOwners,
    lookupEmail: overrides.lookupEmail ?? defaultLookupEmail,
    nowMs: overrides.nowMs ?? (() => Date.now()),
  }
}

function consoleOrigin(): string {
  return (process.env.NEXT_PUBLIC_CONSOLE_URL ?? '').trim().replace(/\/+$/, '')
}

/** The help page every notice links, on the docs site. */
export function riskNoticeHelpUrl(anchor?: string): string {
  return `${DOCS_BASE_URL.replace(/\/+$/, '')}${RISK_NOTICE_HELP_PATH}${anchor ? `#${anchor}` : ''}`
}

/** `Sep 28, 2026, 16:31 UTC` — one format for every notice. */
export function formatRiskNoticeTime(ms: number): string {
  const date = new Date(ms)
  if (!Number.isFinite(date.getTime())) return ''
  return `${date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })} UTC`
}

/** The id of the notice a dedupe key names: hex, like the abuse queue's. */
export function riskNoticeId(dedupeKey: string): string {
  return createHash('sha256').update(`risk-notice:${dedupeKey}`).digest('hex').slice(0, 40)
}

/** The default dedupe key: one notice per kind per row, else per event. */
export function riskNoticeDedupeKey(input: RiskEventInput, occurredAtMs: number): string {
  if (input.dedupeKey) return input.dedupeKey
  if (input.reviewId) return `${input.kind}:${input.reviewId}`
  return [
    input.kind,
    input.orgId ?? '',
    input.hostId ?? '',
    input.userUid ?? '',
    input.item?.path ?? input.item?.label ?? '',
    String(occurredAtMs),
  ].join(':')
}

/** The ledger a notice's burst allowance is counted on. */
function ledgerIdFor(input: RiskEventInput): string | null {
  if (input.orgId) return `org:${input.orgId}`
  if (input.userUid) return `user:${input.userUid}`
  if (input.hostId) return `host:${input.hostId}`
  return null
}

/** The console path an owner's Holds & reviews page is at, in stored shape. */
export function riskHoldsPath(noticeId?: string | null): string {
  return `/org/settings/holds${noticeId ? `?notice=${encodeURIComponent(noticeId)}` : ''}`
}

/** A staff deep link to one abuse-queue row. */
export function staffAbuseRowPath(reviewId: string): string {
  return `/admin/abuse-reports?report=${encodeURIComponent(reviewId)}`
}

/** Absolute, for an email: the console origin before a stored path. */
function absolute(path: string | null | undefined): string {
  if (!path) return ''
  if (/^https?:\/\//.test(path)) return path
  const origin = consoleOrigin()
  return origin ? `${origin}${path}` : ''
}

/**
 * The stored-shape console links resolve per reader in the console
 * (`normalizeNotificationLink`); an EMAIL has no reader context, so its
 * links are rewritten here from the org slug and the site's subdomain.
 */
function emailPath(
  path: string,
  context: { orgSlug: string | null; hostId: string | null; hostSubdomain: string | null },
): string | null {
  if (/^https?:\/\//.test(path)) return path
  if (path.startsWith('/admin/') || path.startsWith('/manage/')) return path
  if (path === '/org' || path.startsWith('/org/') || path.startsWith('/org?')) {
    return context.orgSlug ? `/${context.orgSlug}${path.slice(4)}` : null
  }
  if (context.hostId && (path === `/${context.hostId}` || path.startsWith(`/${context.hostId}/`) || path.startsWith(`/${context.hostId}?`))) {
    return context.orgSlug && context.hostSubdomain
      ? `/${context.orgSlug}/hosts/${context.hostSubdomain}${path.slice(context.hostId.length + 1)}`
      : null
  }
  return path
}

/**
 * Stored-shape site paths (`/{hostId}/…`) as console routes, for a reader
 * with no org context of its own — staff reading the abuse queue
 * (AGL-3374). One read of the sites and one of their workspaces for the
 * whole batch; a path that cannot be resolved is left out.
 */
export async function resolveHostConsolePaths(
  firestore: FirebaseFirestore.Firestore,
  entries: ReadonlyArray<{ hostId: string; orgId?: string | null; path: string }>,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  const hostIds = [...new Set(entries.map((entry) => entry.hostId).filter(Boolean))]
  if (!hostIds.length) return resolved
  const hosts = await firestore.getAll(
    ...hostIds.map((id) => firestore.collection('hosts').doc(id)),
  )
  const hostFacts = new Map(
    hosts.map((host) => [
      host.id,
      {
        subdomain: String(host.get('subdomain') ?? '') || null,
        orgId: String(host.get('orgId') ?? '') || null,
      },
    ]),
  )
  // The row names its workspace; a site document may too.
  const orgOf = (entry: { hostId: string; orgId?: string | null }) =>
    entry.orgId || hostFacts.get(entry.hostId)?.orgId || null
  const orgIds = [...new Set(entries.map(orgOf).filter(Boolean))] as string[]
  const orgs = orgIds.length
    ? await firestore.getAll(...orgIds.map((id) => firestore.collection('orgs').doc(id)))
    : []
  const slugs = new Map(orgs.map((org) => [org.id, String(org.get('slug') ?? '') || null]))
  for (const entry of entries) {
    const facts = hostFacts.get(entry.hostId)
    const orgId = orgOf(entry)
    const href = emailPath(entry.path, {
      orgSlug: orgId ? (slugs.get(orgId) ?? null) : null,
      hostId: entry.hostId,
      hostSubdomain: facts?.subdomain ?? null,
    })
    if (href && href !== entry.path) resolved.set(`${entry.hostId}\n${entry.path}`, href)
  }
  return resolved
}

/** The workspace facts every notice renders with. Never throws. */
async function readContext(
  firestore: FirebaseFirestore.Firestore,
  input: RiskEventInput,
): Promise<{
  orgId: string | null
  orgName: string | null
  orgSlug: string | null
  hostSubdomain: string | null
  /** `the site "Harbor View"`: a manager of several sites reads which one. */
  siteLabel: string | null
  siteManagerUids: string[]
}> {
  let orgId = input.orgId ?? null
  let hostSubdomain: string | null = null
  let siteLabel: string | null = null
  let siteManagerUids: string[] = []
  if (input.hostId) {
    const host = await firestore.collection('hosts').doc(input.hostId).get().catch(() => null)
    if (host?.exists) {
      hostSubdomain = String(host.get('subdomain') ?? '') || null
      const siteName =
        [host.get('displayName'), host.get('name'), hostSubdomain]
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .find(Boolean) ?? ''
      siteLabel = siteName ? `the site "${siteName.replace(/"/g, '”')}"` : null
      orgId = orgId ?? (String(host.get('orgId') ?? '') || null)
      const roles = (host.get('memberRoles') as Record<string, string> | undefined) ?? {}
      siteManagerUids = Object.entries(roles)
        .filter(([, role]) => role === 'admin' || role === 'editor')
        .map(([uid]) => uid)
    }
  }
  let orgName: string | null = null
  let orgSlug: string | null = null
  if (orgId) {
    const org = await firestore.collection('orgs').doc(orgId).get().catch(() => null)
    if (org?.exists) {
      orgName = String(org.get('name') ?? '') || null
      orgSlug = String(org.get('slug') ?? '') || null
    }
  }
  return { orgId, orgName, orgSlug, hostSubdomain, siteLabel, siteManagerUids }
}

/** What one notice email sends. */
export interface RenderedRiskNoticeEmail {
  key: string
  subject: string
  text: string
  html?: string
  /** The display name to send under; absent sends under the platform's. */
  fromName?: string
}

/**
 * The brand a kind's email is sent in: the workspace's own for a routine
 * notice about its customers' payments, the platform's for everything the
 * platform does (holds, locks, lifts, cancellations, reviews).
 */
export async function riskNoticeEmailBrand(
  kind: RiskEventKind | null,
  orgId: string | null,
): Promise<SystemEmailBrand> {
  return kind && RISK_NOTICE_WORKSPACE_BRANDED.has(kind)
    ? orgSystemEmailBrand(orgId)
    : systemEmailBrand(null)
}

/**
 * The product name a notice's own words use (`your Aglyn account`): the one
 * the email it rides in is branded with, so the sentence and the header
 * never disagree — the platform's for platform mail, a white-label
 * workspace's own for the notices sent in its brand.
 */
export function riskNoticeProductName(brand: SystemEmailBrand): string {
  return (
    String(brand.merge['brand.productName'] ?? '').trim() ||
    String(PLATFORM_BRAND_MERGE_TOKENS['brand.productName'] ?? '').trim()
  )
}

/**
 * Renders one notice email through the System emails seam (AGL-3367): the
 * published design for the kind's own `risk-…` key, or its built-in copy,
 * inside the header and footer every platform email wears. The plain-text
 * composition below is the last resort for a render that produced nothing.
 * ONE function, so every notice renders the same way.
 */
export async function renderRiskNoticeEmail(
  key: string,
  merge: Record<string, string>,
  brand: SystemEmailBrand = systemEmailBrand(null),
): Promise<RenderedRiskNoticeEmail> {
  const content = await renderSystemEmailContent(key, merge, brand, riskNoticeFallback(merge)).catch(
    () => riskNoticeFallback(merge),
  )
  return { key, ...content, ...(brand.fromName ? { fromName: brand.fromName } : {}) }
}

/** The notice as plain text, when no design renders. */
function riskNoticeFallback(merge: Record<string, string>): { subject: string; text: string } {
  const lines = [
    merge['notice.summary'],
    merge['notice.meaning'],
    merge['notice.steps'] ? `What to do next:\n${merge['notice.steps']}` : '',
    merge['notice.actions'],
    merge['reference'] ? `Reference: ${merge['reference']}` : '',
    merge['help.url'] ? `Why was something held or flagged? ${merge['help.url']}` : '',
  ].filter((line) => Boolean(line && line.trim()))
  return { subject: merge['notice.title'] ?? '', text: lines.join('\n\n') }
}

function numbered(steps: readonly string[]): string {
  return steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
}

function emptyDelivery(skipped: string | null = null): RiskNoticeDelivery {
  return {
    recipients: 0,
    inApp: 0,
    emailed: 0,
    emailFailed: 0,
    emailSkipped: skipped,
    digested: false,
  }
}

type BurstVerdict = { owners: 'deliver' | 'fold-first' | 'fold'; staff: 'deliver' | 'fold' }

/**
 * Count this notice against its workspace's hour and say whether it is
 * delivered now. Fails OPEN: a ledger that cannot be written never costs a
 * notice.
 */
async function countBurst(
  deps: RiskNoticeDeps,
  ledgerId: string,
  entry: { kind: RiskEventKind; title: string; noticeId: string; staffTitle: string; alertStaff: boolean },
): Promise<BurstVerdict> {
  const nowMs = deps.nowMs()
  const ref = deps.firestore.collection(RISK_NOTICE_LEDGER_COLLECTION).doc(ledgerId)
  try {
    return await deps.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const startedAtMs = Number(snapshot.get('windowStartedAtMs') ?? 0)
      const fresh = !startedAtMs || nowMs - startedAtMs >= RISK_NOTICE_BURST.windowMs
      const ownerCount = (fresh ? 0 : Number(snapshot.get('ownerCount') ?? 0)) + 1
      const staffCount =
        (fresh ? 0 : Number(snapshot.get('staffCount') ?? 0)) + (entry.alertStaff ? 1 : 0)
      const owners: BurstVerdict['owners'] =
        ownerCount <= RISK_NOTICE_BURST.owners
          ? 'deliver'
          : ownerCount === RISK_NOTICE_BURST.owners + 1
            ? 'fold-first'
            : 'fold'
      const staff: BurstVerdict['staff'] =
        staffCount <= RISK_NOTICE_BURST.staff ? 'deliver' : 'fold'
      const pendingOwners = Array.isArray(snapshot.get('pendingOwners'))
        ? (snapshot.get('pendingOwners') as unknown[])
        : []
      const pendingStaff = Array.isArray(snapshot.get('pendingStaff'))
        ? (snapshot.get('pendingStaff') as unknown[])
        : []
      // How many of each notice were folded, however many the list keeps.
      const tally = (field: string, title: string) => {
        const current = (snapshot.get(field) as Record<string, number> | undefined) ?? {}
        return { ...current, [title]: Number(current[title] ?? 0) + 1 }
      }
      transaction.set(
        ref,
        {
          ledgerId,
          ...(fresh ? { windowStartedAtMs: nowMs } : {}),
          ownerCount,
          staffCount,
          ...(owners !== 'deliver'
            ? {
                pendingOwners: [
                  ...pendingOwners,
                  { kind: entry.kind, title: entry.title, noticeId: entry.noticeId, atMs: nowMs },
                ].slice(-RISK_NOTICE_BURST.digestListMax),
                pendingOwnerTally: tally('pendingOwnerTally', entry.title),
                pendingOwnerCount: FieldValue.increment(1),
              }
            : {}),
          ...(entry.alertStaff && staff !== 'deliver'
            ? {
                pendingStaff: [
                  ...pendingStaff,
                  { kind: entry.kind, title: entry.staffTitle, noticeId: entry.noticeId, atMs: nowMs },
                ].slice(-RISK_NOTICE_BURST.digestListMax),
                pendingStaffTally: tally('pendingStaffTally', entry.staffTitle),
                pendingStaffCount: FieldValue.increment(1),
              }
            : {}),
          updatedAtMs: nowMs,
        },
        { merge: true },
      )
      return { owners, staff }
    })
  } catch (error) {
    console.error('[risk-notice] burst ledger unavailable — delivering', error)
    return { owners: 'deliver', staff: 'deliver' }
  }
}

/** Where the owner half goes: uids, and the addresses already in hand. */
async function ownerRecipients(
  deps: RiskNoticeDeps,
  input: RiskEventInput,
  siteManagerUids: readonly string[],
): Promise<{ uids: string[]; emails: Record<string, string | null> }> {
  const emails: Record<string, string | null> = {}
  const uids = new Set<string>()
  const definition = RISK_NOTICE_CATALOG[input.kind]
  if (input.recipients) {
    for (const recipient of input.recipients) {
      if (!recipient.uid) continue
      uids.add(recipient.uid)
      if (recipient.email) emails[recipient.uid] = recipient.email
    }
    return { uids: [...uids], emails }
  }
  if (input.kind === 'account-locked' || input.kind === 'account-unlocked') {
    if (input.userUid) uids.add(input.userUid)
  } else if (input.orgId) {
    const owners = await deps.listOwners(input.orgId).catch(() => [])
    for (const owner of owners) {
      uids.add(owner.uid)
      if (owner.email) emails[owner.uid] = owner.email
    }
  }
  // A closing kind is shared by openings with different audiences, so it
  // follows the one it closes: a site manager told a review opened is told
  // it closed.
  const audience = isRiskEventKind(input.openedAs) ? RISK_NOTICE_CATALOG[input.openedAs] : definition
  if (audience.includeSiteManagers) for (const uid of siteManagerUids) uids.add(uid)
  return { uids: [...uids], emails }
}

/**
 * How long a caller on a page render's path waits on a notice before it
 * carries on without the answer (AGL-3565). The notice is not canceled; it
 * finishes behind the page. A held page or redirect is held either way —
 * what is bounded is how long the visitor waits to be told so.
 */
export const RISK_NOTICE_RENDER_DEADLINE_MS = 8_000

/**
 * Tell the right people about one risk event. See the module header.
 * Never throws.
 */
export async function notifyRiskEvent(
  input: RiskEventInput,
  overrides: Partial<RiskNoticeDeps> = {},
): Promise<RiskNoticeResult> {
  const result: RiskNoticeResult = {
    noticeId: null,
    duplicate: false,
    owners: emptyDelivery(),
    staff: { alerted: false, digested: false },
    error: null,
  }
  if (!isRiskEventKind(input?.kind)) {
    result.error = `Unknown risk event kind: ${String(input?.kind)}`
    return result
  }
  let deps: RiskNoticeDeps
  try {
    deps = resolveDeps(overrides)
  } catch (error) {
    result.error = (error as Error)?.message ?? String(error)
    return result
  }
  const definition = RISK_NOTICE_CATALOG[input.kind]
  const nowMs = deps.nowMs()
  const occurredAtMs = Number.isFinite(input.occurredAtMs) ? Number(input.occurredAtMs) : nowMs
  const noticeId = riskNoticeId(riskNoticeDedupeKey(input, occurredAtMs))
  result.noticeId = noticeId

  try {
    const context = await readContext(deps.firestore, input)
    const orgId = context.orgId
    const event: RiskEventInput = { ...input, orgId }

    /*
     * The values the OWNER half renders with. `staff.evidence` is absent by
     * construction: the owner record and the owner channels never hold it.
     */
    const supportEmail = abuseReportContactEmail('support') ?? ''
    // The brand the email is sent in, read once: its product name is also a
    // word in the notice (an account lock says whose account it is).
    const brand = await riskNoticeEmailBrand(input.kind, orgId)
    const ownerValues: RiskNoticeValues = {
      'workspace.name': context.orgName,
      'site.label': context.siteLabel,
      'item.label': input.item?.label ?? null,
      occurredAt: formatRiskNoticeTime(occurredAtMs),
      reference: input.reference ?? null,
      'support.email': supportEmail || null,
      'lock.message': input.lock?.message ?? null,
      'lock.affected': input.lock?.affected ?? null,
      amount: input.amount ?? null,
      'payment.event': input.paymentEvent ?? null,
      'evidence.dueBy': input.evidenceDueByMs ? formatRiskNoticeTime(input.evidenceDueByMs) : null,
      'payout.delay': input.payout ? riskPayoutDelayText(input.payout) : null,
      'page.visitors': input.page ? heldPageVisitorSentence(input.page) : null,
      'brand.productName': riskNoticeProductName(brand) || null,
    }
    const staffValues: RiskNoticeValues = {
      ...ownerValues,
      'workspace.name': context.orgName ?? orgId,
      'staff.evidence': input.staffEvidence ?? null,
    }
    const actionParams: RiskActionParams = {
      itemPath: input.item?.path ?? null,
      noticeId,
      reviewId: input.reviewId ?? null,
      orgId,
      hostId: input.hostId ?? null,
      stripeUrl: input.stripeUrl ?? null,
      lockScope: input.lock?.scope ?? null,
      lockTargetId: input.lock?.targetId ?? null,
    }
    const owner = renderOwnerRiskNotice(input.kind, ownerValues)
    const staff = renderStaffRiskNotice(input.kind, staffValues)

    // ONE notice per dedupe key: `create` refuses a second.
    const noticeRef = deps.firestore.collection(RISK_NOTICE_COLLECTION).doc(noticeId)
    try {
      await noticeRef.create({
        kind: input.kind,
        severity: definition.severity,
        orgId,
        hostId: input.hostId ?? null,
        userUid: input.userUid ?? null,
        reviewId: input.reviewId ?? null,
        reference: input.reference ?? null,
        // What the owner surface renders, and nothing staff-only.
        ownerValues: stripEmpty(ownerValues),
        actionParams: stripEmpty(actionParams as Record<string, string | null | undefined>),
        occurredAtMs,
        createdAtMs: nowMs,
        createdAt: FieldValue.serverTimestamp(),
        ...(input.page ? { page: input.page } : {}),
      })
    } catch (error) {
      if (isAlreadyExists(error)) {
        result.duplicate = true
        return result
      }
      throw error
    }

    // A row-backed notice stamps the row, so the staff queue renders the
    // catalog's text and actions and the owner surface finds the row.
    if (input.reviewId && !RISK_NOTICE_CLOSING_KINDS.has(input.kind)) {
      await deps.firestore
        .collection(ABUSE_REPORT_COLLECTION)
        .doc(input.reviewId)
        .set(
          {
            riskNotice: {
              kind: input.kind,
              noticeId,
              itemLabel: input.item?.label ?? null,
              itemPath: input.item?.path ?? null,
              stripeUrl: input.stripeUrl ?? null,
              ownersNotifiedAtMs: nowMs,
            },
          },
          { merge: true },
        )
        .catch((error: unknown) =>
          console.error('[risk-notice] could not stamp the abuse row', error),
        )
    }

    // Anything folded in an hour that has now closed goes first.
    const ledgerId = ledgerIdFor(event)
    if (ledgerId) await flushLedger(deps, ledgerId).catch(() => undefined)

    const verdict: BurstVerdict =
      definition.neverDigest || !ledgerId
        ? { owners: 'deliver', staff: 'deliver' }
        : await countBurst(deps, ledgerId, {
            kind: input.kind,
            title: owner.title,
            staffTitle: staff.title,
            noticeId,
            alertStaff: definition.alertStaff,
          })

    // ---- The owners and admins ----
    const recipients = await ownerRecipients(deps, event, context.siteManagerUids)
    result.owners.recipients = recipients.uids.length
    const ownerActions = resolveOwnerRiskActions(input.kind, actionParams)
    const primary = ownerActions.find((action) => action.id === 'request-review') ?? ownerActions[0]
    if (verdict.owners === 'deliver') {
      if (recipients.uids.length) {
        await deps.notifyUsers(
          recipients.uids,
          {
            type: RISK_NOTICE_NOTIFICATION_TYPE,
            title: owner.title,
            body: `${owner.summary} ${owner.meaning}`.slice(0, 1000),
            level: RISK_NOTICE_LEVELS[definition.severity],
            link: primary?.href ?? riskHoldsPath(noticeId),
            ...(orgId ? { orgId } : {}),
            ...(input.hostId ? { hostId: input.hostId } : {}),
          },
          { emails: recipients.emails },
        )
        result.owners.inApp = recipients.uids.length
      }
      if (!definition.emailOwners) {
        result.owners.emailSkipped = 'This kind is not emailed.'
      } else if (input.emailOwners === false) {
        result.owners.emailSkipped = 'Staff chose not to email the owners for this event.'
      } else if (!recipients.uids.length) {
        result.owners.emailSkipped = 'Nobody to email: the workspace has no owner or admin on record.'
      } else {
        const merge = emailMerge({
          title: owner.title,
          summary: owner.summary,
          meaning: owner.meaning,
          steps: owner.steps,
          actions: ownerActions,
          context: { orgSlug: context.orgSlug, hostId: input.hostId ?? null, hostSubdomain: context.hostSubdomain },
          reference: input.reference ?? null,
          helpAnchor: definition.helpAnchor,
          workspaceName: context.orgName,
          lockMessage: input.lock?.message ?? null,
        })
        const rendered = await renderRiskNoticeEmail(riskNoticeEmailKey(input.kind), merge, brand)
        const delivery = await emailPeople(deps, recipients, rendered, supportEmail, {
          lockNotice: LOCK_NOTICE_KINDS.has(input.kind),
        })
        result.owners.emailed = delivery.sent
        result.owners.emailFailed = delivery.failed
        if (!delivery.sent && !delivery.failed) {
          result.owners.emailSkipped = 'No recipient has an email address on record.'
        }
      }
    } else {
      result.owners.digested = true
      if (verdict.owners === 'fold-first' && recipients.uids.length) {
        await deps.notifyUsers(
          recipients.uids,
          {
            type: RISK_NOTICE_NOTIFICATION_TYPE,
            title: 'More account notices are arriving',
            level: 'warning',
            body:
              'Several items on your workspace were held or flagged in the last hour. ' +
              'We will send one summary instead of a message for each. Every item is listed on Holds & reviews.',
            link: riskHoldsPath(),
            ...(orgId ? { orgId } : {}),
          },
          { emails: recipients.emails },
        )
        result.owners.inApp = recipients.uids.length
      }
    }

    // ---- Staff ----
    if (definition.alertStaff) {
      if (verdict.staff === 'deliver') {
        await deps.notifyStaff({
          type: 'system.abuseReportUrgent',
          title: staff.title,
          body: staff.summary.slice(0, 1000),
          link: input.reviewId ? staffAbuseRowPath(input.reviewId) : '/admin/abuse-reports',
        })
        result.staff.alerted = true
      } else {
        result.staff.digested = true
      }
    }

    await noticeRef
      .set({ delivery: { owners: result.owners, staff: result.staff } }, { merge: true })
      .catch(() => undefined)
    return result
  } catch (error) {
    console.error('[risk-notice] a notice could not be delivered', error)
    result.error = (error as Error)?.message ?? String(error)
    return result
  }
}

function stripEmpty<T extends Record<string, string | null | undefined>>(values: T): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value) out[key] = value
  }
  return out
}

function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS'
}

/** The flat merge map a notice email renders with. */
function emailMerge(input: {
  title: string
  summary: string
  meaning: string
  steps: readonly string[]
  actions: readonly ResolvedRiskAction[]
  context: { orgSlug: string | null; hostId: string | null; hostSubdomain: string | null }
  reference: string | null
  helpAnchor: string
  workspaceName: string | null
  lockMessage: string | null
}): Record<string, string> {
  const links = input.actions.flatMap((action) => {
    const path = emailPath(action.href, input.context)
    const url = path ? absolute(path) : ''
    return url ? [{ label: action.label, url }] : []
  })
  const primary = links.find((link) => link.label === 'Request a review') ?? links[0]
  const holdsPath = emailPath(riskHoldsPath(), input.context)
  return {
    'notice.title': input.title,
    'notice.summary': input.summary,
    'notice.meaning': input.meaning,
    'notice.steps': numbered(input.steps),
    'notice.actions': links.map((link) => `${link.label}: ${link.url}`).join('\n'),
    'notice.primaryActionLabel': primary?.label ?? '',
    'notice.primaryActionUrl': primary?.url ?? '',
    'workspace.name': input.workspaceName ?? '',
    'lock.message': input.lockMessage ?? '',
    reference: input.reference ?? '',
    'holds.url': holdsPath ? absolute(holdsPath) : '',
    'help.url': riskNoticeHelpUrl(input.helpAnchor),
  }
}

/**
 * The notices a banned account still receives (AGL-3420): the lock and lift
 * notices, the only mail that tells it what happened. Everything else —
 * digests, reviews, sale warnings — is refused like any other sender's.
 */
const LOCK_NOTICE_KINDS: ReadonlySet<string> = new Set<RiskEventKind>([
  'workspace-locked',
  'workspace-unlocked',
  'site-locked',
  'site-unlocked',
  'domain-locked',
  'domain-unlocked',
  'account-locked',
  'account-unlocked',
])

/**
 * One email per person — two owners have not agreed to see each other's
 * addresses. Platform sender, transactional, owed for the account.
 */
async function emailPeople(
  deps: RiskNoticeDeps,
  recipients: { uids: string[]; emails: Record<string, string | null> },
  rendered: RenderedRiskNoticeEmail,
  supportEmail: string,
  options: { lockNotice?: boolean } = {},
): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0
  const seen = new Set<string>()
  for (const uid of recipients.uids.slice(0, 50)) {
    const address = String(
      recipients.emails[uid] ?? (await deps.lookupEmail(uid).catch(() => null)) ?? '',
    )
      .trim()
      .toLowerCase()
    if (!address.includes('@') || seen.has(address)) continue
    seen.add(address)
    const outcome = await deps
      .sendEmail({
        to: address,
        subject: rendered.subject,
        text: rendered.text,
        ...(rendered.html ? { html: rendered.html } : {}),
        ...(rendered.fromName ? { fromName: rendered.fromName } : {}),
        ...(supportEmail ? { replyTo: supportEmail } : {}),
        context: 'risk-notice',
        owedFor: 'account',
        ...(options.lockNotice ? { accountBanExempt: true } : {}),
      })
      .catch((error: unknown) => ({ sent: false as const, reason: 'provider-error' as const, detail: String(error) }))
    if (outcome.sent) {
      sent += 1
      // The platform's own account mail: its cost is the platform's, whatever
      // workspace it is about (AGL-1438).
      await meterPlatformEmail().catch(() => undefined)
    } else failed += 1
  }
  return { sent, failed }
}

/**
 * Send one ledger's digest if its hour has closed and anything was folded.
 * Returns whether a digest went out.
 */
async function flushLedger(deps: RiskNoticeDeps, ledgerId: string): Promise<boolean> {
  const nowMs = deps.nowMs()
  const ref = deps.firestore.collection(RISK_NOTICE_LEDGER_COLLECTION).doc(ledgerId)
  const taken = await deps.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return null
    const startedAtMs = Number(snapshot.get('windowStartedAtMs') ?? 0)
    const ownerCount = Number(snapshot.get('pendingOwnerCount') ?? 0)
    const staffCount = Number(snapshot.get('pendingStaffCount') ?? 0)
    if (!ownerCount && !staffCount) return null
    if (startedAtMs && nowMs - startedAtMs < RISK_NOTICE_BURST.windowMs) return null
    transaction.set(
      ref,
      {
        pendingOwners: [],
        pendingStaff: [],
        pendingOwnerCount: 0,
        pendingStaffCount: 0,
        // Deleted rather than set to `{}`: a merge leaves an existing map's
        // keys in place when handed an empty one.
        pendingOwnerTally: FieldValue.delete(),
        pendingStaffTally: FieldValue.delete(),
        ownerCount: 0,
        staffCount: 0,
        windowStartedAtMs: 0,
        lastDigestAtMs: nowMs,
      },
      { merge: true },
    )
    return {
      owners: (snapshot.get('pendingOwnerTally') as Record<string, number> | undefined) ?? {},
      staff: (snapshot.get('pendingStaffTally') as Record<string, number> | undefined) ?? {},
      ownerCount,
      staffCount,
    }
  })
  if (!taken) return false
  const [scope, id] = [ledgerId.slice(0, ledgerId.indexOf(':')), ledgerId.slice(ledgerId.indexOf(':') + 1)]
  const orgId = scope === 'org' ? id : null
  const summarize = (tally: Record<string, number>, count: number) => {
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1])
    const lines = entries
      .slice(0, RISK_NOTICE_BURST.digestListMax)
      .map(([title, n]) => `• ${title}${n > 1 ? ` (${n})` : ''}`)
    const listed = entries
      .slice(0, RISK_NOTICE_BURST.digestListMax)
      .reduce((total, [, n]) => total + n, 0)
    if (count > listed) lines.push(`• …and ${count - listed} more`)
    return lines.join('\n')
  }
  // The workspace by name, for both halves: staff read a digest about
  // `Harbor View`, not about a ledger key.
  const context = orgId
    ? await readContext(deps.firestore, { kind: 'email-held', orgId })
    : { orgName: null, orgSlug: null }
  if (taken.ownerCount > 0) {
    const recipients =
      scope === 'user'
        ? { uids: [id], emails: {} as Record<string, string | null> }
        : orgId
          ? await ownerRecipients(deps, { kind: 'email-held', orgId }, [])
          : { uids: [] as string[], emails: {} as Record<string, string | null> }
    const title = `Summary: more notices about ${context.orgName ?? 'your workspace'} in the last hour`
    const summary = summarize(taken.owners, taken.ownerCount)
    if (recipients.uids.length) {
      await deps.notifyUsers(
        recipients.uids,
        {
          type: RISK_NOTICE_NOTIFICATION_TYPE,
          title,
          body: summary.slice(0, 1000),
          level: 'warning',
          link: riskHoldsPath(),
          ...(orgId ? { orgId } : {}),
        },
        { emails: recipients.emails },
      )
      const holdsPath = emailPath(riskHoldsPath(), {
        orgSlug: context.orgSlug,
        hostId: null,
        hostSubdomain: null,
      })
      const rendered = await renderRiskNoticeEmail(RISK_NOTICE_DIGEST_EMAIL_KEY, {
        'notice.title': title,
        'notice.summary': renderRiskNoticeText(
          'In the last hour, {{workspace.name}} had more notices than we send one by one. Each one, with its status and anything that is due, is listed on Holds & reviews. By title:',
          { 'workspace.name': context.orgName },
        ),
        'notice.meaning': summary,
        'notice.steps': numbered([
          'Open Holds & reviews to see each item, its status and what to do.',
          'If any of them is a mistake, choose Request a review on it.',
        ]),
        'notice.actions': holdsPath && absolute(holdsPath) ? `View holds and reviews: ${absolute(holdsPath)}` : '',
        'holds.url': holdsPath ? absolute(holdsPath) : '',
        'help.url': riskNoticeHelpUrl(),
        reference: '',
        'workspace.name': context.orgName ?? '',
      })
      await emailPeople(deps, recipients, rendered, abuseReportContactEmail('support') ?? '')
    }
  }
  if (taken.staffCount > 0) {
    const about = context.orgName
      ? `workspace ${context.orgName} (${orgId})`
      : scope === 'user'
        ? `account ${id}`
        : scope === 'host'
          ? `site ${id}`
          : ledgerId
    await deps.notifyStaff({
      type: 'system.abuseReportUrgent',
      title: `Digest: ${taken.staffCount} more risk alerts on ${context.orgName ?? ledgerId}`,
      body: (
        `${taken.staffCount} more risk alerts on ${about} arrived in the last hour ` +
        `and were batched here instead of sent one by one:\n` +
        summarize(taken.staff, taken.staffCount)
      ).slice(0, 1000),
      link: '/admin/abuse-reports',
    })
  }
  return true
}

/**
 * Send every digest whose hour has closed (the hourly cron). Returns how
 * many went out. Never throws.
 */
export async function flushRiskNoticeDigests(
  overrides: Partial<RiskNoticeDeps> = {},
): Promise<{ flushed: number; failed: number }> {
  const deps = resolveDeps(overrides)
  const cutoff = deps.nowMs() - RISK_NOTICE_BURST.windowMs
  let flushed = 0
  let failed = 0
  try {
    const snapshot = await deps.firestore
      .collection(RISK_NOTICE_LEDGER_COLLECTION)
      .where('windowStartedAtMs', '<=', cutoff)
      .where('windowStartedAtMs', '>', 0)
      .limit(200)
      .get()
    for (const doc of snapshot.docs) {
      try {
        if (await flushLedger(deps, doc.id)) flushed += 1
      } catch (error) {
        failed += 1
        console.error('[risk-notice] a digest could not be sent', error)
      }
    }
  } catch (error) {
    console.error('[risk-notice] the digest sweep failed', error)
    failed += 1
  }
  return { flushed, failed }
}

/**
 * The closing notice for a row staff decided: the kind the row's opening
 * notice names in `closesWith`, sent to the same people about the same item.
 * Silent (returns null) for a row with no risk notice or a kind that does
 * not close. Never throws.
 */
export async function closeRiskNotice(
  input: { reviewId: string; decision: 'released' | 'rejected' },
  overrides: Partial<RiskNoticeDeps> = {},
): Promise<RiskNoticeResult | null> {
  try {
    const deps = resolveDeps(overrides)
    const row = await deps.firestore.collection(ABUSE_REPORT_COLLECTION).doc(input.reviewId).get()
    const stamp = row.get('riskNotice') as
      | { kind?: string; noticeId?: string; itemLabel?: string | null; itemPath?: string | null }
      | undefined
    if (!stamp?.kind || !isRiskEventKind(stamp.kind)) return null
    const closing = RISK_NOTICE_CATALOG[stamp.kind].closesWith?.[input.decision]
    if (!closing) return null
    return await notifyRiskEvent(
      {
        kind: closing,
        orgId: (row.get('orgId') as string | null) ?? null,
        hostId: (row.get('hostId') as string | null) ?? null,
        reviewId: input.reviewId,
        reference: (row.get('reference') as string | null) ?? null,
        item: stamp.itemLabel ? { label: stamp.itemLabel, path: stamp.itemPath ?? null } : null,
        dedupeKey: `${closing}:${input.reviewId}`,
        openedAs: stamp.kind,
      },
      overrides,
    )
  } catch (error) {
    console.error('[risk-notice] the closing notice failed', error)
    return null
  }
}

/** A review request as it is stored on the abuse-queue row. */
export interface RiskReviewRequest {
  atMs: number
  uid: string
  email: string | null
  note: string
  noticeId: string
}

export type RiskReviewRequestOutcome =
  | { ok: true; reference: string | null; requestedAtMs: number }
  | { ok: false; status: 400 | 404 | 409 | 429; error: string }

/**
 * An owner or admin asks for a review of a held or flagged item.
 *
 * APPENDS to the item's existing abuse-queue row — never a new row, and
 * never a decision: the row's `status` and its `heldSend` are not written
 * here, so no request can release a hold or lift a lock. Staff see the
 * request as a note on the row, and are notified with a link to it.
 */
export async function requestRiskReview(
  input: { orgId: string; noticeId: string; uid: string; email: string | null; note: string },
  overrides: Partial<RiskNoticeDeps> = {},
): Promise<RiskReviewRequestOutcome> {
  const deps = resolveDeps(overrides)
  const note = String(input.note ?? '').trim().slice(0, RISK_REVIEW_NOTE_MAX)
  if (note.length < 10) {
    return { ok: false, status: 400, error: 'Tell us a little about it — at least a sentence.' }
  }
  const notice = await deps.firestore.collection(RISK_NOTICE_COLLECTION).doc(input.noticeId).get()
  if (!notice.exists || notice.get('orgId') !== input.orgId) {
    return { ok: false, status: 404, error: 'No such notice on this workspace.' }
  }
  const kind = notice.get('kind')
  const reviewId = String(notice.get('reviewId') ?? '')
  if (!isRiskEventKind(kind) || !RISK_NOTICE_CATALOG[kind].reviewable || !reviewId) {
    return { ok: false, status: 409, error: 'This notice has nothing to review. Contact support instead.' }
  }
  const nowMs = deps.nowMs()
  const rowRef = deps.firestore.collection(ABUSE_REPORT_COLLECTION).doc(reviewId)
  const outcome = await deps.firestore.runTransaction(async (transaction) => {
    const row = await transaction.get(rowRef)
    if (!row.exists || row.get('orgId') !== input.orgId) return 'missing' as const
    const requests = (
      Array.isArray(row.get('ownerReviewRequests')) ? row.get('ownerReviewRequests') : []
    ) as RiskReviewRequest[]
    const last = requests[requests.length - 1]
    if (last && nowMs - Number(last.atMs ?? 0) < RISK_REVIEW_REQUEST_COOLDOWN_MS) {
      return 'cooldown' as const
    }
    const entry: RiskReviewRequest = {
      atMs: nowMs,
      uid: input.uid,
      email: input.email,
      note,
      noticeId: input.noticeId,
    }
    // Only these three fields. Never `status`, never `heldSend`.
    transaction.set(
      rowRef,
      {
        ownerReviewRequests: [...requests, entry].slice(-RISK_REVIEW_REQUESTS_MAX),
        reviewRequestedAtMs: nowMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return { reference: (row.get('reference') as string | null) ?? null }
  })
  if (outcome === 'missing') {
    return { ok: false, status: 404, error: 'The case for this notice is gone. Contact support instead.' }
  }
  if (outcome === 'cooldown') {
    return {
      ok: false,
      status: 429,
      error: 'We already have a request on this. You can add another in a few minutes.',
    }
  }
  // What the request is about, by name, for staff and for the person who
  // asked: the item in the owner's words and the workspace.
  const itemLabel =
    String((notice.get('ownerValues') as RiskNoticeValues | undefined)?.['item.label'] ?? '').trim() ||
    null
  const org = await deps.firestore
    .collection('orgs')
    .doc(input.orgId)
    .get()
    .catch(() => null)
  const orgName = String(org?.get('name') ?? '').trim() || null
  const orgSlug = String(org?.get('slug') ?? '').trim() || null
  await deps.notifyStaff({
    type: 'system.abuseReportUrgent',
    title: `Review requested${outcome.reference ? ` — ${outcome.reference}` : ''}`,
    body:
      `An owner or admin of ${orgName ? `${orgName} (${input.orgId})` : `workspace ${input.orgId}`} ` +
      `asked for a review of ${itemLabel ?? 'a held or flagged item'} (${kind}): "${note.slice(0, 280)}"`,
    link: staffAbuseRowPath(reviewId),
  })
  // The person who asked is told it arrived — account mail, platform brand.
  if (input.email) {
    const holdsPath = emailPath(riskHoldsPath(input.noticeId), {
      orgSlug,
      hostId: null,
      hostSubdomain: null,
    })
    const holdsUrl = holdsPath ? absolute(holdsPath) : ''
    const about = `${itemLabel ?? 'the held or flagged item'}${orgName ? ` on ${orgName}` : ''}`
    const rendered = await renderRiskNoticeEmail(RISK_REVIEW_REQUESTED_EMAIL_KEY, {
      'notice.title': 'We received your review request',
      'notice.summary':
        `We received your request to review ${about}` +
        (outcome.reference ? ` (reference ${outcome.reference})` : '') +
        '. A person on our review team reads every request.',
      'notice.meaning':
        'Nothing changes until the review is done, and you will get a notice either way.',
      'notice.steps': numbered([
        'Nothing more is needed.',
        'You can follow its status on Holds & reviews.',
      ]),
      'notice.actions': holdsUrl ? `View holds and reviews: ${holdsUrl}` : '',
      'notice.primaryActionLabel': holdsUrl ? 'View holds and reviews' : '',
      'notice.primaryActionUrl': holdsUrl,
      'holds.url': holdsUrl,
      'workspace.name': orgName ?? '',
      reference: outcome.reference ?? '',
      'help.url': riskNoticeHelpUrl('requesting-a-review'),
    })
    await emailPeople(
      deps,
      { uids: [input.uid], emails: { [input.uid]: input.email } },
      rendered,
      abuseReportContactEmail('support') ?? '',
    ).catch(() => undefined)
  }
  return { ok: true, reference: outcome.reference, requestedAtMs: nowMs }
}

/** One owner notice, as the Holds & reviews page renders it. */
export interface OwnerRiskNoticeView {
  noticeId: string
  kind: RiskEventKind
  severity: string
  title: string
  summary: string
  meaning: string
  steps: string[]
  actions: ResolvedRiskAction[]
  reference: string | null
  occurredAtMs: number
  helpUrl: string
  /** The review state, for a notice with a row. */
  status: 'held' | 'in-review' | 'released' | 'rejected' | 'closed' | null
  reviewable: boolean
  reviewRequests: Array<{ atMs: number; note: string; mine: boolean }>
  /** A page notice: the page by name, where it lives, and what visitors see (AGL-3374). */
  page: OwnerPageHoldFacts | null
}

/** A page notice's facts, as every owner surface renders them (AGL-3374). */
export interface OwnerPageHoldFacts {
  /** `the "Video detail" template (/videos/:slug)`. */
  label: string
  /** Where it was seen, and the layout or component the content lives in. */
  details: string[]
  /** What visitors receive meanwhile. */
  visitorSentence: string
  /** The page, and the layout or component, the hold is shown on. */
  targets: HeldPageTarget[]
}

/**
 * A page notice's facts from its stored subject, or — for a notice written
 * before notices carried one — from its label and item path. Pure.
 */
export function ownerPageHoldFacts(
  kind: string,
  notice: { page?: unknown; ownerValues?: unknown; actionParams?: unknown },
): OwnerPageHoldFacts | null {
  if (!isPageHoldNoticeKind(kind)) return null
  const subject = notice.page as HeldPageSubject | undefined
  if (subject && typeof subject === 'object' && subject.screenId) {
    return {
      label: heldPageLabel(subject),
      details: heldPageDetails(subject),
      visitorSentence: heldPageVisitorSentence(subject),
      targets: heldPageTargets(subject),
    }
  }
  const values = (notice.ownerValues ?? {}) as Record<string, string | undefined>
  const params = (notice.actionParams ?? {}) as Record<string, string | undefined>
  const parsed = parseHeldPageItemPath(params.itemPath)
  return {
    label: values['item.label'] || 'a page on your site',
    details: [],
    visitorSentence:
      kind === 'page-flagged'
        ? heldPageVisitorSentence({ visitorView: 'live' })
        : 'Visitors see the previous version of this page, or a not-found page if it was never published, until the review is done.',
    targets: parsed ? [{ type: 'screen', id: parsed.screenId }] : [],
  }
}

/** One open page hold on a site, as the site's console surfaces show it (AGL-3374). */
export interface PageHoldView extends OwnerPageHoldFacts {
  noticeId: string
  kind: PageHoldNoticeKind
  status: OwnerRiskNoticeView['status']
  /** The status chip. Never paired with a release control. */
  chip: { label: string; color: 'warning' | 'error' | 'info' }
  reference: string | null
  occurredAtMs: number
  /** Whether a review can be requested on it (the viewer's role decides the rest). */
  reviewable: boolean
  /** When anyone on the workspace last asked for a review, if they did. */
  reviewRequestedAtMs: number | null
}

/**
 * Every page on a site that is held, flagged or not approved (AGL-3374): the
 * `riskNotices` of the two page kinds for this host, newest first — one
 * query on (`hostId`, `kind`, `createdAtMs`), which
 * `cloud/firebase-firestore.indexes.json` holds — and each notice's row for
 * its state. A released or cleared page is not listed.
 */
export async function listHostPageHolds(
  input: { hostId: string; limit?: number },
  overrides: Partial<RiskNoticeDeps> = {},
): Promise<PageHoldView[]> {
  const deps = resolveDeps(overrides)
  const snapshot = await deps.firestore
    .collection(RISK_NOTICE_COLLECTION)
    .where('hostId', '==', input.hostId)
    .where('kind', 'in', [...PAGE_HOLD_NOTICE_KINDS])
    .orderBy('createdAtMs', 'desc')
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 100))
    .get()
  const reviewIds = [
    ...new Set(snapshot.docs.map((doc) => String(doc.get('reviewId') ?? '')).filter(Boolean)),
  ]
  const rows = new Map<string, FirebaseFirestore.DocumentSnapshot>()
  if (reviewIds.length) {
    const read = await deps.firestore.getAll(
      ...reviewIds.map((id) => deps.firestore.collection(ABUSE_REPORT_COLLECTION).doc(id)),
    )
    for (const row of read) rows.set(row.id, row)
  }
  const views: PageHoldView[] = []
  const seenRows = new Set<string>()
  for (const doc of snapshot.docs) {
    const kind = doc.get('kind')
    if (!isPageHoldNoticeKind(kind)) continue
    const reviewId = String(doc.get('reviewId') ?? '')
    // One entry per case: a row re-notified keeps its newest notice.
    if (reviewId && seenRows.has(reviewId)) continue
    if (reviewId) seenRows.add(reviewId)
    const row = reviewId ? rows.get(reviewId) : undefined
    const status = row?.exists ? ownerRowStatus(row) : kind === 'page-flagged' ? 'in-review' : 'held'
    if (!isOpenPageHoldStatus(status)) continue
    const facts = ownerPageHoldFacts(kind, {
      page: doc.get('page'),
      ownerValues: doc.get('ownerValues'),
      actionParams: doc.get('actionParams'),
    })
    if (!facts) continue
    views.push({
      ...facts,
      noticeId: doc.id,
      kind,
      status,
      chip: pageHoldChip(kind, status),
      reference: (doc.get('reference') as string | null) ?? null,
      occurredAtMs: Number(doc.get('occurredAtMs') ?? doc.get('createdAtMs') ?? 0),
      reviewable: RISK_NOTICE_CATALOG[kind].reviewable && Boolean(row?.exists),
      reviewRequestedAtMs:
        typeof row?.get('reviewRequestedAtMs') === 'number'
          ? (row.get('reviewRequestedAtMs') as number)
          : null,
    })
  }
  return views
}

/**
 * The workspace's notices, newest first, rendered for its owners: the
 * catalog's owner half only, and the row's decision state — never its
 * evidence, never its staff notes.
 */
export async function listOwnerRiskNotices(
  input: { orgId: string; viewerUid: string; limit?: number },
  overrides: Partial<RiskNoticeDeps> = {},
): Promise<OwnerRiskNoticeView[]> {
  const deps = resolveDeps(overrides)
  const snapshot = await deps.firestore
    .collection(RISK_NOTICE_COLLECTION)
    .where('orgId', '==', input.orgId)
    .orderBy('createdAtMs', 'desc')
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 100))
    .get()
  const reviewIds = [
    ...new Set(
      snapshot.docs.map((doc) => String(doc.get('reviewId') ?? '')).filter(Boolean),
    ),
  ]
  const rows = new Map<string, FirebaseFirestore.DocumentSnapshot>()
  if (reviewIds.length) {
    const read = await deps.firestore.getAll(
      ...reviewIds.map((id) => deps.firestore.collection(ABUSE_REPORT_COLLECTION).doc(id)),
    )
    for (const row of read) rows.set(row.id, row)
  }
  // The reader's own console paths: the org's slug and each site's
  // subdomain, read once for the page rather than per notice.
  const org = await deps.firestore.collection('orgs').doc(input.orgId).get()
  const orgSlug = String(org.get('slug') ?? '') || null
  const hostIds = [
    ...new Set(snapshot.docs.map((doc) => String(doc.get('hostId') ?? '')).filter(Boolean)),
  ]
  const subdomains = new Map<string, string | null>()
  if (hostIds.length) {
    const hosts = await deps.firestore.getAll(
      ...hostIds.map((id) => deps.firestore.collection('hosts').doc(id)),
    )
    for (const host of hosts) subdomains.set(host.id, String(host.get('subdomain') ?? '') || null)
  }
  const views: OwnerRiskNoticeView[] = []
  for (const doc of snapshot.docs) {
    const kind = doc.get('kind')
    if (!isRiskEventKind(kind)) continue
    const values = (doc.get('ownerValues') as RiskNoticeValues | undefined) ?? {}
    const params = (doc.get('actionParams') as RiskActionParams | undefined) ?? {}
    const definition = RISK_NOTICE_CATALOG[kind]
    const copy = renderOwnerRiskNotice(kind, values)
    const reviewId = String(doc.get('reviewId') ?? '')
    const row = reviewId ? rows.get(reviewId) : undefined
    const requests = (
      row && Array.isArray(row.get('ownerReviewRequests')) ? row.get('ownerReviewRequests') : []
    ) as RiskReviewRequest[]
    views.push({
      noticeId: doc.id,
      kind,
      severity: definition.severity,
      ...copy,
      actions: resolveOwnerRiskActions(kind, { ...params, noticeId: doc.id }).flatMap((action) => {
        const hostId = String(doc.get('hostId') ?? '') || null
        const href = emailPath(action.href, {
          orgSlug,
          hostId,
          hostSubdomain: hostId ? (subdomains.get(hostId) ?? null) : null,
        })
        return href ? [{ ...action, href }] : []
      }),
      reference: (doc.get('reference') as string | null) ?? null,
      occurredAtMs: Number(doc.get('occurredAtMs') ?? doc.get('createdAtMs') ?? 0),
      helpUrl: riskNoticeHelpUrl(definition.helpAnchor),
      status: row?.exists ? ownerRowStatus(row) : null,
      reviewable: definition.reviewable && Boolean(row?.exists),
      reviewRequests: requests
        .filter((request) => request.noticeId === doc.id)
        .map((request) => ({
          atMs: Number(request.atMs ?? 0),
          note: String(request.note ?? ''),
          mine: request.uid === input.viewerUid,
        })),
      page: ownerPageHoldFacts(kind, {
        page: doc.get('page'),
        ownerValues: values,
        actionParams: params,
      }),
    })
  }
  return views
}

/** A row's state in the owner's words. Pure. */
export function ownerRowStatus(
  row: Pick<FirebaseFirestore.DocumentSnapshot, 'get'>,
): OwnerRiskNoticeView['status'] {
  const held = row.get('heldSend') as { state?: string } | undefined
  if (held?.state === 'released') return 'released'
  if (held?.state === 'rejected') return 'rejected'
  const status = String(row.get('status') ?? 'open')
  if (status === 'dismissed') return held ? 'released' : 'closed'
  if (status === 'actioned') return held ? 'rejected' : 'closed'
  if (held?.state === 'held') return 'held'
  return 'in-review'
}
