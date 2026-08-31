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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useEffect, useState } from 'react'
import { docsHelp } from '../constants/docs-links'

/** The report body `/api/admin/churn-report` returns. */
interface ChurnReportBody {
  byReason: Record<string, number>
  bySurface: Record<string, number>
  byPlan: Record<string, number>
  surveys: number
  cancels: { total: number; funnelSkipped: number }
  winbacks: { reserved: number; applied: number }
  scanned: number
  capped: boolean
  comments: Array<{
    id: string
    detail: string
    atMs: number | null
    reason: string | null
    surface: string | null
    plan: string | null
  }>
  commentsCapped: boolean
}

/** `too_expensive` → `Too expensive`. The stored value is the closed-set key. */
function humanize(key: string): string {
  const spaced = key.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Descending, so the reason people actually give is the first line read. */
function ranked(counts: Record<string, number>): Array<[string, number]> {
  return Object.entries(counts ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
}

/**
 * Why people left, on the staff console (AGL-2248, under AGL-1863).
 *
 * The funnel has stored every survey answer since AGL-1863 and nothing could
 * read them: `orgs/{orgId}/retention` is Admin-SDK-only, so the answers were
 * reachable only by opening the Firebase console one workspace at a time.
 * the rule — a capability is not a feature until the console exposes it.
 *
 * Counts, and — since AGL-2294 — the free text behind a disclosure.
 *
 * That text was left out here on the argument that "a rate report is not what
 * anyone reads prose for". Right about the rate report; the trouble was that
 * nothing else read it either. `churnSurveyDetails` had one writer and no
 * reader anywhere in the product, so every sentence a departing customer typed
 * sat unread until its 365-day TTL (AGL-1978) deleted it — the same shape as
 * the retention collection this card was built to fix, one document deeper.
 *
 * COLLAPSED, and last. The counts are what a rate report is for and they stay
 * the thing you see; the prose is opened deliberately by someone who has
 * decided to read it. That is the smallest reach that still makes the write
 * honest — a textarea the product asks a person to fill in, whose contents
 * nobody can ever see, is worse than a card with prose on it.
 */
export default function StaffChurnReportCard() {
  const { data: user } = useUser()
  const [report, setReport] = useState<ChurnReportBody | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await authorizedFetch(user, '/api/admin/churn-report')
        const payload = await response.json().catch(() => ({}))
        if (cancelled) return
        if (!response.ok) {
          setError(payload?.error ?? 'Could not load the churn report')
          return
        }
        setReport(payload as ChurnReportBody)
      } catch {
        if (!cancelled) setError('Could not load the churn report')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  const reasons = ranked(report?.byReason ?? {})
  const surfaces = ranked(report?.bySurface ?? {})
  const plans = ranked(report?.byPlan ?? {})

  return (
    <CardDisplay
      header={'Why people leave'}
      help={docsHelp('staffConsole', {
        anchor: '#whats-there',
        excerpt:
          'Answers to the cancellation and account-deletion survey, counted ' +
          'by reason, by which flow they came from, and by the plan the ' +
          'workspace was on. Free-text answers are not shown here.',
      })}
      contentGutterX
      contentGutterY
    >
      {error ? (
        <Alert severity="warning">{error}</Alert>
      ) : !report ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      ) : report.surveys === 0 ? (
        // Zero surveys and zero departures are different facts, and the
        // difference is the whole reason `funnelSkipped` is recorded: people
        // leaving without ever being asked is a finding, not an empty state.
        <Typography variant="body2" color="text.secondary">
          {report.cancels.total > 0
            ? `No survey answers yet — but ${report.cancels.total} departure${
                report.cancels.total === 1 ? '' : 's'
              } recorded, ${report.cancels.funnelSkipped} of them without the funnel.`
            : 'Nobody has answered the survey yet.'}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          <Stack spacing={0.5}>
            {reasons.map(([reason, count]) => (
              <Stack
                key={reason}
                direction="row"
                sx={{ justifyContent: 'space-between' }}
              >
                <Typography variant="body2">{humanize(reason)}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {`${count} (${Math.round((count / report.surveys) * 100)}%)`}
                </Typography>
              </Stack>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {`${report.surveys} answered · by flow: ${surfaces
              .map(([surface, count]) => `${humanize(surface)} ${count}`)
              .join(' · ')}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {`By plan: ${plans
              .map(([plan, count]) => `${plan} ${count}`)
              .join(' · ')}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {/* The funnel-skipped count is the honesty line: the survey
                numbers above exclude every departure that never saw it. */}
            {`${report.cancels.total} departure${
              report.cancels.total === 1 ? '' : 's'
            } recorded, ${
              report.cancels.funnelSkipped
            } without the funnel · ${report.winbacks.applied}/${
              report.winbacks.reserved
            } winback offers applied`}
          </Typography>
          {report.capped ? (
            // Never silently. A capped aggregate that does not say so reads
            // as a total and is one.
            <Alert severity="info">
              {`Showing the first ${report.scanned} retention records — there are more.`}
            </Alert>
          ) : null}
          {report.comments?.length ? (
            <Accordion disableGutters elevation={0}>
              <AccordionSummary>
                <Typography variant="body2">
                  {`What they wrote (${report.comments.length})`}
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  {/*
                    A standing reminder rather than a one-off note: this is
                    other people's prose, kept for a year and then deleted, and
                    the reason it is bounded at all is that a free-text box is
                    where somebody types a name, an invoice number, or a
                    grievance about a colleague.
                  */}
                  <Typography variant="caption" color="text.secondary">
                    {'Verbatim customer text, deleted 365 days after it was ' +
                      'written. Treat as personal data.'}
                  </Typography>
                  {report.comments.map((comment) => (
                    <Stack key={comment.id} spacing={0.5}>
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        {/*
                          The closed-set reason is what makes a sentence
                          legible. A survey outside the scanned window leaves
                          it null, and the row says so rather than implying
                          the person gave no reason.
                        */}
                        <Chip
                          size="small"
                          variant="outlined"
                          label={
                            comment.reason
                              ? humanize(comment.reason)
                              : 'Reason not in this window'
                          }
                        />
                        <Typography variant="caption" color="text.secondary">
                          {[
                            comment.surface ? humanize(comment.surface) : null,
                            comment.plan,
                            comment.atMs
                              ? new Date(comment.atMs).toLocaleDateString()
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Typography>
                      </Stack>
                      <Typography variant="body2">{comment.detail}</Typography>
                    </Stack>
                  ))}
                  {report.commentsCapped ? (
                    <Alert severity="info">
                      {'More free-text answers exist than were scanned.'}
                    </Alert>
                  ) : null}
                </Stack>
              </AccordionDetails>
            </Accordion>
          ) : null}
        </Stack>
      )}
    </CardDisplay>
  )
}

StaffChurnReportCard.displayName = 'StaffChurnReportCard'
