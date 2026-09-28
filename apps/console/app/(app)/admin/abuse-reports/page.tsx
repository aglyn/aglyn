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
'use client'

/**
 * ABUSE REPORTS — the staff side of the intake queue (AGL-1964).
 *
 * Everything else in the takedown toolkit is a lever an operator pulls after
 * learning there is a problem: five lockdown scopes, media quarantine by
 * content digest, an audit trail. This page is the only surface that tells us
 * there IS a problem, and the reporter is usually not a customer — a bank's
 * fraud team, a browser vendor, Safe Browsing — whose alternative to reaching
 * us is a domain-level block on `*.aglyn.app`. So the queue is read as a
 * backlog with a clock on it, not a mailbox.
 *
 * Reads and writes both go through `/api/admin/abuse-reports` rather than a
 * client listener, because `abuseReports` is `allow write: if false` for every
 * client including this one and because the route owns REDACTION. See the
 * route's own header for why that boundary is there.
 *
 * ## Invariants this component must not break
 *
 * **The reported URL is never a link.** It is an attacker-supplied address for
 * a page somebody has told us is phishing or serving malware, and the browser
 * reading it is a staff session that can suspend any site on the platform. It
 * renders as selectable monospace text with a copy button and nothing else.
 * The intake already refuses non-http(s) schemes (`normalizeReportedUrl`), so
 * this is the second of two locks on the same door, held deliberately.
 *
 * **"Withheld from you" and "there was nobody" are different facts.** A
 * `support`-tier token gets `identityVisible: false` and null reporter fields;
 * an anonymous report gives every tier null fields too. `hasReporterContact`
 * separates them, and the page says which one it is rather than rendering the
 * same em-dash for both — only one of them means a follow-up question is
 * impossible.
 *
 * **A DMCA affirmation is a claim, not a finding.** The two statutory ticks
 * are rendered as what the reporter asserted under penalty of perjury. Nothing
 * here adjudicates the claim, and the page must never read as if we had.
 *
 * **Never claim a state it has not read back.** The route re-reads the
 * document after the write and returns `confirmed`; a `false` there is an
 * alarm, not a quiet success, and it is reported as NOT CONFIRMED — the same
 * read-back discipline the Lockdown and Disabled-files pages keep.
 *
 * **A count says what it counts.** The urgent backlog, the counter-notices
 * awaiting forward and the overdue restorations are the route's own queries
 * over the whole queue (`view=summary`), never a tally of the page on screen.
 * The one count that IS of the page — failed receipts — says "on this page",
 * because a queue that looks calm while it is behind is the failure mode this
 * whole arc exists to prevent.
 *
 * **The filters reach the whole queue.** Status and Category are clauses the
 * route puts on its Firestore query (AGL-3321), and both lists page by a
 * cursor; nothing here narrows the rows the route hands back. A combination
 * the query cannot hold is named above the list (`ListQueryNotices`) rather
 * than applied to some rows and not others.
 *
 * ## The §512 additions (AGL-1983), and their own invariants
 *
 * **The page does no date arithmetic.** Every instant in the counter-notice
 * block arrives computed by the route. A second implementation of the
 * statutory window is a second chance to disagree with the server about the
 * day a customer's site comes back, and the customer would live with
 * whichever one was wrong.
 *
 * **The window is shown, not just the date.** A restore date on its own asks
 * the operator to trust it. Rendering the earliest and latest instants either
 * side of it lets them SEE that our choice sits inside the range
 * §512(g)(2)(C) draws.
 *
 * **A counter-notice's URL is text too.** Same lock as the report rows, same
 * reason — the address came from outside and the reader is a session that can
 * suspend anything.
 *
 * **The confirmation names what happened to the SITE.** "Forwarded" alone
 * would let an operator believe a put-back was scheduled when the host was
 * not suspended and nothing was written. That misunderstanding ends with a
 * customer still locked out on the statutory date, so the snackbar and the
 * session log both carry the scheduling outcome.
 *
 * **A missing strike count is UNKNOWN, never zero.** The route looks up a
 * bounded number of accounts per page; past that it says so. A chip reading
 * "0 strikes" for an account nobody counted is how a repeat infringer looks
 * clean.
 *
 * **The repeat-infringer field appears only when the server has refused.**
 * Rendering it pre-emptively on every copyright row would turn the §512(i)
 * decision into a box people fill in reflexively, which is the opposite of
 * what "reasonably implemented" is asking for.
 */

