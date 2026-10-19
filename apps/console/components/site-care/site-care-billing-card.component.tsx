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

import { describeHours } from '@aglyn/aglyn/app-utils/owner-approval-record'
import {
  formatSiteCareMinutes,
  formatSiteCareUsd,
  previousSiteCareMonthKey,
  siteCareMonthKey,
  siteCareMonthLabel,
  type SiteCareMonthStatement,
} from '@aglyn/aglyn/app-utils/site-care'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Box, Button, Chip, Collapse, LinearProgress, Stack, Typography } from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSiteCareCall } from './site-care-api'
import SiteCareHistoryList, { type SiteCareHistoryEntry } from './site-care-history-list.component'
import { docsHelp } from '../../constants/docs-links'

interface Statement {
  siteCare: boolean
  statement: SiteCareMonthStatement
  sentence: string
  requests: Array<{ ticketId: string; title: string; line: string }>
  history: SiteCareHistoryEntry[]
}

export interface SiteCareBillingCardProps {
  orgId: string
}

/**
 * The Site Care card on Billing (AGL-3959): the month's requests, the minutes
 * used of the included hour, the extra time billed, and everything recorded
 * about them in plain words — the same statement the extra-time invoice line
 * carries and staff can email on demand.
 */
export function SiteCareBillingCard({ orgId }: SiteCareBillingCardProps) {
  const call = useSiteCareCall()
  const callRef = useRef(call)
  callRef.current = call
  const current = useMemo(() => siteCareMonthKey(Date.now()), [])
  const [month, setMonth] = useState(current)
  const [data, setData] = useState<Statement | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    let active = true
    void callRef
      .current<Statement>(`/api/site-care/requests?orgId=${encodeURIComponent(orgId)}&month=${encodeURIComponent(month)}`)
      .then((answer) => {
        if (!active) return
        if (answer.ok) {
          setData(answer.body)
          setFailed(null)
        } else if (answer.status) {
          setFailed(answer.body.error ?? 'Site Care could not be read')
        }
      })
    return () => {
      active = false
    }
  }, [orgId, month])

  const statement = data?.statement
  const used = statement ? Math.min(100, Math.round((statement.includedMinutesUsed / statement.poolMinutes) * 100)) : 0
  const previous = previousSiteCareMonthKey(current)

  return (
    <Box id="site-care">
      <CardDisplay
        header={`Site Care · ${siteCareMonthLabel(month)}`}
        help={docsHelp('addOns', { anchor: '#site-care-statement' })}
        subheader="Changes our team made to your site this month, and the time they took."
        HeaderProps={{
          action: (
            <Stack direction="row" spacing={1}>
              {[current, previous].map((key) => (
                <Chip
                  key={key}
                  size="small"
                  label={key === current ? 'This month' : 'Last month'}
                  color={month === key ? 'primary' : 'default'}
                  variant={month === key ? 'filled' : 'outlined'}
                  onClick={() => setMonth(key)}
                />
              ))}
            </Stack>
          ),
        }}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          {failed ? <Alert severity="warning">{failed}</Alert> : null}
          {!data && !failed ? <LinearProgress /> : null}
          {statement ? (
            <>
              <Stack spacing={0.5}>
                <Typography variant="body2">
                  {`${formatSiteCareMinutes(statement.includedMinutesUsed)} of ${formatSiteCareMinutes(
                    statement.poolMinutes,
                  )} included time used · ${formatSiteCareMinutes(statement.minutesLeft)} left`}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={used}
                  color={statement.minutesLeft === 0 ? 'warning' : 'primary'}
                />
              </Stack>
              <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Chip size="small" label={`${statement.requests} ${statement.requests === 1 ? 'request' : 'requests'}`} />
                <Chip size="small" label={`${formatSiteCareMinutes(statement.minutesLogged)} of work`} />
                <Chip
                  size="small"
                  label={
                    statement.extraHoursBilled
                      ? `Extra time: ${describeHours(statement.extraHoursBilled)}, ${formatSiteCareUsd(statement.extraBilledCents)}`
                      : 'No extra time billed'
                  }
                />
              </Stack>
              {data && data.requests.length ? (
                <Stack spacing={0.5} component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {data.requests.map((request) => (
                    <Typography key={request.ticketId} component="li" variant="body2">
                      {request.line}
                    </Typography>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {'No requests this month. Email a change to us, or use Request a change on your site’s dashboard.'}
                </Typography>
              )}
              {data && data.history.length ? (
                <Stack spacing={1}>
                  <Box>
                    <Button size="small" onClick={() => setShowHistory((value) => !value)}>
                      {showHistory ? 'Hide what we recorded' : 'Everything we recorded'}
                    </Button>
                  </Box>
                  <Collapse in={showHistory} unmountOnExit>
                    <SiteCareHistoryList rows={data.history} />
                  </Collapse>
                </Stack>
              ) : null}
            </>
          ) : null}
        </Stack>
      </CardDisplay>
    </Box>
  )
}

SiteCareBillingCard.displayName = 'SiteCareBillingCard'

export default SiteCareBillingCard
