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

import { describeHours, OWNER_APPROVAL_CHANNEL_LABELS } from '@aglyn/aglyn/app-utils/owner-approval-record'
import {
  formatSiteCareMinutes,
  formatSiteCareUsd,
  previousSiteCareMonthKey,
  siteCareMonthKey,
  siteCareMonthLabel,
  siteCareMonthSentence,
  type SiteCareMonthStatement,
  type SiteCareRequest,
} from '@aglyn/aglyn/app-utils/site-care'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Box, Button, Chip, Collapse, Divider, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildRoute, Route } from '../../constants/route-links'
import { useSiteCareCall } from './site-care-api'
import SiteCareHistoryList, { type SiteCareHistoryEntry } from './site-care-history-list.component'
import { docsHelp } from '../../constants/docs-links'

interface MonthRequest {
  ticketId: string
  subject: string
  status: string
  request: SiteCareRequest
  history: SiteCareHistoryEntry[]
}

interface MonthView {
  month: string
  statement: SiteCareMonthStatement
  goodwillMinutes: number
  requests: MonthRequest[]
  monthHistory: SiteCareHistoryEntry[]
  siteCare: boolean
}

export interface StaffSiteCareMonthCardProps {
  orgId: string
  /** Whether the workspace has Site Care now; without it, an empty month draws nothing. */
  siteCare: boolean
}

/**
 * Site Care on the staff organization page (AGL-3959): the month's every
 * request with its minutes logged and billed (whole hours, rounded up), its
 * approval, its charge, its corrections and the emails sent — the record the
 * owner can ask for — and one button that emails them the same statement.
 * Goodwill minutes are added to a month here, with a reason. Every row of
 * every request's append-only history is one click away.
 */
