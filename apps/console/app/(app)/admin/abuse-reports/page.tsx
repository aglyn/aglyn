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
 * **Counts are page-scoped and say so.** The listing is the first `pageSize`
 * rows by `updatedAt`, so `openUrgent` is "urgent in what you can see". A
 * truncated page renders that sentence rather than an unqualified number,
 * because a queue that looks calm while it is behind is the failure mode this
 * whole arc exists to prevent.
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
import { ICON_VARIANT_SYMBOL_FLAG } from '@aglyn/shared-data-enums'
import { AppLink, CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

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
  dmca: ReportDmca | null
  resolution: string | null
  resolvedBy: string | null
  resolvedAtMs: number | null
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
}

/** The §512(i) verdict for one org, as `repeatInfringerVerdict()` computed it. */
interface RepeatInfringerRow {
  strikes: number
  level: string
  decisionRequired: boolean
  consequence: string
}

interface ReportListing {
  reports: AbuseReportRow[]
  counterNotices: CounterNoticeRow[]
  /** orgId → verdict, for the orgs with a copyright report on this page. */
  strikes: Record<string, RepeatInfringerRow>
  /** Some orgs' counts were past the lookup cap and are UNKNOWN, not zero. */
  strikesTruncated: boolean
  counterNoticesTruncated: boolean
  awaitingForward: number
  overdueRestorations: number
  counterNoticeStatuses: string[]
  count: number
  pageSize: number
  /** The page was full, so these counts describe a window, not the queue. */
  truncated: boolean
  openUrgent: number
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
    'The complainant told us they filed a court action. The material stays down and the scheduled restoration is cancelled.',
  withdrawn: 'The subscriber took the counter-notice back.',
  rejected:
    'Not a counter-notice — a misfiled question, not a judgement on the merits.',
}

/** How loud the repeat-infringer verdict should be. */
const STRIKE_COLOR: Record<string, 'default' | 'warning' | 'error'> = {
  none: 'default',
  warn: 'warning',
  final: 'warning',
  terminate: 'error',
}

/** A closing status is the one the route refuses without a written note. */
const isClosingStatus = (status: string): boolean =>
  status === 'actioned' || status === 'dismissed'

const formatMs = (value: number | null): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toLocaleString()
    : 'unknown'

