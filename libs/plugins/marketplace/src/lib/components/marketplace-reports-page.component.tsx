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

import { ICON_VARIANT_SYMBOL_FLAG } from '@aglyn/shared-data-enums'
import { PageHeaderHelp, pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

interface MarketplaceReportRow {
  id: string
  status: string
  targetType: string
  listingId: string | null
  listingName: string | null
  publisherOrgId: string | null
  reviewUid: string | null
  reason: string | null
  reporterKnown: boolean
  reporterUid: string | null
  resolution: string | null
  resolvedByEmail: string | null
  createdAtMs: number | null
  updatedAtMs: number | null
}

const STATUS_COLOR: Record<string, 'warning' | 'info' | 'success' | 'default'> =
  {
    open: 'warning',
    reviewing: 'info',
    actioned: 'success',
    dismissed: 'default',
  }

const when = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString() : '—'

/**
 * The marketplace report queue (AGL-2310).
 *
 * The report button on a listing has told users their report was filed since
 * it shipped. `marketplaceReports` was written and read by NOTHING — no
 * surface, no cron, no collection group — so every report was stored,
 * acknowledged and unreachable, and `status` never moved off `open` because
 * no queue displayed it.
 *
 * The page is deliberately the `abuseReports` queue in miniature: a list, a
 * status transition, a note required to close, and an `adminAudit` row per
 * transition. Two vocabularies for the same act is how one of them stops
 * being maintained.
 *
 * The REASON is the row. Everything else — the listing, the publisher, the
 * date — is context for it, which is why it is rendered in full rather than
 * truncated into a column, and why it is never redacted by staff tier.
 */
export function MarketplaceReportsPage() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [reports, setReports] = useState<MarketplaceReportRow[] | null>(null)
  const [identityVisible, setIdentityVisible] = useState(false)
  const [statusFilter, setStatusFilter] = useState('open')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    let active = true
    void (async () => {
      /*
       * The staff claim is the SHELL's now (AGL-3080). This page used to
       * hold `isStaff !== true` here, because it owned its own route and a
       * request fired from the claim's loading `null` answers a question
       * nobody asked. The generic staff route renders every plugin page
       * inside `StaffOnly`, which renders NOTHING while the claim resolves
       * and 404s a non-holder — so being mounted at all is the claim, and a
       * second check here would be a copy free to disagree with it.
       */
      if (!user) return
      setLoading(true)
      setError(null)
      try {
        const response = await authorizedFetch(
          user,
          `/api/marketplace/admin/reports?status=${encodeURIComponent(statusFilter)}`,
        )
        const body = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          setError(body?.error ?? 'Report lookup failed')
        } else {
          setReports((body?.reports ?? []) as MarketplaceReportRow[])
          setIdentityVisible(Boolean(body?.identityVisible))
        }
      } catch {
        if (active) setError('Report lookup failed')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user, statusFilter, epoch])

  const transition = useCallback(
    async (report: MarketplaceReportRow, status: string) => {
      setBusyId(report.id)
      try {
        const response = await authorizedFetch(
          user,
          '/api/marketplace/admin/reports',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: report.id,
              status,
              resolution: notes[report.id] ?? '',
            }),
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          // The server's own sentence, not a generic failure: the one refusal
          // this route issues ("say what you did") is instruction, and
          // replacing it with "Update failed" would leave the reviewer
          // guessing at a rule the server already stated.
          enqueueSnackbar(payload?.error ?? 'Update failed', {
            variant: 'warning',
            allowDuplicate: true,
          })
          return
        }
        enqueueSnackbar(`Marked ${status}`, { variant: 'success', persist: false })
        setEpoch((value) => value + 1)
      } catch {
        enqueueSnackbar('An error has occurred', { variant: 'error' })
      } finally {
        setBusyId(null)
      }
    },
    [user, notes, enqueueSnackbar],
  )

  return (
    <>
      {/*
        The abuse-queue topic, deliberately: this is the same triage job on a
        different surface, and a second docs page describing the same four
        statuses is a second page to forget to update.

        ANCHORED, though, and published rather than declared. The abuse
        queue's own page opens the same topic bare, and two help icons landing
        in exactly the same place are interchangeable — which is the thing
        `docs-help-destinations` exists to catch. A `staffPages` entry carries
        one `docsTopic` and no anchor, so `#statuses` — the four states and
        what closing one means, which is what a reader arriving from HERE
        needs — comes up through the header seam instead.
      */}
      <PageHeaderHelp topic="abuseReports" anchor="#statuses" />
          <Stack spacing={3}>
            {loading && <LinearProgress />}
            {error && <Alert severity="error">{error}</Alert>}
            <CardDisplay
              header={'Reported listings and reviews'}
              help={pluginDocsHelp('abuseReports', {
                excerpt:
                  'Reports users filed against a marketplace listing or a ' +
                  'review, with the reason each one gave. Closing one needs ' +
                  'a note, and every change is audited.',
              })}
              contentGutterX
              contentGutterY
              HeaderProps={{
                action: (
                  <TextField
                    select
                    size="small"
                    value={statusFilter}
                    onChange={(event) => {
                      setReports(null)
                      setStatusFilter(event.target.value)
                    }}
                  >
                    <MenuItem value="open">{'Open'}</MenuItem>
                    <MenuItem value="reviewing">{'Reviewing'}</MenuItem>
                    <MenuItem value="actioned">{'Actioned'}</MenuItem>
                    <MenuItem value="dismissed">{'Dismissed'}</MenuItem>
                    <MenuItem value="">{'Everything'}</MenuItem>
                  </TextField>
                ),
              }}
            >
              {!identityVisible ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                  {'Reporter accounts are hidden at your access level. Every ' +
                    'report still shows whether there is somebody behind it.'}
                </Alert>
              ) : null}
              {reports === null ? (
                <Typography variant="body2" color="text.secondary">
                  {loading ? 'Reading reports…' : ''}
                </Typography>
              ) : reports.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {'Nothing in this state.'}
                </Typography>
              ) : (
                <Stack spacing={3}>
                  {reports.map((report) => (
                    <Stack key={report.id} spacing={1}>
                      <Stack
                        direction="row"
                        sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}
                      >
                        <Chip
                          size="small"
                          color={STATUS_COLOR[report.status] ?? 'default'}
                          label={report.status}
                        />
                        <Chip size="small" variant="outlined" label={report.targetType} />
                        <Typography variant="subtitle2">
                          {report.listingName || report.listingId || report.id}
                        </Typography>
                      </Stack>
                      {/* THE REASON, in full. This is the whole content of a
                          report; a queue that summarised it would be the
                          original silence with an extra click in it. */}
                      <Typography variant="body2">
                        {report.reason || '(no reason given)'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {[
                          report.publisherOrgId
                            ? `publisher ${report.publisherOrgId}`
                            : null,
                          // A REDACTED reporter and an ANONYMOUS one are
                          // different facts: only the second means there is
                          // nobody to follow up with.
                          report.reporterUid
                            ? `reporter ${report.reporterUid}`
                            : report.reporterKnown
                              ? 'reporter hidden'
                              : 'no reporter recorded',
                          `filed ${when(report.createdAtMs)}`,
                          report.resolvedByEmail
                            ? `closed by ${report.resolvedByEmail}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Typography>
                      {report.resolution ? (
                        <Alert severity="success">{report.resolution}</Alert>
                      ) : null}
                      <Stack
                        direction="row"
                        sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}
                      >
                        <TextField
                          size="small"
                          placeholder="What did you do, and why?"
                          value={notes[report.id] ?? ''}
                          onChange={(event) =>
                            setNotes((previous) => ({
                              ...previous,
                              [report.id]: event.target.value,
                            }))
                          }
                          sx={{ flex: 1, minWidth: 260 }}
                        />
                        <Button
                          size="small"
                          disabled={busyId === report.id}
                          onClick={() => void transition(report, 'reviewing')}
                        >
                          {'Reviewing'}
                        </Button>
                        <Button
                          size="small"
                          color="success"
                          disabled={busyId === report.id}
                          onClick={() => void transition(report, 'actioned')}
                        >
                          {'Actioned'}
                        </Button>
                        <Button
                          size="small"
                          color="warning"
                          disabled={busyId === report.id}
                          onClick={() => void transition(report, 'dismissed')}
                        >
                          {'Dismiss'}
                        </Button>
                      </Stack>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardDisplay>
          </Stack>
    </>
  )
}
MarketplaceReportsPage.displayName = 'MarketplaceReportsPage'

export default MarketplaceReportsPage
