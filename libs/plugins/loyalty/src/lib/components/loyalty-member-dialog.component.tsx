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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { LOYALTY_API_ROUTES } from '../constants/api-routes'
import { formatLoyaltyCents, formatPoints } from '../model/loyalty-math'
import { LOYALTY_LEDGER_LABELS, type LoyaltyLedgerView, type LoyaltyMemberView } from '../model/loyalty-member'
import { centsFromDollars, newLoyaltyAttemptKey, useLoyaltyFetch } from './loyalty-api'

interface MemberAnswer {
  member: LoyaltyMemberView
  ledger: LoyaltyLedgerView[]
  emailed?: boolean
}

/** One ledger row as the history reads it: `Spent · −120 points · −$5.00`. */
export function describeLedgerEntry(entry: LoyaltyLedgerView): string {
  const parts = [LOYALTY_LEDGER_LABELS[entry.kind] ?? 'Change']
  if (entry.points) parts.push(`${entry.points > 0 ? '+' : '−'}${formatPoints(Math.abs(entry.points))} points`)
  if (entry.creditCents) {
    parts.push(`${entry.creditCents > 0 ? '+' : '−'}${formatLoyaltyCents(Math.abs(entry.creditCents))} credit`)
  }
  return parts.join(' · ')
}

/**
 * One member (AGL-3640): their balances and codes, and their last fifty
 * movements, newest first. "Adjust" opens the change form beside it.
 */
export function LoyaltyMemberDialog(props: {
  hostId: string
  memberId: string
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { hostId, memberId, onClose, onChanged } = props
  const request = useLoyaltyFetch()
  const [answer, setAnswer] = useState<MemberAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState(false)

  useEffect(() => {
    let live = true
    request<MemberAnswer>(LOYALTY_API_ROUTES.member, { query: { hostId, memberId } })
      .then((next) => live && setAnswer(next))
      .catch((cause: Error) => live && setError(cause.message))
    return () => {
      live = false
    }
  }, [hostId, memberId, request])

  const member = answer?.member
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{member ? member.name || member.email : 'Rewards member'}</DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {!member && !error ? <Typography variant="body2">{'Loading…'}</Typography> : null}
        {member ? (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {member.email}
            </Typography>
            <Stack direction="row" spacing={4}>
              <Stack>
                <Typography variant="overline" color="text.secondary">
                  {'Points'}
                </Typography>
                <Typography variant="h6" data-testid="loyalty-member-points">
                  {formatPoints(member.points)}
                </Typography>
              </Stack>
              <Stack>
                <Typography variant="overline" color="text.secondary">
                  {'Store credit'}
                </Typography>
                <Typography variant="h6" data-testid="loyalty-member-credit">
                  {formatLoyaltyCents(member.creditCents)}
                </Typography>
              </Stack>
              <Stack>
                <Typography variant="overline" color="text.secondary">
                  {'Orders'}
                </Typography>
                <Typography variant="h6">{formatPoints(member.ordersCount)}</Typography>
              </Stack>
            </Stack>
            <Typography variant="body2">{`Rewards code: ${member.rewardsCode}`}</Typography>
            {member.referralCode ? <Typography variant="body2">{`Referral code: ${member.referralCode}`}</Typography> : null}
            <Typography variant="subtitle2">{'History'}</Typography>
            {answer.ledger.length ? (
              <List dense disablePadding>
                {answer.ledger.map((entry) => (
                  <ListItem key={entry.id} disableGutters divider>
                    <ListItemText
                      primary={describeLedgerEntry(entry)}
                      secondary={[new Date(entry.atMs).toLocaleString(), entry.note].filter(Boolean).join(' · ')}
                    />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {'Nothing yet.'}
              </Typography>
            )}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        {props.canEdit && member ? <Button onClick={() => setAdjusting(true)}>{'Adjust'}</Button> : null}
        <Button onClick={onClose}>{'Close'}</Button>
      </DialogActions>
      {adjusting && member ? (
        <LoyaltyAdjustDialog
          hostId={hostId}
          member={member}
          onClose={() => setAdjusting(false)}
          onDone={(next) => {
            setAdjusting(false)
            if (next) setAnswer(next)
            onChanged()
          }}
        />
      ) : null}
    </Dialog>
  )
}

/**
 * Adds or takes away points and store credit by hand (AGL-3640). With no
 * member it asks for an email and enrolls it — the "Give store credit"
 * button. One press is one change: the attempt key is fixed when the form
 * opens, so a retried Save cannot apply it twice.
 */
export function LoyaltyAdjustDialog(props: {
  hostId: string
  member: LoyaltyMemberView | null
  onClose: () => void
  onDone: (answer?: MemberAnswer) => void
}) {
  const { hostId, member, onClose, onDone } = props
  const request = useLoyaltyFetch()
  const { enqueueSnackbar } = useSnackbar()
  const attemptKey = useRef(newLoyaltyAttemptKey())
  const [email, setEmail] = useState('')
  const [points, setPoints] = useState('')
  const [credit, setCredit] = useState('')
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const save = async () => {
    const pointsValue = points.trim() ? Number(points.trim()) : 0
    const creditCents = centsFromDollars(credit)
    if (!Number.isInteger(pointsValue)) return setProblem('Enter whole points, such as 100 or -50.')
    if (creditCents === null) return setProblem('Enter store credit in dollars, such as 10 or -5.50.')
    if (!pointsValue && !creditCents) return setProblem('Enter points or store credit to add or take away.')
    setProblem(null)
    setSaving(true)
    try {
      const answer = await request<MemberAnswer>(LOYALTY_API_ROUTES.member, {
        body: {
          hostId,
          ...(member ? { memberId: member.id } : { email }),
          points: pointsValue,
          creditCents,
          note,
          notify,
        },
        idempotencyKey: attemptKey.current,
      })
      enqueueSnackbar(answer.emailed ? 'Saved, and the customer was emailed' : 'Saved', { variant: 'success' })
      onDone(answer)
    } catch (cause) {
      setProblem((cause as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{member ? `Adjust ${member.email}` : 'Give store credit'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {problem ? <Alert severity="error">{problem}</Alert> : null}
          {member ? null : (
            <TextField
              label="Customer email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              helperText="A customer who is not a member yet joins."
              autoFocus
              fullWidth
            />
          )}
          <TextField
            label="Store credit ($)"
            value={credit}
            onChange={(event) => setCredit(event.target.value)}
            helperText="A minus sign takes credit away."
            inputMode="decimal"
            fullWidth
          />
          <TextField
            label="Points"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            helperText="A minus sign takes points away."
            inputMode="numeric"
            fullWidth
          />
          <TextField
            label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            helperText="Kept in the member’s history, and shown in their email."
            fullWidth
          />
          <FormControlLabel
            control={<Switch checked={notify} onChange={(event) => setNotify(event.target.checked)} />}
            label="Email the customer when credit is added"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {'Cancel'}
        </Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