function AdminAbuseReports() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [listing, setListing] = useState<ReportListing | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, StatusDraft>>({})
  const [counterDrafts, setCounterDrafts] = useState<
    Record<string, CounterNoticeDraft>
  >({})
  const [log, setLog] = useState<
    { atMs: number; text: string; confirmed: boolean }[]
  >([])

  const idToken = useCallback(
    async () => (await (user as any)?.getIdToken?.()) as string | undefined,
    [user],
  )

  /**
   * Read the queue. Open to every staff role — triage is the larger half of
   * the work and `support` can do all of it without ever learning who filed a
   * report, which is exactly why the route redacts rather than refuses.
   */
  const load = useCallback(async () => {
    const token = await idToken()
    if (!token) return
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    const query = params.toString()
    setBusy(true)
    try {
      const response = await fetch(
        `/api/admin/abuse-reports${query ? `?${query}` : ''}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed (${response.status})`)
      }
      setListing({
        reports: Array.isArray(payload.reports) ? payload.reports : [],
        counterNotices: Array.isArray(payload.counterNotices)
          ? payload.counterNotices
          : [],
        strikes:
          payload.strikes && typeof payload.strikes === 'object'
            ? payload.strikes
            : {},
        strikesTruncated: payload.strikesTruncated === true,
        counterNoticesTruncated: payload.counterNoticesTruncated === true,
        awaitingForward: Number(payload.awaitingForward ?? 0),
        overdueRestorations: Number(payload.overdueRestorations ?? 0),
        counterNoticeStatuses: Array.isArray(payload.counterNoticeStatuses)
          ? payload.counterNoticeStatuses
          : [],
        count: Number(payload.count ?? 0),
        pageSize: Number(payload.pageSize ?? 0),
        truncated: payload.truncated === true,
        openUrgent: Number(payload.openUrgent ?? 0),
        identityVisible: payload.identityVisible === true,
        actorRole: String(payload.actorRole ?? 'support'),
        readAtMs: Number(payload.readAtMs ?? Date.now()),
      })
    } catch (error: any) {
      console.error(error)
      // Cleared rather than kept. Rows from the PREVIOUS filter, sitting under
      // a control that now says something else, is a queue an operator reads
      // as empty when it is not.
      setListing(null)
      enqueueSnackbar(error?.message ?? 'Reading the abuse queue failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
      setLoaded(true)
    }
  }, [idToken, statusFilter, enqueueSnackbar])

  const signedInUid = (user as any)?.uid
  useEffect(() => {
    if (!signedInUid) return
    void load()
    // Keyed on WHO is signed in and WHICH filter is chosen, not on `load`.
    // `useUser` returns a fresh object every render, so `idToken` and
    // therefore `load` change identity every render — depending on the
    // callback would re-query the collection on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInUid, statusFilter])

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
      const token = await idToken()
      if (!token) return
      setBusy(true)
      try {
        const response = await fetch('/api/admin/abuse-reports', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: report.id,
            status: draft.status,
            resolution: draft.resolution.trim(),
            ...(draft.repeatInfringerDecision?.trim()
              ? { repeatInfringerDecision: draft.repeatInfringerDecision.trim() }
              : {}),
          }),
        })
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
    [idToken, enqueueSnackbar, load],
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
      const token = await idToken()
      if (!token) return
      setBusy(true)
      try {
        const response = await fetch('/api/admin/abuse-reports', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            counterNoticeId: notice.id,
            counterNoticeStatus: draft.status,
            resolution: draft.resolution.trim(),
          }),
        })
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
                  ? ' — the scheduled restoration was cancelled'
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
    [idToken, enqueueSnackbar, load],
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

  const reports = listing?.reports ?? []
  const counterNotices = listing?.counterNotices ?? []
  // Urgent rows still sitting at `open` are the ones with a clock on them, and
  // the number the route counted is the number this page repeats — recomputing
  // it here would be a second answer to the same question.
  const urgentBacklog = listing ? listing.openUrgent : 0
  const statusOptions = useMemo(
    () => (ABUSE_REPORT_STATUSES as readonly string[]).slice(),
    [],
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
                'Reports filed from the public form. Most reporters are not customers — a bank’s fraud team, a browser vendor, an abuse desk — and their alternative to us answering is a block on the whole *.aglyn.app domain. Triage here, then act with Lockdown (a site or a workspace) or Disabled files (one uploaded file). Every status change is audited; nothing on this page can delete a report.'
              }
            </Alert>

            {busy ? <LinearProgress /> : null}

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
                  <TextField
                    select
                    size="small"
                    label="Status"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    sx={{ minWidth: 200 }}
                  >
                    <MenuItem value="all">{'All statuses'}</MenuItem>
                    {statusOptions.map((status) => (
                      <MenuItem key={status} value={status}>
                        {status}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Typography variant="body2" color="text.secondary">
                    {listing
                      ? `${listing.count} report${listing.count === 1 ? '' : 's'} shown`
                      : 'Reading the queue…'}
                  </Typography>
                  {listing ? (
                    <Typography variant="caption" color="text.secondary">
                      {`read ${new Date(listing.readAtMs).toLocaleString()}`}
                    </Typography>
                  ) : null}
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy}
                    onClick={() => void load()}
                  >
                    {'Refresh'}
                  </Button>
                </Stack>

                {urgentBacklog > 0 ? (
                  <Alert severity="error">
                    {`${urgentBacklog} URGENT report${
                      urgentBacklog === 1 ? ' is' : 's are'
                    } still open. Urgent means phishing, malware, or CSAM: the harm is being done to someone who is not our customer while the row sits here.`}
                  </Alert>
                ) : null}

                {/*
                  The §512(g) breach banner, above the truncation notice and
                  below only the urgent one. An overdue restoration is a
                  customer locked out of their own work past the date the law
                  gave us — a harm we are causing, and the only thing on this
                  page more pressing is active harm to a stranger.
                */}
                {listing && listing.overdueRestorations > 0 ? (
                  <Alert severity="error">
                    {`${listing.overdueRestorations} counter-notice${
                      listing.overdueRestorations === 1 ? ' is' : 's are'
                    } PAST the statutory restoration deadline. Access should already have been restored. Every day this sits is a customer locked out of their own site, and a §512(g) breach we cannot undo by acting later.`}
                  </Alert>
                ) : null}

                {listing && listing.awaitingForward > 0 ? (
                  <Alert severity="warning">
                    {`${listing.awaitingForward} counter-notice${
                      listing.awaitingForward === 1 ? ' has' : 's have'
                    } not been forwarded to the complainant yet. The clock started when the subscriber filed, not when you open this — so the wait comes out of the remaining window rather than being added to theirs.`}
                  </Alert>
                ) : null}

                {listing?.truncated ? (
                  <Alert severity="warning">
                    {`This is the first ${listing.pageSize} reports by last update, and the counts above — including the urgent count — describe only those rows. There are more behind them. Filter by status to reach the rest.`}
                  </Alert>
                ) : null}

                {listing?.strikesTruncated ? (
                  <Alert severity="warning">
                    Some accounts on this page have more copyright reports than
                    the strike lookup covers, so their strike count is UNKNOWN
                    rather than zero. Check the account directly before closing
                    a report on one of them.
                  </Alert>
                ) : null}

                {listing && !listing.identityVisible ? (
                  <Alert severity="info">
                    {`Your staff role (${listing.actorRole}) triages without reporter identity: emails, names and DMCA signatures come back empty by design, not because they are missing. Each report below says whether there was a contactable reporter at all.`}
                  </Alert>
                ) : null}

                {loaded && listing && !reports.length ? (
                  <Typography variant="body2" color="text.secondary">
                    {statusFilter === 'all'
                      ? 'No reports have been filed. That is the good state — but if the public form ever broke it would look exactly like this, so check the form itself before treating a long silence as quiet.'
                      : `No reports with status “${statusFilter}”. Switch the filter to All to see the rest of the queue.`}
                  </Typography>
                ) : null}
              </Stack>
            </CardDisplay>

            {reports.map((report) => {
              const draft = draftFor(report)
              const closing = isClosingStatus(draft.status)
              const needsNote = closing && !draft.resolution.trim()
              const unchanged =
                draft.status === report.status &&
                draft.resolution.trim() === (report.resolution ?? '').trim()
              const severity = report.severity ?? 'normal'
              const urgent = severity === 'urgent'
              // Only for copyright rows, and only when the route actually
              // looked the account up — an absent entry means UNKNOWN (past
              // the lookup cap), never zero, so it renders nothing rather
              // than a reassuring "0 strikes".
              const verdict =
                report.category === 'dmca' && report.orgId
                  ? (listing?.strikes?.[report.orgId] ?? null)
                  : null
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
                          : 'Urgent and still open. The victim of this page is not our customer, and the reporter’s next move if we are silent is a domain-level block on *.aglyn.app.'}
                      </Alert>
                    ) : null}

                    {report.category ? (
                      <Typography variant="body2" color="text.secondary">
                        {CATEGORY_HINT[report.category] ??
                          'This category is not one the current form offers — the report predates a change to the category list.'}
                      </Typography>
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
                            'Lockdown suspends the site or the whole workspace; Disabled files takes one uploaded file off the CDN worldwide and leaves the site serving. Copy the ids above — neither page is pre-filled from here, deliberately, so the target is typed by the person who decided on it.'
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

                    <Stack spacing={0.5}>
                      <Typography variant="caption" color="text.secondary">
                        {'What the reporter said'}
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
                      {report.identityVisible ? (
                        <Typography variant="body2">
                          {report.hasReporterContact
                            ? `${report.reporterName ?? 'no name given'} — ${report.reporterEmail ?? 'no address recorded'}`
                            : 'Filed anonymously. There is no address on this report, so no follow-up question is possible and no acknowledgement can be sent.'}
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
                          {`${report.dmca.goodFaith ? '✓' : '✗'} Good-faith belief the use is not authorised`}
                        </Typography>
                        <Typography variant="caption">
                          {`${report.dmca.underPenalty ? '✓' : '✗'} Under penalty of perjury, authorised to act for the owner`}
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
                        {statusOptions.map((status) => (
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
                {loaded && listing && !counterNotices.length ? (
                  <Typography variant="body2" color="text.secondary">
                    {
                      'No counter-notices. If a removal was wrong this is where the customer would appear, so a long silence is worth checking against the public form at /api/counter-notice rather than read as agreement.'
                    }
                  </Typography>
                ) : null}
                {listing?.counterNoticesTruncated ? (
                  <Alert severity="warning">
                    {`This is the first ${listing.pageSize} counter-notices by receipt. There are older ones behind them, and older means closer to the deadline.`}
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
                          'The restoration deadline has passed and access is still not back. Restore it now, or record why it is lawfully held (a filed court action is the only reason §512(g) recognises).'
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
                        {(listing?.counterNoticeStatuses ?? []).map((status) => (
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