import { ABUSE_REPORT_CATEGORIES, ABUSE_REPORT_STATUSES } from '@aglyn/aglyn'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import { ICON_VARIANT_SYMBOL_FLAG } from '@aglyn/shared-data-enums'
import { AppLink, CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  type ListFilterClause,
  upsertListFilterClause,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import {
  Alert,
  Button,
  Chip,
  Divider,
  LinearProgress,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffListPaginationControls from '../../../../components/staff-list-pagination.component'
import StaffOnly from '../../../../components/staff-only.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useStaffListQuery } from '../../../../hooks/use-staff-list-query'
import {
  ABUSE_REPORT_FILTER_FIELDS,
  ABUSE_REPORT_FILTER_HEADERS,
  ABUSE_REPORT_FILTER_OPTIONS,
} from '../../../../utils/abuse-report-list-query'

/**
 * The statutory block, exactly as the route hands it over. `signature` is the
 * reporter's real legal name, so it follows the identity redaction rather than
 * the notice rule and is null for a `support`-tier reader.
 */
interface ReportDmca {
  work: string | null
  signature: string | null
  goodFaith: boolean
  underPenalty: boolean
}

/**
 * Whether the submitter's emailed receipt left (AGL-2400).
 *
 * `null` is the third state and it means UNKNOWN — a row filed before the
 * intake recorded this. It is NOT a failure and must never render as one.
 */
type ReceiptStatus = 'sent' | 'failed' | null

/** One row of the queue — `rowPayload()` in /api/admin/abuse-reports. */
interface AbuseReportRow {
  id: string
  reference: string | null
  status: string
  category: string | null
  categoryLabel: string | null
  severity: string | null
  url: string | null
  reportedHostname: string | null
  hostId: string | null
  orgId: string | null
  details: string | null
  reportCount: number
  createdAtMs: number | null
  updatedAtMs: number | null
  /** Whether THIS reader is cleared to see who filed it. */
  identityVisible: boolean
  reporterEmail: string | null
  reporterName: string | null
  /** Whether a contactable reporter exists at all. Never redacted. */
  hasReporterContact: boolean
  /** Did the emailed receipt leave? `null` is UNKNOWN — see `receiptLine`. */
  receiptStatus: ReceiptStatus
  receiptReason: string | null
  receiptAttemptedAtMs: number | null
  dmca: ReportDmca | null
  resolution: string | null
  resolvedBy: string | null
  resolvedAtMs: number | null
  /**
   * The §512(i) verdict for the row's account — copyright rows only, and
   * only when the route looked the account up.
   */
  strike: RepeatInfringerRow | null
  /**
   * The account was past the page's lookup cap, so its count is UNKNOWN —
   * never to be rendered as zero.
   */
  strikeUnknown: boolean
  /** `outbound-screen` for a send the phishing screen held; null for intake. */
  source: string | null
  /** The held send, when the screen filed this row (AGL-3356). */
  heldSend: HeldSendRow | null
  /** A Stripe fraud signal, when the billing webhook filed this row (AGL-3356). */
  paymentSignal: PaymentSignalRow | null
  /** A seller's fraud pattern across its sales (AGL-3360). */
  sellerPattern: SellerPatternRow | null
  /**
   * The risk notice catalog's staff half (AGL-3368): what the staff alert
   * said, and every action as a deep link to its real control. Null for a
   * row from the public report form.
   */
  riskNotice: RiskNoticeRow | null
  /** What the workspace's owners asked, when they requested a review. */
  ownerReviewRequests: OwnerReviewRequestRow[]
  reviewRequestedAtMs: number | null
}

/** `riskNoticePayload()` in /api/admin/abuse-reports (AGL-3368). */
interface RiskNoticeRow {
  kind: string
  noticeId: string | null
  /** When the owners were told; null for a row filed before they were. */
  ownersNotifiedAtMs: number | null
  title: string
  summary: string
  reviewable: boolean
  actions: Array<{ id: string; label: string; hint: string; href: string }>
}

/** One owner review request, as a note on the row (AGL-3368). */
interface OwnerReviewRequestRow {
  atMs: number | null
  email: string | null
  note: string
}

/**
 * The staff actions that ARE this page's own status control. They are
 * rendered as buttons that set the row's status draft — Dismiss releases,
 * Actioned rejects — rather than as links back to the page.
 */
const RISK_DECISION_ACTIONS: Record<string, string> = {
  'staff-release': 'dismissed',
  'staff-reject': 'actioned',
}

/**
 * Several of one connected account's sales drew fraud warnings or disputes
 * (AGL-3360), as `sellerPatternPayload()` hands it over. Nothing was
 * refunded, canceled or paused.
 */
interface SellerPatternRow {
  sellerAccountId: string | null
  stripeAccountUrl: string | null
  chargeIds: string[]
  orgIds: string[]
  hostIds: string[]
  threshold: number | null
  windowDays: number | null
  livemode: boolean
}

/**
 * An early fraud warning, a Radar review or a dispute on a charge, as
 * `paymentSignalPayload()` hands it over. Nothing was refunded or canceled;
 * the row links the org's Subscription card, where staff decide.
 */
interface PaymentSignalRow {
  kind: string | null
  stripeObjectId: string | null
  chargeId: string | null
  paymentIntentId: string | null
  amountCents: number | null
  currency: string
  detail: string | null
  livemode: boolean
  subscriptionCard: string | null
  checks: {
    cvcCheck: string | null
    addressPostalCodeCheck: string | null
    cardCountry: string | null
    riskLevel: string | null
    threeDSecure: string | null
  } | null
}

const PAYMENT_SIGNAL_TITLES: Record<string, string> = {
  'early-fraud-warning': 'Stripe early fraud warning',
  'radar-review': 'Stripe Radar review opened',
  dispute: 'Card dispute opened',
}

/** `56.00 USD`, or a sentence saying nothing recorded the amount. */
function paymentSignalAmount(signal: PaymentSignalRow): string {
  return signal.amountCents === null
    ? 'amount not recorded'
    : `${(signal.amountCents / 100).toFixed(2)} ${signal.currency.toUpperCase()}`
}

/**
 * A campaign or automated email the outbound phishing screen held for review
 * (AGL-3356), as `heldSendPayload()` hands it over. Closing the row decides
 * it: dismissed releases the send, actioned rejects it.
 */
interface HeldSendRow {
  kind: string | null
  path: string | null
  subject: string | null
  fromName: string | null
  state: string
  ageDays: number | null
  heldAtMs: number | null
  decidedBy: string | null
  decidedAtMs: number | null
  reasons: string[]
}

/** What a held send's state means, in the words the reviewer acts on. */
function heldSendStateLine(held: HeldSendRow): string {
  const by = held.decidedBy ? ` by ${held.decidedBy}` : ''
  if (held.kind === 'page') {
    if (held.state === 'released') return `Released${by} — the page serves as published.`
    if (held.state === 'rejected') return `Rejected${by} — the page stays unserved.`
    return 'Held — the page serves its last clean version, or nothing. Dismiss this report (with a note) to release it, or mark it Actioned to reject it. Reviewing leaves it held.'
  }
  if (held.state === 'released') {
    return held.kind === 'message'
      ? `Released${by} — the site's next email carrying these signals sends.`
      : `Released${by} — it sends as composed.`
  }
  if (held.state === 'rejected') {
    return `Rejected${by} — it will not be sent.`
  }
  return 'Held — nothing has been sent. Dismiss this report (with a note) to release it, or mark it Actioned to reject it. Reviewing leaves it held.'
}

/** What the phishing screen held, as the row's heading names it. */
function heldSendKindLabel(kind: string | null): string {
  switch (kind) {
    case 'campaign':
      return 'Outbound campaign'
    case 'page':
      return 'Published page'
    case 'message':
      return 'Outbound email'
    default:
      return 'Outbound automated email'
  }
}

/**
 * One §512(g) counter-notice, as `counterNoticePayload()` hands it over
 * (AGL-1983).
 *
 * The clock fields arrive computed. The page deliberately does no date
 * arithmetic of its own — a second implementation of the statutory window is
 * a second chance to disagree with the route about the day a customer's site
 * comes back.
 */
interface CounterNoticeRow {
  id: string
  reference: string | null
  noticeReference: string | null
  status: string
  url: string | null
  reportedHostname: string | null
  hostId: string | null
  orgId: string | null
  material: string | null
  submissionCount: number
  receivedAtMs: number | null
  earliestRestoreMs: number | null
  restoreAtMs: number | null
  latestRestoreMs: number | null
  /** The deadline has passed and the put-back is still owed. */
  overdue: boolean
  awaitingRestoration: boolean
  identityVisible: boolean
  subscriberName: string | null
  subscriberEmail: string | null
  subscriberAddress: string | null
  subscriberPhone: string | null
  signature: string | null
  goodFaithMistake: boolean
  consentJurisdiction: boolean
  acceptService: boolean
  resolution: string | null
  resolvedBy: string | null
  forwardedAtMs: number | null
  restoredAtMs: number | null
  /** Did the emailed receipt leave? `null` is UNKNOWN — see `receiptLine`. */
  receiptStatus: ReceiptStatus
  receiptReason: string | null
  receiptAttemptedAtMs: number | null
}

/**
 * One row of the §512(i) strike ledger (AGL-2328).
 *
 * `syncStrikeLedger` has written every one of these fields since the ledger
 * existed, and its docblock says why withdrawal marks rather than deletes:
 * *"'Did we know, and when' is the question this queue exists to answer."*
 * The route projected `withdrawnAt` alone, so nothing could answer it — the
 * count reached the screen and the evidence for the count did not. A strike
 * count with no substantiation is not a repeat-infringer defence.
 */
interface StrikeLedgerRow {
  reportId: string | null
  url: string | null
  recordedAt: number | null
  recordedByEmail: string | null
  withdrawnAt: number | null
  withdrawnReason: string | null
  withdrawnByEmail: string | null
  /** Derived route-side so the list and the count cannot disagree. */
  standing: boolean
}

/** The §512(i) verdict for one org, as `repeatInfringerVerdict()` computed it. */
interface RepeatInfringerRow {
  strikes: number
  level: string
  decisionRequired: boolean
  consequence: string
  /** The rows behind `strikes`, newest first (AGL-2328). */
  ledger?: StrikeLedgerRow[]
}

/**
 * The queue's counts — `view=summary` on the route, each its own query over
 * the whole queue, so none of them describes only the page on screen.
 */
interface QueueSummary {
  /** Open reports in an urgent category. */
  openUrgent: number
  awaitingForward: number
  overdueRestorations: number
  /** More candidates than one read covers: the overdue count is a floor. */
  overdueAtLeast: boolean
  counterNoticeStatuses: string[]
  identityVisible: boolean
  actorRole: string
  readAtMs: number
}

/** The pending status change for one row, before it is posted. */
interface StatusDraft {
  status: string
  resolution: string
  /**
   * The answer to the repeat-infringer gate, when the route demanded one.
   *
   * Held in the draft rather than in a modal so it survives the operator
   * scrolling away to look at the account's other strikes — which is exactly
   * what somebody should do before answering it.
   */
  repeatInfringerDecision?: string
}

/** The pending transition for one counter-notice. */
interface CounterNoticeDraft {
  status: string
  resolution: string
}

/**
 * How loud a row should be. `urgent` is the tier where the cost of a slow
 * response is paid by somebody who is not our customer, so it gets a filled
 * error chip and a banner rather than a colour an operator can skim past.
 */
const SEVERITY_COLOR: Record<string, 'error' | 'warning' | 'default'> = {
  urgent: 'error',
  high: 'warning',
  normal: 'default',
}

const SEVERITY_LABEL: Record<string, string> = {
  urgent: 'URGENT',
  high: 'High',
  normal: 'Normal',
}

/** Where a status sits in the workflow, for the chip beside the row. */
const STATUS_COLOR: Record<string, 'info' | 'warning' | 'success' | 'default'> =
  {
    open: 'warning',
    reviewing: 'info',
    actioned: 'success',
    dismissed: 'default',
  }

/**
 * The one-line hint the reporter read under each category label. The row
 * carries `categoryLabel` but not the hint, and the hint is what tells a
 * triaging operator what the reporter thought they were reporting.
 */
const CATEGORY_HINT = Object.fromEntries(
  ABUSE_REPORT_CATEGORIES.map((entry) => [entry.id, entry.hint]),
) as Record<string, string>

/**
 * Where a counter-notice sits, for the chip beside the row.
 *
 * `received` is `warning` and not `info`, unlike a report's `open`: a
 * counter-notice sitting at `received` has a statutory deadline already
 * running against it, so the resting state of this queue is a debt rather
 * than an inbox.
 */
const COUNTER_STATUS_COLOR: Record<
  string,
  'info' | 'warning' | 'success' | 'error' | 'default'
> = {
  received: 'warning',
  forwarded: 'info',
  restored: 'success',
  suitFiled: 'error',
  withdrawn: 'default',
  rejected: 'default',
}

/** What each counter-notice transition MEANS, in the operator's language. */
const COUNTER_STATUS_HINT: Record<string, string> = {
  received: 'Filed by the subscriber. Nothing sent to the complainant yet.',
  forwarded:
    'Copy sent to the complainant, and the site’s suspension stamped with the restore date.',
  restored: 'Access put back. Any strike from the original notice is withdrawn.',
  suitFiled:
    'The complainant told us they filed a court action. The material stays down and the scheduled restoration is canceled.',
  withdrawn: 'The subscriber took the counter-notice back.',
  rejected:
    'Not a counter-notice — a misfiled question, not a judgment on the merits.',
}

/** How loud the repeat-infringer verdict should be. */
const STRIKE_COLOR: Record<string, 'default' | 'warning' | 'error'> = {
  none: 'default',
  warn: 'warning',
  final: 'warning',
  terminate: 'error',
}

/** A closing status is the one the route refuses without a written note. */
/** Stable empties, so a list's request is not a new query every render. */
const NO_WORDS: readonly string[] = []
const NO_CLAUSES: readonly ListFilterClause[] = []
/** The counter-notice queue is the same route's second list. */
const COUNTER_NOTICE_PARAMS: Readonly<Record<string, string>> = {
  queue: 'counterNotices',
}

const isClosingStatus = (status: string): boolean =>
  status === 'actioned' || status === 'dismissed'

const formatMs = (value: number | null): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toLocaleString()
    : 'unknown'

/**
 * What the submitter is holding (AGL-2400).
 *
 * The emailed receipt is the only artifact a submitter keeps — the receipt
 * page is a tab they close — so "it did not send" is work, and this is the
 * only place anyone can learn it. `aglyn.com` publishes DMARC `p=reject`, so a
 * message that fails our own published policy is refused by the receiving
 * server at SMTP rather than filed in a junk folder: it exists in no folder on
 * either side, nobody discovers it by looking, and the submitter — who is the
 * only person who knows something is missing — cannot tell us.
 *
 * Three branches for the route's three states, and they say different things
 * on purpose:
 *
 *  - `failed` — actionable. Names the reason so the reader can tell an
 *    unconfigured deployment (nothing to retry, fix the env) from a rejection
 *    (retry, or the address is bad).
 *  - `sent` — Resend ACCEPTED it. Not "delivered": a later bounce is not
 *    visible from here, and the sentence must not imply it is.
 *  - `null` — the row predates the record. Says so, rather than guessing in
 *    either direction.
 *
 * The anonymous case never reaches here: with no address there was no receipt
 * to send, and the "Who reported it" line above already says exactly that.
 */
function receiptLine(row: {
  receiptStatus: ReceiptStatus
  receiptReason: string | null
  receiptAttemptedAtMs: number | null
}): { text: string; failed: boolean } {
  if (row.receiptStatus === 'failed') {
    const reason = row.receiptReason ?? 'unknown'
    const detail =
      reason === 'unconfigured'
        ? 'this deployment has no outbound mail configured, so nothing was attempted'
        : `the provider did not accept it (${reason})`
    return {
      failed: true,
      text:
        `No receipt reached them — ${detail}. They are holding nothing: ` +
        `no reference, no date, no evidence they filed. Send it by hand to ` +
        `the address above. Attempted ${formatMs(row.receiptAttemptedAtMs)}.`,
    }
  }
  if (row.receiptStatus === 'sent') {
    return {
      failed: false,
      text: `Receipt accepted for delivery ${formatMs(row.receiptAttemptedAtMs)}. A bounce after that is not visible here.`,
    }
  }
  return {
    failed: false,
    text: 'Whether a receipt was emailed was not recorded on this row — it predates the record. Treat it as unknown rather than as either answer.',
  }
}

/**
 * The strike ledger for one account (AGL-2328).
 *
 * Every field rendered here was already being written by `syncStrikeLedger`
 * and thrown away by a `select('withdrawnAt')` one line above the only
 * reader. What that cost was specific: the queue could say an account had
 * three strikes and could not say WHICH pages, WHEN, or who recorded them —
 * so the §512(i) repeat-infringer defence, whose whole content is "we knew,
 * here is when, here is what we did", had no artefact behind it.
 *
 * Withdrawn rows stay in the list, struck through, with the reason and the
 * person. That is the half a flattering implementation drops, and it is the
 * half that shows the policy was applied rather than merely counted.
 */
function StrikeLedger({ rows }: { rows: StrikeLedgerRow[] }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        {`Strike ledger for this account — ${
          rows.filter((row) => row.standing).length
        } standing of ${rows.length} recorded`}
      </Typography>
      {rows.map((row, index) => (
        <Stack
          key={`${row.reportId ?? index}`}
          spacing={0.25}
          sx={{ pl: 1, borderLeft: 2, borderColor: 'divider' }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'baseline', flexWrap: 'wrap', rowGap: 0.5 }}
          >
            <Chip
              size="small"
              variant="outlined"
              color={row.standing ? 'warning' : 'default'}
              label={row.standing ? 'standing' : 'withdrawn'}
            />
            {/* Not a link, for the reason the reported address above is not
                a link: this is an attacker-supplied URL and the browser
                reading it can suspend any site on the platform. */}
            <Typography
              variant="caption"
              component="span"
              sx={{
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                userSelect: 'all',
                textDecoration: row.standing ? 'none' : 'line-through',
              }}
            >
              {row.url ?? 'no address recorded'}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {`Recorded ${formatMs(row.recordedAt)}${
              row.recordedByEmail ? ` by ${row.recordedByEmail}` : ''
            }`}
          </Typography>
          {row.standing ? null : (
            <Typography variant="caption" color="text.secondary">
              {`Withdrawn ${formatMs(row.withdrawnAt)}${
                row.withdrawnByEmail ? ` by ${row.withdrawnByEmail}` : ''
              }${row.withdrawnReason ? ` — ${row.withdrawnReason}` : ''}`}
            </Typography>
          )}
        </Stack>
      ))}
    </Stack>
  )
}

