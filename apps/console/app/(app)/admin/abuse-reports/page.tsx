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

interface ReportListing {
  reports: AbuseReportRow[]
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
          }),
        })
        const payload = await response.json().catch(() => ({}))
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

  const reports = listing?.reports ?? []
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

                {listing?.truncated ? (
                  <Alert severity="warning">
                    {`This is the first ${listing.pageSize} reports by last update, and the counts above — including the urgent count — describe only those rows. There are more behind them. Filter by status to reach the rest.`}
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
                    </Stack>
                  }
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
                      <Button
                        variant="contained"
                        disabled={busy || needsNote || unchanged}
                        onClick={() => void applyStatus(report, draft)}
                      >
                        {'Save status'}
                      </Button>
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
