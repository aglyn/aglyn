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

import type { CampaignRate } from '@aglyn/shared-ui-email-campaigns/model'
import {
  Alert,
  ButtonBase,
  Card,
  CardContent,
  Divider,
  Link,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
// Not a raw MUI `Table`: a destination is a long string, and a raw table is
// cut off by the card around it with nothing able to scroll to what is past
// the edge (AGL-3045).
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import type { OutreachSequence } from '../model/outreach.types'
import {
  outreachSequenceLinkReport,
  outreachSequenceReport,
} from '../model/sequence-report'
import { formatOutreachTime, OutreachLoadProblem } from './outreach-ui'
import type { OutreachSequenceLinksLoad } from './use-outreach-data'

/**
 * WHAT A SEQUENCE MEASURED (AGL-3239).
 *
 * Four figures and one rate, and the sentences saying what each of them is
 * not. The decisions are all in `model/sequence-report.ts`; this renders
 * them and adds no arithmetic of its own — in particular it never divides,
 * so there is no second place a percentage can be computed differently from
 * the way a campaign's report computes it.
 *
 * The caveats are rendered as prominently as the numbers rather than as
 * small print. "Opens aren't measured" is the thing a reader coming from
 * the campaign report most needs told, and a blank where an open rate would
 * be says the opposite of what is true.
 */

export interface OutreachSequenceReportCardProps {
  sequence: Pick<OutreachSequence, 'stats' | 'settings'>
  links: OutreachSequenceLinksLoad
  /** The mailbox's zone, which times are read in; `null` for the reader's own. */
  timeZone: string | null
  /** Lists the people who clicked, on the Enrollments tab (AGL-3332). */
  onShowClickers?: () => void
  /** Lists the people who followed one destination, on the Enrollments tab (AGL-3332). */
  onShowLink?: (url: string) => void
}

/**
 * One figure, with what it counts under it — and where it leads, when it
 * leads somewhere. The sequence's Results and one person's page (AGL-3332)
 * draw their numbers alike.
 */
export function OutreachFigure(props: {
  label: string
  value: string
  hint?: string
  /** Opens the list behind the figure; named for a screen reader by `action`. */
  onClick?: () => void
  action?: string
}) {
  const body: ReactNode = (
    <>
      <Typography variant="h5" component="p" color={props.onClick ? 'primary' : undefined}>
        {props.value}
      </Typography>
      <Typography variant="body2">{props.label}</Typography>
      {props.hint ? (
        <Typography variant="caption" color="text.secondary">
          {props.hint}
        </Typography>
      ) : null}
    </>
  )
  if (!props.onClick) {
    return (
      <Stack spacing={0} sx={{ minWidth: 110 }}>
        {body}
      </Stack>
    )
  }
  return (
    <Tooltip title={props.action}>
      <ButtonBase
        onClick={props.onClick}
        aria-label={`${props.value} ${props.label}. ${props.action}`}
        sx={{
          minWidth: 110,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          textAlign: 'left',
          borderRadius: 1,
          px: 1,
          mx: -1,
          '&:hover, &.Mui-focusVisible': { bgcolor: 'action.hover' },
        }}
      >
        {body}
      </ButtonBase>
    </Tooltip>
  )
}

/** A whole number as the card prints one. */
const count = (value: number): string => value.toLocaleString()

/**
 * A rate and the denominator it was taken over, or the em dash that stands
 * for a rate the model refused to take. The denominator is printed beside
 * the percentage, never dropped: "12% of people emailed" and "12% of people
 * who opened" are different claims and a bare "12%" is neither.
 */
function rateText(rate: CampaignRate | null): { value: string; hint?: string } {
  if (!rate) return { value: '—' }
  return {
    value: `${(rate.value * 100).toFixed(1)}%`,
    hint: `${count(rate.numerator)} of ${count(rate.denominator)} ${rate.denominatorLabel}`,
  }
}

export function OutreachSequenceReportCard(props: OutreachSequenceReportCardProps) {
  const report = outreachSequenceReport(
    props.sequence.stats,
    props.sequence.settings.trackClicks,
  )
  const clickRate = rateText(report.rates.click)
  const links = outreachSequenceLinkReport(
    props.links.status === 'ready' ? (props.links.data ?? undefined) : undefined,
  )

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6" component="h2">
            Results
          </Typography>
          <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', rowGap: 2 }}>
            <OutreachFigure label="Emails sent" value={count(report.sent)} />
            <OutreachFigure
              label="People emailed"
              value={report.people === null ? '—' : count(report.people)}
              {...(report.people === null ? { hint: 'Not counted for this sequence' } : {})}
            />
            <OutreachFigure
              label="Clicked"
              value={count(report.uniqueClicks)}
              hint={
                report.clicks === report.uniqueClicks
                  ? undefined
                  : `${count(report.clicks)} clicks in all`
              }
              {...(props.onShowClickers && report.uniqueClicks > 0
                ? { onClick: props.onShowClickers, action: 'Show who clicked' }
                : {})}
            />
            <OutreachFigure label="Click rate" value={clickRate.value} hint={clickRate.hint} />
            {report.machineClicks > 0 ? (
              <OutreachFigure
                label="Scanner clicks"
                value={count(report.machineClicks)}
                hint="Not in the rate"
              />
            ) : null}
          </Stack>
          {report.lastClickAtMs === null ? null : (
            <Typography variant="body2" color="text.secondary">
              Last click {formatOutreachTime(report.lastClickAtMs, props.timeZone)}
            </Typography>
          )}

          {report.caveats.map((entry) => (
            <Alert key={entry.id} severity="info" variant="outlined">
              {entry.message}
            </Alert>
          ))}

          {props.links.status === 'error' || props.links.status === 'refused' ? (
            <OutreachLoadProblem status={props.links.status} what="the link report" />
          ) : links.rows.length ? (
            <Stack spacing={1}>
              <Divider />
              <Typography variant="subtitle2" component="h3">
                Links followed
              </Typography>
              <ScrollTable size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Destination</TableCell>
                    <TableCell align="right">Clicks</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {links.rows.map((row) => (
                    <TableRow key={row.url} hover={Boolean(props.onShowLink)}>
                      <TableCell sx={{ wordBreak: 'break-all' }}>
                        {props.onShowLink ? (
                          <Link
                            component="button"
                            type="button"
                            variant="body2"
                            underline="hover"
                            onClick={() => props.onShowLink?.(row.url)}
                            aria-label={`Show who followed ${row.url}`}
                            sx={{ textAlign: 'left', wordBreak: 'break-all' }}
                          >
                            {row.url}
                          </Link>
                        ) : (
                          row.url
                        )}
                      </TableCell>
                      <TableCell align="right">{count(row.clicks)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ScrollTable>
              <Typography variant="caption" color="text.secondary">
                {props.onShowLink ? 'Select a destination to see who followed it. ' : ''}
                Two links to the same page are counted as one destination, whatever
                tracking parameters follow the address.
                {links.truncated
                  ? ` ${count(links.overflowClicks)} more clicks went to destinations past the ones listed.`
                  : ''}
              </Typography>
            </Stack>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  )
}
