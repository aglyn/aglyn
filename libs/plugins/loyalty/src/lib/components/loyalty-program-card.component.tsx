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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, FormControlLabel, Grid, Stack, Switch, TextField, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { LOYALTY_API_ROUTES } from '../constants/api-routes'
import { formatLoyaltyCents, formatPoints } from '../model/loyalty-math'
import type { LoyaltyProgramTotals } from '../model/loyalty-member'
import { LOYALTY_CONNECTOR_LABELS } from '../model/loyalty-connectors'
import { loyaltyRewardRatePct, type LoyaltyProgram } from '../model/loyalty-program'
import { centsFromDollars, dollarsFromCents, useLoyaltyFetch } from './loyalty-api'

export interface LoyaltyProgramAnswer {
  program: LoyaltyProgram
  totals: LoyaltyProgramTotals
}

/** Every field the card edits: which account owns the points is the connection card's (AGL-3677). */
type EditableKey = Exclude<keyof LoyaltyProgram, 'connected'>
type Draft = Record<EditableKey, string | boolean>

const MONEY_FIELDS = new Set<EditableKey>(['referrerRewardCents', 'refereeRewardCents', 'refereeMinimumCents'])

function toDraft(program: LoyaltyProgram): Draft {
  const draft = {} as Draft
  for (const [key, value] of Object.entries(program) as Array<[EditableKey, number | boolean]>) {
    if ((key as string) === 'connected') continue
    draft[key] = typeof value === 'boolean' ? value : MONEY_FIELDS.has(key) ? dollarsFromCents(value) : String(value)
  }
  return draft
}

/** The draft as a change the route checks, or the first field that is not a number. */
function toChange(draft: Draft): { change: Record<string, unknown> } | { problem: string } {
  const change: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(draft) as Array<[EditableKey, string | boolean]>) {
    if (typeof value === 'boolean') {
      change[key] = value
    } else if (MONEY_FIELDS.has(key)) {
      const cents = centsFromDollars(value)
      if (cents === null) return { problem: 'Enter amounts in dollars, such as 10 or 7.50.' }
      change[key] = cents
    } else {
      const number = Number(String(value).trim())
      if (!String(value).trim() || !Number.isInteger(number)) return { problem: 'Enter whole numbers for points.' }
      change[key] = number
    }
  }
  return { change }
}

/**
 * THE REWARDS PROGRAM, under the store's Promotions (AGL-3640): whether
 * customers earn, the earn and redeem rates, the referral offer, and the
 * emails — with what members hold right now, which is a liability the store
 * owes. Save sits in the card's header. Changing the program needs an admin;
 * anyone on the site can read it.
 */