function AdminAbuseReports() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const [summary, setSummary] = useState<QueueSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, StatusDraft>>({})
  const [counterDrafts, setCounterDrafts] = useState<
    Record<string, CounterNoticeDraft>
  >({})
  const [log, setLog] = useState<
    { atMs: number; text: string; confirmed: boolean }[]
  >([])

  /**
   * Status and Category, as clauses the route puts on its query. The two
   * selects write them and the chips remove them; the rows that come back
   * are the answer, and nothing here narrows them further.
   */
  const reportFilter = useListGridFilter({
    selectFields: Object.keys(ABUSE_REPORT_FILTER_OPTIONS),
  })
  const { clauses, setClauses } = reportFilter
  const pickedOf = (field: string): string =>
    clauses.find((clause) => clause.field === field && clause.op === 'equals')
      ?.value ?? 'all'
  const pick = (field: string, value: string) => {
    const label = ABUSE_REPORT_FILTER_OPTIONS[field]?.find(
      (option) => option.value === value,
    )?.label
    const next: ListFilterClause | null =
      value === 'all' ? null : { field, op: 'equals', value, label }
    setClauses(upsertListFilterClause(clauses, field, next))
  }

  const onListError = useCallback(
    (error: unknown) =>
      enqueueSnackbar(
        error instanceof Error && error.message
          ? error.message
          : 'Reading the abuse queue failed',
        { variant: 'error', allowDuplicate: true },
      ),
    [enqueueSnackbar],
  )

  /**
   * Read the queue. Open to every staff role — triage is the larger half of
   * the work and `support` can do all of it without ever learning who filed a
   * report, which is exactly why the route redacts rather than refuses.
   */
  const reportList = useStaffListQuery<AbuseReportRow>({
    endpoint: '/api/admin/abuse-reports',
    clauses,
    search: NO_WORDS,
    rowsKey: 'reports',
    onError: onListError,
  })
  const counterList = useStaffListQuery<CounterNoticeRow>({
    endpoint: '/api/admin/abuse-reports',
    clauses: NO_CLAUSES,
    search: NO_WORDS,
    params: COUNTER_NOTICE_PARAMS,
    rowsKey: 'counterNotices',
    onError: onListError,
  })
  const { refresh: refreshReports } = reportList

  /**
   * THE DEEP LINK (AGL-3368): `?report=<id>` opens one row — the one a staff
   * alert or a risk notice names — pinned above the queue, since the queue
   * is paged and that row may be on no page the list has loaded.
   * `&decide=dismissed|actioned` pre-selects the decision the link was for;
   * nothing is saved until Save status is pressed. Read from
   * `window.location` in an effect, as the support queue's `?ticketId=` is,
   * to stay clear of `useSearchParams`'s Suspense requirement.
   */
  const [linkedReport, setLinkedReport] = useState<AbuseReportRow | null>(null)
  const [linkedMissing, setLinkedMissing] = useState<string | null>(null)
  const loadLinkedReport = useCallback(
    async (id: string, decide: string | null) => {
      try {
        const response = await authorizedFetch(
          user,
          `/api/admin/abuse-reports?id=${encodeURIComponent(id)}`,
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload.report) {
          setLinkedMissing(payload.error ?? `Report ${id} could not be read`)
          return
        }
        const report = payload.report as AbuseReportRow
        setLinkedReport(report)
        if (decide) {
          setDrafts((entries) => ({
            ...entries,
            [report.id]: { status: decide, resolution: report.resolution ?? '' },
          }))
        }
      } catch (error: any) {
        setLinkedMissing(error?.message ?? `Report ${id} could not be read`)
      }
    },
    [user],
  )
  const { refresh: refreshCounterNotices } = counterList

  const loadSummary = useCallback(async () => {
    try {
      const response = await authorizedFetch(
        user,
        '/api/admin/abuse-reports?view=summary',
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed (${response.status})`)
      }
      setSummary({
        openUrgent: Number(payload.openUrgent ?? 0),
        awaitingForward: Number(payload.awaitingForward ?? 0),
        overdueRestorations: Number(payload.overdueRestorations ?? 0),
        overdueAtLeast: payload.overdueAtLeast === true,
        counterNoticeStatuses: Array.isArray(payload.counterNoticeStatuses)
          ? payload.counterNoticeStatuses
          : [],
        identityVisible: payload.identityVisible === true,
        actorRole: String(payload.actorRole ?? 'support'),
        readAtMs: Number(payload.readAtMs ?? Date.now()),
      })
    } catch (error: any) {
      console.error(error)
      // Cleared rather than kept: yesterday's "nothing overdue" sitting under
      // a failed read is a breach an operator reads as quiet.
      setSummary(null)
      enqueueSnackbar(error?.message ?? 'Reading the queue’s counts failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [user, enqueueSnackbar])

  const signedInUid = (user as any)?.uid
  useEffect(() => {
    if (!signedInUid || typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const id = params.get('report')
    if (!id) return
    const decide = params.get('decide')
    void loadLinkedReport(
      id,
      decide === 'dismissed' || decide === 'actioned' ? decide : null,
    )
    // Once per signed-in reader, like the summary below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInUid])

  useEffect(() => {
    if (!signedInUid) return
    void loadSummary()
    // Keyed on WHO is signed in, not on `loadSummary`. `useUser` returns a
    // fresh object every render, so `loadSummary` changes identity every
    // render — depending on the callback would re-read on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInUid])

  /** Re-read both lists where they stand, and the counts. */
  const load = useCallback(async () => {
    refreshReports()
    refreshCounterNotices()
    await loadSummary()
  }, [refreshReports, refreshCounterNotices, loadSummary])

  /** The pending edit for a row, defaulting to what the server last stored. */
  const draftFor = useCallback(
    (report: AbuseReportRow): StatusDraft =>
      drafts[report.id] ?? {
        status: report.status,
        resolution: report.resolution ?? '',
      },
    [drafts],
  )

  const patchDraft = useCallback(
    (report: AbuseReportRow, patch: Partial<StatusDraft>) => {
      setDrafts((entries) => ({
        ...entries,
        [report.id]: {
          status: report.status,
          resolution: report.resolution ?? '',
          ...entries[report.id],
          ...patch,
        },
      }))
    },
    [],
  )

  /**
   * Move one report between statuses.
   *
   * The route requires a non-empty `resolution` to CLOSE a report, and the
   * button is disabled until there is one rather than letting the operator
   * discover the rule as a 400 — the note is the whole reason the rule exists,
   * so asking for it before the click is the honest ordering.
   */
  const applyStatus = useCallback(
    async (report: AbuseReportRow, draft: StatusDraft) => {
      setBusy(true)
      try {
        const response = await authorizedFetch(
          user,
          '/api/admin/abuse-reports',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: report.id,
              status: draft.status,
              resolution: draft.resolution.trim(),
              ...(draft.repeatInfringerDecision?.trim()
                ? {
                    repeatInfringerDecision:
                      draft.repeatInfringerDecision.trim(),
                  }
                : {}),
            }),
          },
        )
        const payload = await response.json().catch(() => ({}))
        /**
         * The §512(i) gate, answered in place rather than as an error.
         *
         * A 409 here is not a failure — it is the repeat-infringer policy
         * doing the one thing that makes it a policy: refusing to let this
         * account's next copyright report be closed until somebody says what
         * is being done about the account. Surfacing it as a red snackbar
         * would train operators to read it as a glitch and retry, so the
         * draft grows a decision field instead and the row keeps the
         * operator's note.
         */
        if (response.status === 409 && payload.code === 'repeatInfringerDecisionRequired') {
          setDrafts((entries) => ({
            ...entries,
            [report.id]: { ...draft, repeatInfringerDecision: '' },
          }))
          enqueueSnackbar(payload.error ?? 'A repeat-infringer decision is required', {
            variant: 'warning',
            allowDuplicate: true,
          })
          return
        }
        if (!response.ok) {
          throw new Error(payload.error ?? `Failed (${response.status})`)
        }
        // A 200 says the write was accepted. Only `confirmed` says the
        // document re-read as the status we asked for, and those are not the
        // same claim — the audit row is already written either way.
        const confirmed = payload.confirmed !== false
        const what = `${report.reference ?? report.id} → ${draft.status}`
        setLog((entries) =>
          [{ atMs: Date.now(), text: what, confirmed }, ...entries].slice(0, 25),
        )
        enqueueSnackbar(
          confirmed
            ? `${what} — verified on the server (audited)`
            : `${what} was accepted, but re-reading the report shows a DIFFERENT status. Do not walk away.`,
          { variant: confirmed ? 'success' : 'error', allowDuplicate: true },
        )
        // Drop the local edit so the row goes back to rendering the server's
        // answer. A draft left in place would keep showing the operator their
        // intent on top of whatever actually landed.
        setDrafts((entries) => {
          const next = { ...entries }
          delete next[report.id]
          return next
        })
        await load()
      } catch (error: any) {
        console.error(error)
        enqueueSnackbar(error?.message ?? 'The status change failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setBusy(false)
      }
    },
    [user, enqueueSnackbar, load],
  )

  /**
   * Move a counter-notice, and report what happened TO THE SITE.
   *
   * The status change is the smaller half. Forwarding also stamps the site's
   * suspension with the restore date, and the route returns which of four
   * things it did — so the confirmation names it. "Forwarded" alone would let
   * an operator believe a put-back was scheduled when the host was not
   * suspended and nothing was written, which is the one misunderstanding on
   * this page that ends with a customer still locked out on the statutory
   * date.
   */
  const applyCounterNotice = useCallback(
    async (notice: CounterNoticeRow, draft: CounterNoticeDraft) => {
      setBusy(true)
      try {
        const response = await authorizedFetch(
          user,
          '/api/admin/abuse-reports',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              counterNoticeId: notice.id,
              counterNoticeStatus: draft.status,
              resolution: draft.resolution.trim(),
            }),
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload.error ?? `Failed (${response.status})`)
        }
        const confirmed = payload.confirmed !== false
        const scheduling = String(payload.scheduling ?? '')
        const consequence =
          scheduling === 'scheduled'
            ? ` — restoration scheduled for ${formatMs(payload.counterNotice?.restoreAtMs ?? null)}`
            : scheduling === 'notSuspended'
              ? ' — the site was NOT suspended, so nothing was scheduled'
              : scheduling === 'alreadySooner'
                ? ' — the existing suspension already ends sooner; left alone'
                : scheduling === 'cancelled'
                  ? ' — the scheduled restoration was canceled'
                  : scheduling === 'noHost'
                    ? ' — no site resolved, so nothing was scheduled'
                    : ''
        const what = `${notice.reference ?? notice.id} → ${draft.status}${consequence}`
        setLog((entries) =>
          [{ atMs: Date.now(), text: what, confirmed }, ...entries].slice(0, 25),
        )
        enqueueSnackbar(
          confirmed
            ? `${what} (audited)`
            : `${what} was accepted, but re-reading the counter-notice shows a DIFFERENT status. Do not walk away.`,
          { variant: confirmed ? 'success' : 'error', allowDuplicate: true },
        )
        setCounterDrafts((entries) => {
          const next = { ...entries }
          delete next[notice.id]
          return next
        })
        await load()
      } catch (error: any) {
        console.error(error)
        enqueueSnackbar(error?.message ?? 'The counter-notice step failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setBusy(false)
      }
    },
    [user, enqueueSnackbar, load],
  )

  const copyUrl = useCallback(
    (url: string) => {
      void navigator.clipboard
        ?.writeText(url)
        .then(() =>
          enqueueSnackbar('Reported address copied to the clipboard', {
            variant: 'success',
            allowDuplicate: true,
          }),
        )
        .catch(() => undefined)
    },
    [enqueueSnackbar],
  )

  /**
   * The pending step for a counter-notice, defaulting to its current status.
   *
   * Note deliberately starts EMPTY rather than echoing the stored resolution
   * the way a report draft does. Every counter-notice transition is a fresh
   * legal act — forwarding, then later restoring, are two different things we
   * did — so pre-filling the previous step's note invites it being saved
   * again as the description of a different act.
   */
  const counterDraftFor = useCallback(
    (notice: CounterNoticeRow): CounterNoticeDraft =>
      counterDrafts[notice.id] ?? { status: notice.status, resolution: '' },
    [counterDrafts],
  )

  const reports = reportList.rows
  // The linked row first and once, fresher from the list when it is there.
  const shownReports = linkedReport
    ? [
        reports.find((report) => report.id === linkedReport.id) ?? linkedReport,
        ...reports.filter((report) => report.id !== linkedReport.id),
      ]
    : reports
  const counterNotices = counterList.rows
  const loading = reportList.loading || counterList.loading
  // Urgent rows still sitting at `open` are the ones with a clock on them, and
  // the number the route counted over the whole queue is the number this page
  // repeats — a tally of the rows on screen would be a second, smaller answer.
  const urgentBacklog = summary ? summary.openUrgent : 0
  /**
   * Submitters on THIS PAGE holding nothing (AGL-2400): the rows shown, both
   * lists, and the alert says "on this page". Counted from `'failed'` ONLY —
   * a row with no receipt record is unknown, not broken.
   */
  const receiptsFailed =
    reports.filter((report) => report.receiptStatus === 'failed').length +
    counterNotices.filter((notice) => notice.receiptStatus === 'failed').length
  const strikesUnknown = reports.some((report) => report.strikeUnknown)
  const identityVisible = summary
    ? summary.identityVisible
    : (reports[0]?.identityVisible ?? true)
  const refusals = useMemo(
    () =>
      listQueryRefusals(reportList.refused, {
        fields: ABUSE_REPORT_FILTER_FIELDS,
        headers: ABUSE_REPORT_FILTER_HEADERS,
        options: ABUSE_REPORT_FILTER_OPTIONS,
      }),
    [reportList.refused],
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        {
          children: 'Abuse reports',
          href: buildRoute(Route.ADMIN_ABUSE_REPORTS),
        },
      ]}
      help="abuseReports"
      header={{
        children: 'Abuse reports',
        icon: { path: ICON_VARIANT_SYMBOL_FLAG.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={2}>
            <Alert severity="info">
              {
                'Reports filed from the public form. Most reporters are not customers — a bank’s fraud team, a browser vendor, an abuse desk — and their alternative to us answering is a block on the whole *.' +
                TENANT_APEX +
                ' domain. Triage here, then act with Lockdown (a site or a workspace) or Disabled files (one uploaded file). Every status change is audited; nothing on this page can delete a report.'
              }
            </Alert>

            {busy || loading ? <LinearProgress /> : null}

            <CardDisplay
              header={'The queue'}
              help={docsHelp('abuseReports', { anchor: '#triage-by-severity' })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                >
                  {(['status', 'category'] as const).map((field) => (
                    <TextField
                      key={field}
                      select
                      size="small"
                      label={ABUSE_REPORT_FILTER_HEADERS[field]}
                      value={pickedOf(field)}
                      onChange={(event) => pick(field, event.target.value)}
                      sx={{ minWidth: 200 }}
                    >
                      <MenuItem value="all">
                        {field === 'status' ? 'All statuses' : 'All categories'}
                      </MenuItem>
                      {ABUSE_REPORT_FILTER_OPTIONS[field].map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  ))}
                  <Typography variant="body2" color="text.secondary">
                    {reportList.loading && !reports.length
                      ? 'Reading the queue…'
                      : `${reports.length} report${reports.length === 1 ? '' : 's'} on this page`}
                  </Typography>
                  {summary ? (
                    <Typography variant="caption" color="text.secondary">
                      {`read ${new Date(summary.readAtMs).toLocaleString()}`}
                    </Typography>
                  ) : null}
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy || loading}
                    onClick={() => void load()}
                  >
                    {'Refresh'}
                  </Button>
                </Stack>

                <ListFilterChips
                  fields={ABUSE_REPORT_FILTER_FIELDS}
                  headers={ABUSE_REPORT_FILTER_HEADERS}
                  options={ABUSE_REPORT_FILTER_OPTIONS}
                  clauses={clauses}
                  onChange={setClauses}
                />
                <ListQueryNotices refused={refusals} notices={reportList.notices} />

                {urgentBacklog > 0 ? (
                  <Alert severity="error">
                    {`${urgentBacklog} URGENT report${
                      urgentBacklog === 1 ? ' is' : 's are'
                    } still open across the queue. Urgent means phishing, malware, or CSAM: the harm is being done to someone who is not our customer while the row sits here.`}
                  </Alert>
                ) : null}

                {/*
                  The §512(g) breach banner, below only the urgent one. An
                  overdue restoration is a customer locked out of their own
                  work past the date the law gave us — a harm we are causing,
                  and the only thing on this page more pressing is active harm
                  to a stranger.
                */}
                {summary && summary.overdueRestorations > 0 ? (
                  <Alert severity="error">
                    {`${summary.overdueAtLeast ? 'At least ' : ''}${summary.overdueRestorations} counter-notice${
                      summary.overdueRestorations === 1 ? ' is' : 's are'
                    } PAST the statutory restoration deadline. Access should already have been restored. Every day this sits is a customer locked out of their own site, and a §512(g) breach we cannot undo by acting later.`}
                  </Alert>
                ) : null}

                {summary && summary.awaitingForward > 0 ? (
                  <Alert severity="warning">
                    {`${summary.awaitingForward} counter-notice${
                      summary.awaitingForward === 1 ? ' has' : 's have'
                    } not been forwarded to the complainant yet. The clock started when the subscriber filed, not when you open this — so the wait comes out of the remaining window rather than being added to theirs.`}
                  </Alert>
                ) : null}

                {/* AGL-2400. `warning`, not `error`: nothing is out of
                    compliance yet, but somebody who wrote to us is holding no
                    evidence they did, and only this screen knows. */}
                {receiptsFailed > 0 ? (
                  <Alert severity="warning">
                    {`${receiptsFailed} submitter${
                      receiptsFailed === 1
                        ? ' on this page was'
                        : 's on this page were'
                    } never sent the emailed receipt. They hold no reference and no proof they filed, and there is no copy of the message anywhere for either side to find — under our published mail policy a receipt that fails is refused outright rather than landing in a junk folder. Each row below names the reason and the address to re-send from by hand.`}
                  </Alert>
                ) : null}

                {strikesUnknown ? (
                  <Alert severity="warning">
                    Some accounts on this page are past what the strike lookup
                    covers, so their strike count is UNKNOWN rather than zero.
                    Check the account directly before closing a report on one
                    of them.
                  </Alert>
                ) : null}

                {!identityVisible ? (
                  <Alert severity="info">
                    {`Your staff role (${summary?.actorRole ?? 'support'}) triages without reporter identity: emails, names and DMCA signatures come back empty by design, not because they are missing. Each report below says whether there was a contactable reporter at all.`}
                  </Alert>
                ) : null}

                {!reportList.loading && !reportList.failed && !reports.length ? (
                  <Typography variant="body2" color="text.secondary">
                    {clauses.length === 0
                      ? 'No reports have been filed. That is the good state — but if the public form ever broke it would look exactly like this, so check the form itself before treating a long silence as quiet.'
                      : 'No reports match these filters anywhere in the queue. Remove a filter to see the rest of it.'}
                  </Typography>
                ) : null}
              </Stack>
            </CardDisplay>

            {linkedMissing ? (
              <Alert severity="warning" onClose={() => setLinkedMissing(null)}>
                {linkedMissing}
              </Alert>
            ) : null}
            {shownReports.map((report) => {
              const linked = linkedReport?.id === report.id
              const draft = draftFor(report)
              const closing = isClosingStatus(draft.status)
              const needsNote = closing && !draft.resolution.trim()
              const unchanged =
                draft.status === report.status &&
                draft.resolution.trim() === (report.resolution ?? '').trim()
              const severity = report.severity ?? 'normal'
              const urgent = severity === 'urgent'
              // Only for copyright rows, and only when the route actually
              // looked the account up — an absent verdict means UNKNOWN (past
              // the lookup cap), never zero, so it renders nothing rather
              // than a reassuring "0 strikes".
              const verdict =
                report.category === 'dmca' && report.orgId ? report.strike : null
              return (
                <CardDisplay
                  key={report.id}
                  header={
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                    >
                      <Chip
                        size="small"
                        color={SEVERITY_COLOR[severity] ?? 'default'}
                        variant={urgent ? 'filled' : 'outlined'}
                        label={SEVERITY_LABEL[severity] ?? severity}
                      />
                      <Typography variant="subtitle1">
                        {report.categoryLabel ??
                          report.category ??
                          'Uncategorised report'}
                      </Typography>
                      <Chip
                        size="small"
                        color={STATUS_COLOR[report.status] ?? 'default'}
                        label={report.status}
                      />
                      {report.reportCount > 1 ? (
                        <Chip
                          size="small"
                          color="warning"
                          label={`reported ${report.reportCount}×`}
                        />
                      ) : null}
                      {/*
                        The §512(i) count, only on copyright rows. A strike
                        chip beside a phishing report would invite reading it
                        as a general misconduct score, which is not what the
                        statute counts nor what our published policy says.
                      */}
                      {verdict ? (
                        <Chip
                          size="small"
                          color={STRIKE_COLOR[verdict.level] ?? 'default'}
                          variant={verdict.level === 'terminate' ? 'filled' : 'outlined'}
                          label={`${verdict.strikes} copyright strike${
                            verdict.strikes === 1 ? '' : 's'
                          } on this account`}
                        />
                      ) : null}
                    </Stack>
                  }
                  help={docsHelp('abuseReports', {
                    excerpt:
                      'One report, with its severity, its status, and — on copyright ' +
                      'reports only — the §512(i) strike count for the account.',
                  })}
                  subheader={
                    report.reference
                      ? `Reference ${report.reference}`
                      : `Report ${report.id}`
                  }
                  sx={
                    urgent
                      ? { borderLeft: 4, borderLeftColor: 'error.main' }
                      : undefined
                  }
                  contentGutterX
                  contentGutterY
                >
                  <Stack spacing={2}>
                    {urgent && report.status === 'open' ? (
                      <Alert severity="error">
                        {report.category === 'csam'
                          ? 'CSAM is handled outside this queue: preserve the evidence, report to NCMEC, and follow the runbook. There is deliberately no self-service takedown button for this category, and there must not be one.'
                          : 'Urgent and still open. The victim of this page is not our customer, and the reporter’s next move if we are silent is a domain-level block on *.' +
                            TENANT_APEX +
                            '.'}
                      </Alert>
                    ) : null}

                    {report.category ? (
                      <Typography variant="body2" color="text.secondary">
                        {CATEGORY_HINT[report.category] ??
                          'This category is not one the current form offers — the report predates a change to the category list.'}
                      </Typography>
                    ) : null}

                    {/*
                      THE EVIDENCE BEHIND THE STRIKE COUNT (AGL-2328).

                      The chip in the header asserts a number; this is what
                      substantiates it. Withdrawn rows are shown, struck
                      through and with the reason they were lifted, because
                      `syncStrikeLedger` marks rather than deletes precisely
                      so "did we know, and when" has an answer — and a list
                      that hid the reversals would answer a different,
                      flattering question.
                    */}
                    {verdict?.ledger?.length ? (
                      <StrikeLedger rows={verdict.ledger} />
                    ) : null}

                    <Stack spacing={0.5}>
                      <Typography variant="caption" color="text.secondary">
                        {'Reported address'}
                      </Typography>
                      {/* NEVER render this as a link. It is an attacker-supplied
                          address for a page somebody has told us is phishing or
                          serving malware, and one careless click from a staff
                          session — the session that can suspend any site on the
                          platform — is the worst outcome this page has. Text and
                          a copy button only. */}
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                      >
                        <Typography
                          variant="caption"
                          component="span"
                          sx={{
                            fontFamily: 'monospace',
                            wordBreak: 'break-all',
                            userSelect: 'all',
                          }}
                        >
                          {report.url ?? 'no address recorded'}
                        </Typography>
                        {report.url ? (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => copyUrl(report.url as string)}
                          >
                            {'Copy'}
                          </Button>
                        ) : null}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {
                          'Deliberately not clickable. Open it, if you must, in a disposable browser that is not signed in here.'
                        }
                      </Typography>
                    </Stack>

                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        label={report.reportedHostname ?? 'hostname unresolved'}
                        sx={{ fontFamily: 'monospace' }}
                      />
                      {report.hostId ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`site ${report.hostId}`}
                          sx={{ fontFamily: 'monospace' }}
                          onClick={() => copyUrl(report.hostId as string)}
                        />
                      ) : null}
                      {report.orgId ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`workspace ${report.orgId}`}
                          sx={{ fontFamily: 'monospace' }}
                          onClick={() => copyUrl(report.orgId as string)}
                        />
                      ) : null}
                    </Stack>

                    {report.hostId ? (
                      <Stack spacing={0.5}>
                        {/* These two ARE safe to link: they are console routes
                            on this origin, not the reported address. */}
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ flexWrap: 'wrap', rowGap: 1 }}
                        >
                          <AppLink
                            componentVariant="button"
                            size="small"
                            variant="outlined"
                            href={buildRoute(Route.ADMIN_LOCKDOWN)}
                          >
                            {'Lockdown'}
                          </AppLink>
                          <AppLink
                            componentVariant="button"
                            size="small"
                            variant="outlined"
                            href={buildRoute(Route.ADMIN_MEDIA_QUARANTINE)}
                          >
                            {'Disabled files'}
                          </AppLink>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {
                            'Lockdown suspends the site or the whole workspace; Disabled files stops one uploaded file being served and leaves the site serving. NEITHER is a recall: both stop new delivery, and neither reaches bytes a browser, a downstream CDN, a scraper or an archive already holds — so treat a public file as already distributed when you decide what to promise a complainant. Copy the ids above — these two buttons open their pages empty, so the target is typed by the person who decided on it. A risk row's own Lock action pre-fills Lockdown, which still shows the target and waits for you to press Lock.'
                          }
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {
                          'No site id resolved from the reported address — it may be a custom domain we do not serve, or a page that has already gone. Look the hostname up before assuming there is nothing to act on.'
                        }
                      </Typography>
                    )}

                    <Divider />

                    {report.riskNotice ? (
                      <Alert
                        severity={urgent ? 'warning' : 'info'}
                        variant={linked ? 'filled' : 'standard'}
                      >
                        <Stack spacing={1}>
                          <Typography variant="subtitle2">
                            {linked
                              ? `${report.riskNotice.title} — opened from a notice`
                              : report.riskNotice.title}
                          </Typography>
                          <Typography variant="body2">
                            {report.riskNotice.summary}
                          </Typography>
                          <Typography variant="caption">
                            {report.riskNotice.ownersNotifiedAtMs
                              ? `The workspace's owners and admins were told on ${new Date(
                                  report.riskNotice.ownersNotifiedAtMs,
                                ).toLocaleString()}, in the risk notice's own words — never the evidence below.`
                              : 'Filed before owner notices existed: the workspace was not told about this row.'}
                          </Typography>
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ flexWrap: 'wrap', rowGap: 1 }}
                          >
                            {report.riskNotice.actions.map((action) =>
                              RISK_DECISION_ACTIONS[action.id] ? (
                                <Button
                                  key={action.id}
                                  size="small"
                                  variant="outlined"
                                  color="inherit"
                                  title={action.hint}
                                  onClick={() =>
                                    patchDraft(report, {
                                      status: RISK_DECISION_ACTIONS[action.id],
                                    })
                                  }
                                >
                                  {action.label}
                                </Button>
                              ) : action.href.startsWith('https://') ? (
                                <Button
                                  key={action.id}
                                  size="small"
                                  variant="outlined"
                                  color="inherit"
                                  title={action.hint}
                                  href={action.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {action.label}
                                </Button>
                              ) : action.id === 'staff-open-row' ? null : (
                                <AppLink
                                  key={action.id}
                                  componentVariant="button"
                                  size="small"
                                  variant="outlined"
                                  color="inherit"
                                  title={action.hint}
                                  href={action.href}
                                >
                                  {action.label}
                                </AppLink>
                              ),
                            )}
                          </Stack>
                          <Typography variant="caption">
                            {
                              'Waive / release sets the status below to Dismissed and Reject sets it to Actioned; nothing changes until you save it. An owner can never release a hold or lift a lock themselves — their only lever is a review request.'
                            }
                          </Typography>
                        </Stack>
                      </Alert>
                    ) : null}

                    {report.ownerReviewRequests?.length ? (
                      <Alert severity="info" variant="outlined">
                        <Stack spacing={0.75}>
                          <Typography variant="subtitle2">
                            {`Review requested by the workspace (${report.ownerReviewRequests.length})`}
                          </Typography>
                          {report.ownerReviewRequests.map((request, index) => (
                            <Stack key={`${request.atMs ?? index}`} spacing={0.25}>
                              <Typography variant="caption" color="text.secondary">
                                {`${request.atMs ? new Date(request.atMs).toLocaleString() : 'Unknown time'}${
                                  request.email ? ` · ${request.email}` : ''
                                }`}
                              </Typography>
                              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                {request.note}
                              </Typography>
                            </Stack>
                          ))}
                          <Typography variant="caption" color="text.secondary">
                            {
                              'Answer by deciding the row: the owners get the closing notice (released or not approved) automatically. Put anything more you want them to know in "What you did".'
                            }
                          </Typography>
                        </Stack>
                      </Alert>
                    ) : null}

                    {report.paymentSignal ? (
                      <Alert severity="error">
                        <Stack spacing={0.5}>
                          <Typography variant="subtitle2">
                            {`${
                              PAYMENT_SIGNAL_TITLES[report.paymentSignal.kind ?? ''] ??
                              'Stripe fraud signal'
                            }${report.paymentSignal.livemode ? '' : ' (test mode)'}`}
                          </Typography>
                          <Typography variant="body2">
                            {`Workspace: ${report.orgId ?? 'none — not a workspace subscription charge'} · ` +
                              `Charge: ${report.paymentSignal.chargeId ?? report.paymentSignal.paymentIntentId ?? 'not named'} · ` +
                              `Amount: ${paymentSignalAmount(report.paymentSignal)}`}
                          </Typography>
                          {report.paymentSignal.detail ? (
                            <Typography variant="body2">
                              {`Stripe says: ${report.paymentSignal.detail}`}
                            </Typography>
                          ) : null}
                          {report.paymentSignal.checks ? (
                            <Typography variant="body2">
                              {`Card: CVC ${report.paymentSignal.checks.cvcCheck ?? 'unknown'}, ` +
                                `postal code ${report.paymentSignal.checks.addressPostalCodeCheck ?? 'unknown'}, ` +
                                `issued in ${report.paymentSignal.checks.cardCountry ?? 'unknown'}, ` +
                                `3DS ${report.paymentSignal.checks.threeDSecure ?? 'not used'}, ` +
                                `Radar risk ${report.paymentSignal.checks.riskLevel ?? 'unknown'}`}
                            </Typography>
                          ) : null}
                          <Typography variant="body2">
                            {'Nothing has been refunded or canceled. Decide on the Subscription card, lock the workspace if it is fraud, then close this report with what you did.'}
                          </Typography>
                          {report.paymentSignal.subscriptionCard ? (
                            <AppLink href={report.paymentSignal.subscriptionCard}>
                              {'Open the workspace’s Subscription card'}
                            </AppLink>
                          ) : null}
                        </Stack>
                      </Alert>
                    ) : null}

                    {report.sellerPattern ? (
                      <Alert severity="error">
                        <Stack spacing={0.5}>
                          <Typography variant="subtitle2">
                            {`Seller fraud pattern${report.sellerPattern.livemode ? '' : ' (test mode)'}`}
                          </Typography>
                          <Typography variant="body2">
                            {`Connected account ${report.sellerPattern.sellerAccountId ?? 'unknown'}: ` +
                              `${report.sellerPattern.chargeIds.length} different charges drew a fraud warning or a dispute` +
                              (report.sellerPattern.windowDays
                                ? ` within ${report.sellerPattern.windowDays} days`
                                : '') +
                              '.'}
                          </Typography>
                          <Typography variant="body2">
                            {`Workspace(s): ${report.sellerPattern.orgIds.join(', ') || 'not resolved'} · ` +
                              `Site(s): ${report.sellerPattern.hostIds.join(', ') || 'not resolved'}`}
                          </Typography>
                          <Typography variant="body2">
                            {'Nothing has been refunded, canceled or paused. If the seller is the fraudster, lock the workspace and pause the account’s payouts in Stripe, then close this report with what you did.'}
                          </Typography>
                          {report.sellerPattern.orgIds[0] ? (
                            <AppLink
                              href={`/admin/orgs/${encodeURIComponent(report.sellerPattern.orgIds[0])}`}
                            >
                              {'Open the workspace'}
                            </AppLink>
                          ) : null}
                          {report.sellerPattern.stripeAccountUrl ? (
                            <Link
                              href={report.sellerPattern.stripeAccountUrl}
                              target="_blank"
                              rel="noreferrer"
                              variant="body2"
                            >
                              {'Open the connected account in Stripe'}
                            </Link>
                          ) : null}
                        </Stack>
                      </Alert>
                    ) : null}

                    {report.heldSend ? (
                      <Alert
                        severity={
                          report.heldSend.state === 'held' ? 'warning' : 'info'
                        }
                      >
                        <Stack spacing={0.5}>
                          <Typography variant="subtitle2">
                            {`${heldSendKindLabel(
                              report.heldSend.kind,
                            )} held by the phishing screen`}
                          </Typography>
                          <Typography variant="body2">
                            {`${report.heldSend.kind === 'page' ? 'Page' : 'Subject'}: ${
                              report.heldSend.subject ?? '—'
                            }`}
                            {report.heldSend.fromName
                              ? ` · Sender name: ${report.heldSend.fromName}`
                              : ''}
                            {report.heldSend.ageDays !== null
                              ? ` · Workspace age: ${report.heldSend.ageDays} day(s)`
                              : ''}
                          </Typography>
                          {report.heldSend.reasons.map((reason) => (
                            <Typography key={reason} variant="body2">
                              {`• ${reason}`}
                            </Typography>
                          ))}
                          <Typography
                            variant="caption"
                            sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                          >
                            {report.heldSend.path ?? ''}
                          </Typography>
                          <Typography variant="body2">
                            {heldSendStateLine(report.heldSend)}
                          </Typography>
                        </Stack>
                      </Alert>
                    ) : null}

                    <Stack spacing={0.5}>
                      <Typography variant="caption" color="text.secondary">
                        {report.source === 'outbound-screen'
                          ? 'What the screen recorded'
                          : report.source === 'stripe-fraud-signal' ||
                              report.source === 'stripe-seller-fraud-pattern'
                            ? 'What Stripe reported'
                            : 'What the reporter said'}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ whiteSpace: 'pre-wrap' }}
                      >
                        {report.details ?? 'No description was recorded.'}
                      </Typography>
                    </Stack>

                    <Stack spacing={0.5}>
                      <Typography variant="caption" color="text.secondary">
                        {'Who reported it'}
                      </Typography>
                      {report.source === 'stripe-fraud-signal' ? (
                        <Typography variant="body2">
                          {'Filed by the Stripe billing webhook, not a person. There is no reporter to reply to; the card holder and the workspace are the subject.'}
                        </Typography>
                      ) : report.source === 'stripe-seller-fraud-pattern' ? (
                        <Typography variant="body2">
                          {'Filed by the Stripe billing webhook from the seller’s own sales, not by a person. There is no reporter to reply to; the seller is the subject.'}
                        </Typography>
                      ) : report.source === 'outbound-screen' ? (
                        <Typography variant="body2">
                          {'Filed by the outbound phishing screen, not a person. There is no reporter to reply to; the workspace that composed the email is the subject.'}
                        </Typography>
                      ) : report.identityVisible ? (
                        <Typography variant="body2">
                          {report.hasReporterContact
                            ? `${report.reporterName ?? 'no name given'} — ${report.reporterEmail ?? 'no address recorded'}`
                            : 'Filed anonymously. There is no address on this report, so no follow-up question is possible and no acknowledgment can be sent.'}
                        </Typography>
                      ) : (
                        // These two sentences are NOT the same fact and must
                        // never collapse into one. "Withheld from you" means a
                        // super-role colleague can reach the reporter;
                        // "anonymous" means nobody can.
                        <Typography variant="body2">
                          {report.hasReporterContact
                            ? 'A contactable reporter left an address, but their identity is withheld from your staff role. A super-role colleague can reply to them.'
                            : 'Filed anonymously. Nobody left an address — this is not a redaction, there is genuinely nobody to reply to.'}
                        </Typography>
                      )}
                      {/* Only where an address existed. With none there was no
                          receipt to send, and the line above already says so —
                          a second sentence about a mail nobody could receive
                          would read as a failure. */}
                      {report.hasReporterContact
                        ? (() => {
                            const receipt = receiptLine(report)
                            return (
                              <Typography
                                variant="body2"
                                color={
                                  receipt.failed ? 'error.main' : 'text.secondary'
                                }
                              >
                                {receipt.text}
                              </Typography>
                            )
                          })()
                        : null}
                    </Stack>

                    {report.dmca ? (
                      <Stack spacing={0.5}>
                        <Typography variant="caption" color="text.secondary">
                          {'Copyright notice (17 U.S.C. §512(c)(3))'}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ whiteSpace: 'pre-wrap' }}
                        >
                          {report.dmca.work ??
                            'The work was not identified on this notice.'}
                        </Typography>
                        <Typography variant="body2">
                          {report.dmca.signature
                            ? `Signed: ${report.dmca.signature}`
                            : report.identityVisible
                              ? 'No electronic signature was recorded.'
                              : 'The electronic signature is the reporter’s legal name and is withheld from your staff role.'}
                        </Typography>
                        <Typography variant="caption">
                          {`${report.dmca.goodFaith ? '✓' : '✗'} Good-faith belief the use is not authorized`}
                        </Typography>
                        <Typography variant="caption">
                          {`${report.dmca.underPenalty ? '✓' : '✗'} Under penalty of perjury, authorized to act for the owner`}
                        </Typography>
                        {/* The ticks record what the reporter asserted. They
                            are not a finding by us, and we do not adjudicate
                            the claim — recording what was asserted, by whom,
                            and when is the whole of the safe-harbour duty. */}
                        <Typography variant="caption" color="text.secondary">
                          {
                            'Both statements were made by the reporter when they filed. Nothing here verifies them, and a ticked box is not evidence the claim is good — it is evidence the claim was made under that name.'
                          }
                        </Typography>
                      </Stack>
                    ) : null}

                    <Stack
                      direction="row"
                      spacing={2}
                      sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {`filed ${formatMs(report.createdAtMs)}`}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {`last updated ${formatMs(report.updatedAtMs)}`}
                      </Typography>
                      {report.resolvedAtMs ? (
                        <Typography variant="caption" color="text.secondary">
                          {`closed ${formatMs(report.resolvedAtMs)}${
                            report.resolvedBy ? ` by ${report.resolvedBy}` : ''
                          }`}
                        </Typography>
                      ) : null}
                    </Stack>

                    {report.resolution ? (
                      <Alert severity="success">
                        {`Recorded outcome: ${report.resolution}`}
                      </Alert>
                    ) : null}

                    <Divider />

                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ flexWrap: 'wrap', rowGap: 1 }}
                    >
                      <TextField
                        select
                        size="small"
                        label="Status"
                        value={draft.status}
                        onChange={(event) =>
                          patchDraft(report, { status: event.target.value })
                        }
                        sx={{ minWidth: 180 }}
                      >
                        {ABUSE_REPORT_STATUSES.map((status) => (
                          <MenuItem key={status} value={status}>
                            {status}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        size="small"
                        label={
                          closing
                            ? 'What you did (required)'
                            : 'What you did (optional)'
                        }
                        // The rule is the route's, and it is a good one: an
                        // "actioned" row with no note is a decision nobody can
                        // reconstruct months later, when the question is "did
                        // we know, and what did we do about it".
                        helperText={
                          needsNote
                            ? 'Closing a report needs a note — which lever you pulled, or why this is not actionable.'
                            : 'Which lever, which notice number, or why it was dismissed. Staff-only; the reporter never sees it.'
                        }
                        error={needsNote}
                        value={draft.resolution}
                        onChange={(event) =>
                          patchDraft(report, { resolution: event.target.value })
                        }
                        slotProps={{ htmlInput: { maxLength: 2000 } }}
                        sx={{ minWidth: 320, flexGrow: 1 }}
                      />
                      {/*
                        THE §512(i) GATE, answered in place.

                        Rendered only once the route has actually refused —
                        the field appears when `repeatInfringerDecision` is
                        present on the draft, which `applyStatus` sets on a
                        409. Showing it pre-emptively on every copyright row
                        would turn the policy into a form field operators fill
                        in reflexively, which is the opposite of making the
                        decision deliberate.
                      */}
                      {draft.repeatInfringerDecision !== undefined ? (
                        <TextField
                          size="small"
                          label="Repeat-infringer decision (required)"
                          helperText={
                            verdict?.consequence ??
                            'This account is at the termination threshold. Record what is being done about the ACCOUNT — terminating, or why not this time.'
                          }
                          error={!draft.repeatInfringerDecision.trim()}
                          multiline
                          minRows={2}
                          value={draft.repeatInfringerDecision}
                          onChange={(event) =>
                            patchDraft(report, {
                              repeatInfringerDecision: event.target.value,
                            })
                          }
                          slotProps={{ htmlInput: { maxLength: 2000 } }}
                          sx={{ minWidth: 320, flexGrow: 1 }}
                        />
                      ) : null}
                      <Button
                        variant="contained"
                        disabled={
                          busy ||
                          needsNote ||
                          unchanged ||
                          (draft.repeatInfringerDecision !== undefined &&
                            !draft.repeatInfringerDecision.trim())
                        }
                        onClick={() => void applyStatus(report, draft)}
                      >
                        {'Save status'}
                      </Button>
                    </Stack>
                  </Stack>
                </CardDisplay>
              )
            })}

            {/* The reports' pages: the route answers one at a time. */}
            <StaffListPaginationControls pagination={reportList} />

            {/*
              THE §512(g) QUEUE (AGL-1983).
              Below the reports, because a counter-notice answers one — but
              never hidden behind a tab, because the deadline on it runs
              whether or not anybody clicked through. Ordered oldest-first by
              the route: the oldest is the closest to becoming a breach.
            */}
            <CardDisplay
              header={'Counter-notices (DMCA put-back)'}
              help={docsHelp('abuseReports', { anchor: '#counter-notices' })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  {
                    'A subscriber whose material we removed can answer with a sworn counter-notice. Forward it to the complainant, and unless they tell us they have filed a court action, access goes back on the statutory date. Forwarding is what stamps that date onto the site’s own suspension, so the lock lifts itself.'
                  }
                </Typography>
                {!counterList.loading && !counterList.failed && !counterNotices.length ? (
                  <Typography variant="body2" color="text.secondary">
                    {
                      'No counter-notices. If a removal was wrong this is where the customer would appear, so a long silence is worth checking against the public form at /api/counter-notice rather than read as agreement.'
                    }
                  </Typography>
                ) : null}
                {counterList.pageIndex > 0 ? (
                  <Alert severity="info">
                    {
                      'The first page holds the oldest counter-notices — the ones closest to their deadline.'
                    }
                  </Alert>
                ) : null}
              </Stack>
            </CardDisplay>

            {counterNotices.map((notice) => {
              const draft = counterDraftFor(notice)
              const unchanged =
                draft.status === notice.status && !draft.resolution.trim()
              return (
                <CardDisplay
                  key={notice.id}
                  header={
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Typography variant="subtitle1">
                        {notice.reference ?? notice.id}
                      </Typography>
                      <Chip
                        size="small"
                        label={notice.status}
                        color={COUNTER_STATUS_COLOR[notice.status] ?? 'default'}
                        variant={notice.status === 'received' ? 'filled' : 'outlined'}
                      />
                      {notice.overdue ? (
                        <Chip size="small" color="error" label="PAST DEADLINE" />
                      ) : null}
                      {notice.submissionCount > 1 ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`resubmitted ×${notice.submissionCount}`}
                        />
                      ) : null}
                    </Stack>
                  }
                  help={docsHelp('abuseReports', {
                    excerpt:
                      'A counter-notice to a takedown, and the statutory clock it starts. ' +
                      'Past the deadline, the content goes back up.',
                  })}
                  contentGutterX
                  contentGutterY
                >
                  <Stack spacing={1.5}>
                    {notice.overdue ? (
                      <Alert severity="error">
                        {
                          'The restoration deadline has passed and access is still not back. Restore it now, or record why it is lawfully held (a filed court action is the only reason §512(g) recognizes).'
                        }
                      </Alert>
                    ) : null}

                    {/*
                      The URL is text, never a link — same invariant the report
                      rows keep, and for the same reason: an attacker-supplied
                      address rendered to the one session that can suspend any
                      site on the platform.
                    */}
                    <Stack spacing={0.25}>
                      <Typography variant="caption" color="text.secondary">
                        {'Where the material was'}
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center' }}
                      >
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                        >
                          {notice.url ?? '—'}
                        </Typography>
                        {notice.url ? (
                          <Button
                            size="small"
                            onClick={() => copyUrl(notice.url as string)}
                          >
                            {'Copy'}
                          </Button>
                        ) : null}
                      </Stack>
                    </Stack>

                    <Stack spacing={0.25}>
                      <Typography variant="caption" color="text.secondary">
                        {'What the subscriber says was removed'}
                      </Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {notice.material ?? '—'}
                      </Typography>
                    </Stack>

                    {/*
                      The clock, shown as the WINDOW and not just a date — an
                      operator has to be able to see that the day we picked
                      sits inside the range §512(g)(2)(C) draws, rather than
                      take our word for it.
                    */}
                    <Alert severity={notice.overdue ? 'error' : 'info'}>
                      <Stack spacing={0.25}>
                        <Typography variant="body2">
                          {`Received ${formatMs(notice.receivedAtMs)} — the clock counts from here, not from when we picked it up.`}
                        </Typography>
                        <Typography variant="body2">
                          {`Restore on ${formatMs(notice.restoreAtMs)} (the statute allows ${formatMs(
                            notice.earliestRestoreMs,
                          )} at the earliest and ${formatMs(notice.latestRestoreMs)} at the latest).`}
                        </Typography>
                        {notice.forwardedAtMs ? (
                          <Typography variant="body2">
                            {`Forwarded to the complainant ${formatMs(notice.forwardedAtMs)}.`}
                          </Typography>
                        ) : (
                          <Typography variant="body2">
                            {
                              'Not yet forwarded. §512(g)(2)(A) asks us to send the complainant a copy promptly.'
                            }
                          </Typography>
                        )}
                      </Stack>
                    </Alert>

                    {/*
                      The sworn statements, as CLAIMS. Nothing here adjudicates
                      them, and the page must never read as if we had — the
                      same posture the report side takes with a §512(c)(3)
                      affirmation.
                    */}
                    <Stack spacing={0.25}>
                      <Typography variant="caption" color="text.secondary">
                        {'Sworn by the subscriber'}
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ flexWrap: 'wrap' }}
                      >
                        <Chip
                          size="small"
                          variant="outlined"
                          color={notice.goodFaithMistake ? 'success' : 'error'}
                          label="Mistake or misidentification (under penalty of perjury)"
                        />
                        <Chip
                          size="small"
                          variant="outlined"
                          color={notice.consentJurisdiction ? 'success' : 'error'}
                          label="Consents to federal jurisdiction"
                        />
                        <Chip
                          size="small"
                          variant="outlined"
                          color={notice.acceptService ? 'success' : 'error'}
                          label="Will accept service of process"
                        />
                      </Stack>
                    </Stack>

                    <Stack spacing={0.25}>
                      <Typography variant="caption" color="text.secondary">
                        {'Who filed it — this is what we must pass to the complainant'}
                      </Typography>
                      {notice.identityVisible ? (
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {[
                            notice.subscriberName,
                            notice.subscriberEmail,
                            notice.subscriberPhone,
                            notice.subscriberAddress,
                          ]
                            .filter(Boolean)
                            .join('\n') || '—'}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {
                            'Withheld from your staff role. A counter-notice carries a home address and a phone number the filer had no choice about giving, so only super staff — who have to put the two parties in contact — see it.'
                          }
                        </Typography>
                      )}
                      {/* AGL-2400. Unconditional here: §512(g)(3) requires an
                          address on every counter-notice, so unlike a report
                          there is no anonymous case and a receipt was always
                          owed. */}
                      {(() => {
                        const receipt = receiptLine(notice)
                        return (
                          <Typography
                            variant="body2"
                            color={
                              receipt.failed ? 'error.main' : 'text.secondary'
                            }
                          >
                            {receipt.text}
                          </Typography>
                        )
                      })()}
                      {notice.noticeReference ? (
                        <Typography variant="caption" color="text.secondary">
                          {`Answering notice ${notice.noticeReference}. Restoring will withdraw the strike that notice earned.`}
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {
                            'The subscriber did not quote a notice reference, so restoring cannot withdraw a strike automatically — match it up by hand before closing.'
                          }
                        </Typography>
                      )}
                    </Stack>

                    {notice.resolution ? (
                      <Alert severity="success">
                        {`${notice.resolution}${
                          notice.resolvedBy ? ` — ${notice.resolvedBy}` : ''
                        }`}
                      </Alert>
                    ) : null}

                    <Divider />

                    <Stack spacing={1}>
                      <TextField
                        select
                        size="small"
                        label="Next step"
                        value={draft.status}
                        onChange={(event) =>
                          setCounterDrafts((entries) => ({
                            ...entries,
                            [notice.id]: { ...draft, status: event.target.value },
                          }))
                        }
                      >
                        {(summary?.counterNoticeStatuses ?? []).map((status) => (
                          <MenuItem key={status} value={status}>
                            {status}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Typography variant="caption" color="text.secondary">
                        {COUNTER_STATUS_HINT[draft.status] ?? ''}
                      </Typography>
                      <TextField
                        size="small"
                        label="What you did, and why (required)"
                        placeholder="e.g. Copy of the counter-notice emailed to rights@studio.test"
                        multiline
                        minRows={2}
                        value={draft.resolution}
                        onChange={(event) =>
                          setCounterDrafts((entries) => ({
                            ...entries,
                            [notice.id]: {
                              ...draft,
                              resolution: event.target.value,
                            },
                          }))
                        }
                      />
                      <Stack direction="row" spacing={1}>
                        <Button
                          variant="contained"
                          disabled={busy || unchanged || !draft.resolution.trim()}
                          onClick={() => void applyCounterNotice(notice, draft)}
                        >
                          {'Save step'}
                        </Button>
                      </Stack>
                    </Stack>
                  </Stack>
                </CardDisplay>
              )
            })}

            {/* The counter-notices' pages, oldest first. */}
            <StaffListPaginationControls pagination={counterList} />

            <CardDisplay
              header={'Changes made in this session'}
              help={docsHelp('abuseReports', { anchor: '#statuses' })}
              contentGutterX
              contentGutterY
            >
              {log.length ? (
                <Stack spacing={0.5}>
                  {log.map((entry) => (
                    <Typography
                      key={`${entry.atMs}-${entry.text}`}
                      variant="body2"
                      color={entry.confirmed ? 'text.primary' : 'error.main'}
                    >
                      {`${new Date(entry.atMs).toLocaleTimeString()} — ${entry.text}${
                        entry.confirmed ? '' : ' — NOT CONFIRMED'
                      }`}
                    </Typography>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {
                    'Nothing yet. If you pressed Save status and no line appeared here, the click did not reach the server — refresh the queue and check the row before assuming it moved.'
                  }
                </Typography>
              )}
            </CardDisplay>
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminAbuseReports.displayName = 'Page:AdminAbuseReports'

export default AdminAbuseReports