export function StaffSiteCareMonthCard({ orgId, siteCare }: StaffSiteCareMonthCardProps) {
  const call = useSiteCareCall()
  const { enqueueSnackbar } = useSnackbar()
  const current = useMemo(() => siteCareMonthKey(Date.now()), [])
  const [month, setMonth] = useState(current)
  const [view, setView] = useState<MonthView | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [goodwill, setGoodwill] = useState(false)
  const [minutes, setMinutes] = useState('15')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const callRef = useRef(call)
  callRef.current = call
  const load = useCallback(async (key: string) => {
    const answer = await callRef.current<MonthView>(
      `/api/admin/site-care?orgId=${encodeURIComponent(orgId)}&month=${encodeURIComponent(key)}`,
    )
    if (answer.ok) {
      setView(answer.body)
      setFailed(null)
    } else if (answer.status) {
      setFailed(answer.body.error ?? 'Site Care could not be read')
    }
  }, [orgId])

  useEffect(() => {
    void load(month)
  }, [load, month])

  const post = useCallback(
    async (body: Record<string, unknown>, success: string) => {
      setBusy(true)
      try {
        const answer = await callRef.current<{ sent?: boolean; reason?: string }>('/api/admin/site-care', {
          method: 'POST',
          body: { orgId, month, ...body },
        })
        if (!answer.ok) {
          if (answer.status) enqueueSnackbar(answer.body.error ?? 'Request failed', { variant: 'warning', persist: false })
          return false
        }
        if (answer.body.sent === false) {
          enqueueSnackbar(`Not sent: ${answer.body.reason ?? 'unknown'}`, { variant: 'warning', persist: false })
        } else {
          enqueueSnackbar(success, { variant: 'success', persist: false })
        }
        await load(month)
        return true
      } finally {
        setBusy(false)
      }
    },
    [orgId, month, enqueueSnackbar, load],
  )

  if (!siteCare && view && view.requests.length === 0 && view.monthHistory.length === 0) return null
  const previous = previousSiteCareMonthKey(current)
  const statement = view?.statement

  return (
    <Box id="site-care">
      <CardDisplay
        header={`Site Care · ${siteCareMonthLabel(month)}`}
        help={docsHelp('supportTriage', { anchor: '#site-care-month' })}
        subheader={statement ? siteCareMonthSentence(statement) : 'Loading…'}
        HeaderProps={{
          action: (
            <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
              <Button size="small" disabled={busy} onClick={() => setGoodwill((value) => !value)}>
                {'Add goodwill minutes'}
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={busy || !view}
                onClick={() => void post({ action: 'sendStatement' }, 'Statement emailed to the owner')}
              >
                {'Send statement'}
              </Button>
            </Stack>
          ),
        }}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          {failed ? <Alert severity="warning">{failed}</Alert> : null}
          {statement ? (
            <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" label={`${statement.requests} requests (${statement.openRequests} open)`} />
              <Chip size="small" label={`${formatSiteCareMinutes(statement.minutesLogged)} logged`} />
              <Chip
                size="small"
                label={`${statement.includedMinutesUsed} of ${statement.poolMinutes} included min used`}
                color={statement.minutesLeft === 0 ? 'warning' : 'default'}
              />
              {statement.goodwillMinutes ? (
                <Chip size="small" variant="outlined" label={`${statement.goodwillMinutes} goodwill min`} />
              ) : null}
              <Chip
                size="small"
                label={`${describeHours(statement.extraHoursBilled)} billed · ${formatSiteCareUsd(statement.extraBilledCents)}`}
              />
              {statement.extraReversedCents ? (
                <Chip size="small" variant="outlined" label={`${formatSiteCareUsd(statement.extraReversedCents)} reversed`} />
              ) : null}
            </Stack>
          ) : null}

          {goodwill ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
              <TextField
                label="Minutes"
                type="number"
                size="small"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                slotProps={{ htmlInput: { min: 1, step: 5 } }}
                sx={{ width: { sm: 120 } }}
              />
              <TextField label="Why" size="small" required value={reason} onChange={(e) => setReason(e.target.value)} sx={{ flex: 1 }} />
              <Button
                size="small"
                variant="contained"
                disabled={busy || !Number(minutes) || !reason.trim()}
                onClick={async () => {
                  const ok = await post({ action: 'goodwill', minutes: Number(minutes), reason }, 'Goodwill minutes added')
                  if (ok) {
                    setGoodwill(false)
                    setReason('')
                  }
                }}
              >
                {'Add'}
              </Button>
            </Stack>
          ) : null}

          {view && view.requests.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No Site Care requests this month.'}
            </Typography>
          ) : null}
          {(view?.requests ?? []).map((row) => {
            const r = row.request
            const corrections = row.history.filter((h) => /corrected|voided|credited|refunded|goodwill/.test(h.kind ?? '')).length
            const emails = row.history.filter((h) => h.kind === 'email.sent').length
            return (
              <Stack key={row.ticketId} spacing={0.75}>
                <Divider />
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {row.subject}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[
                        r.state === 'closed' ? `${formatSiteCareMinutes(r.minutesLogged ?? 0)} logged` : 'open',
                        r.state === 'closed' ? `${r.countedMinutes} counted, ${r.includedMinutesUsed} included` : null,
                        r.billedHours ? `${describeHours(r.billedHours)} billed` : null,
                        r.absorbed ? 'absorbed' : null,
                        r.approval
                          ? `approved ${describeHours(r.approval.hours)} ${OWNER_APPROVAL_CHANNEL_LABELS[r.approval.channel].toLowerCase()}`
                          : null,
                        r.charge ? `charge ${r.charge.status}` : null,
                        corrections ? `${corrections} corrections` : null,
                        `${emails} emails`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Typography>
                  </Stack>
                  <Button size="small" component={AppLink} href={`${buildRoute(Route.ADMIN_SUPPORT)}?ticketId=${row.ticketId}`}>
                    {'Open'}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => setOpen((state) => ({ ...state, [row.ticketId]: !state[row.ticketId] }))}
                  >
                    {open[row.ticketId] ? 'Hide history' : 'History'}
                  </Button>
                </Stack>
                <Collapse in={Boolean(open[row.ticketId])} unmountOnExit>
                  <Box sx={{ pl: 2, pt: 1 }}>
                    <SiteCareHistoryList rows={row.history} staff />
                  </Box>
                </Collapse>
              </Stack>
            )
          })}
          {view && view.monthHistory.length ? (
            <Stack spacing={1}>
              <Divider />
              <Typography variant="subtitle2">{'This month'}</Typography>
              <SiteCareHistoryList rows={view.monthHistory} staff />
            </Stack>
          ) : null}
        </Stack>
      </CardDisplay>
    </Box>
  )
}

StaffSiteCareMonthCard.displayName = 'StaffSiteCareMonthCard'

export default StaffSiteCareMonthCard