export function LoyaltyProgramCard(props: { hostId: string; onChanged?: (answer: LoyaltyProgramAnswer) => void }) {
  const { hostId, onChanged } = props
  const request = useLoyaltyFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [answer, setAnswer] = useState<LoyaltyProgramAnswer | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    request<LoyaltyProgramAnswer>(LOYALTY_API_ROUTES.program, { query: { hostId } })
      .then((next) => {
        if (!live) return
        setAnswer(next)
        setDraft(toDraft(next.program))
        onChanged?.(next)
      })
      .catch((cause: Error) => live && setError(cause.message))
    return () => {
      live = false
    }
  }, [hostId, request, onChanged])

  const dirty = useMemo(
    () => Boolean(answer && draft && JSON.stringify(toDraft(answer.program)) !== JSON.stringify(draft)),
    [answer, draft],
  )

  if (error) return <Alert severity="error">{error}</Alert>
  if (!answer || !draft) return null

  const save = async () => {
    const parsed = toChange(draft)
    if ('problem' in parsed) {
      enqueueSnackbar(parsed.problem, { variant: 'error' })
      return
    }
    setSaving(true)
    try {
      const next = await request<LoyaltyProgramAnswer>(LOYALTY_API_ROUTES.program, { body: { hostId, program: parsed.change } })
      setAnswer(next)
      setDraft(toDraft(next.program))
      onChanged?.(next)
      enqueueSnackbar('Rewards program saved', { variant: 'success' })
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const text = (key: EditableKey, label: string, helper: string, money = false) => (
    <TextField
      label={label}
      value={String(draft[key])}
      onChange={(event) => setDraft((prior) => (prior ? { ...prior, [key]: event.target.value } : prior))}
      helperText={helper}
      inputMode={money ? 'decimal' : 'numeric'}
      slotProps={{ htmlInput: { 'data-testid': `loyalty-${key}` } }}
      fullWidth
    />
  )
  const toggle = (key: 'enabled' | 'referralsEnabled' | 'emails', label: string) => (
    <FormControlLabel
      control={
        <Switch
          checked={Boolean(draft[key])}
          onChange={(event) => setDraft((prior) => (prior ? { ...prior, [key]: event.target.checked } : prior))}
          slotProps={{ input: { 'aria-label': label } }}
        />
      }
      label={label}
    />
  )

  const program = answer.program
  const totals = answer.totals
  const connected = program.connected ? LOYALTY_CONNECTOR_LABELS[program.connected] : null
  return (
    <CardDisplay
      header="Rewards"
      subheader={
        connected
          ? `Customers earn points on every order, online and at the register, and spend them like store credit. The points are kept in your ${connected} account; these rates decide what each order earns and what points are worth here.`
          : `Customers earn points on every order, online and at the register, and spend them like store credit. Today a member gets back ${loyaltyRewardRatePct(program)}% of what they spend.`
      }
      help={pluginDocsHelp('loyalty', {
        anchor: '#set-up-your-program',
        excerpt: 'Set how many points a dollar earns, what points are worth, and the referral offer.',
      })}
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <StatusChip
              label={program.enabled ? 'On' : 'Off'}
              tone={program.enabled ? 'success' : 'neutral'}
              data-testid="loyalty-program-status"
            />
            <Button variant="contained" disabled={saving || !dirty} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={3}>
        {totals.members !== null ? (
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="overline" color="text.secondary">
                {'Members'}
              </Typography>
              <Typography variant="h6">{formatPoints(totals.members)}</Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="overline" color="text.secondary">
                {connected ? `Points (last read from ${connected})` : 'Points held'}
              </Typography>
              <Typography variant="h6">{formatPoints(totals.outstandingPoints ?? 0)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {`Worth ${formatLoyaltyCents(totals.outstandingPointsCents ?? 0)}`}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="overline" color="text.secondary">
                {'Store credit held'}
              </Typography>
              <Typography variant="h6">{formatLoyaltyCents(totals.outstandingCreditCents ?? 0)}</Typography>
            </Grid>
          </Grid>
        ) : null}
        {toggle('enabled', 'Customers earn and spend rewards')}
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            {text('earnPointsPerDollar', 'Points per dollar spent', 'On goods, after discounts. Never on shipping, tax or tips.')}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {text('pointsPerDollar', 'Points for $1 off', 'What points are worth when a customer spends them.')}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {text('minRedeemPoints', 'Points needed to redeem', 'A customer spends points once they hold at least this many.')}
          </Grid>
          {connected ? null : (
            <Grid size={{ xs: 12, sm: 6 }}>
              {text('welcomePoints', 'Welcome points', 'Given with a customer’s first order. 0 for none.')}
            </Grid>
          )}
        </Grid>
        {connected ? null : (
          <Stack spacing={2}>
          {toggle('referralsEnabled', 'Members can refer friends')}
          {draft.referralsEnabled ? (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                {text('refereeRewardCents', 'Friend’s first-order credit ($)', 'Taken off the friend’s first order.', true)}
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                {text('refereeMinimumCents', 'Friend’s minimum order ($)', '0 for any order.', true)}
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                {text('referrerRewardCents', 'Member’s reward ($)', 'Store credit once the friend’s order is paid.', true)}
              </Grid>
            </Grid>
          ) : null}
          </Stack>
        )}
        {toggle('emails', 'Email members what they earn and are given')}
      </Stack>
    </CardDisplay>
  )
}

export default LoyaltyProgramCard
