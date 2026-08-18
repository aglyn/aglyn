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

import { PLAN_LABELS, type OrgPlan } from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import {
  CHURN_SURVEY_DETAIL_MAX_LENGTH,
  CHURN_SURVEY_REASONS,
  type ChurnSurveyReason,
  type RetentionSurface,
} from '../../app/api/_lib/retention'

/**
 * The why-are-you-leaving options, in the order they are offered.
 *
 * Typed `Record<ChurnSurveyReason, string>` on purpose: adding a reason to the
 * closed server set without giving it a label here is a COMPILE error, so the
 * radio list and the set the route validates against cannot drift into a
 * survey that 400s on submit.
 */
const REASON_LABELS: Record<ChurnSurveyReason, string> = {
  too_expensive: "It's too expensive",
  missing_features: 'Missing features I need',
  not_using_enough: "I'm not using it enough",
  switching_provider: "I'm switching to something else",
  technical_issues: 'Technical problems',
  temporary_pause: 'Just pausing for now',
  other: 'Something else',
}

/** The funnel's steps, in order. */
type FunnelStep = 'survey' | 'downsell' | 'winback' | 'confirm'

export interface RetentionFunnelDialogProps {
  open: boolean
  /** Which leave path this is — the survey is stored against it. */
  surface: RetentionSurface
  orgId: string
  /**
   * Whether the downsell/winback steps can be offered at all. An org with no
   * live subscription has nothing to downsell FROM and no subscription to
   * discount, so the funnel is survey → confirm for them.
   */
  subscriptionActive?: boolean
  onClose(): void
  /**
   * Accept the downsell. The caller performs the plan switch — which is a
   * DOWNGRADE, so it lands at the period end like every other one (AGL-1862).
   * Resolving true closes the funnel as retained.
   */
  onDownsell(targetPlan: OrgPlan): Promise<boolean>
  /**
   * The funnel ran to the end and the customer still wants to leave. The
   * caller performs the cancel/delete, passing `funnelId` so the completion is
   * recorded against the survey instead of as a skip.
   */
  onLeave(funnelId: string | null): Promise<void>
}

/**
 * The cancellation/deletion funnel (AGL-1863, under AGL-1859 — Zach's
 * twice-given directive: commitment over churn).
 *
 * Four steps, in order, for BOTH leave paths: a short why-are-you-leaving
 * survey whose answer is stored org-scoped; a downsell to a smaller PAID
 * tier; a time-boxed winback discount; and only then the cancel/delete
 * itself, effective end-of-cycle.
 *
 * Two rules this component exists to honour:
 *
 * - It is a funnel, NOT a trap. Every step has a visible way past it, the
 *   dialog can be closed at any point, and a failure anywhere falls THROUGH
 *   to the leave step rather than stranding someone who wants out. A
 *   retention flow that can strand a customer is a support incident and a
 *   chargeback, not a save.
 * - Every offer's terms come from the SERVER (the survey response says which
 *   tier to downsell to and what the discount is). Nothing here decides a
 *   price.
 */
export function RetentionFunnelDialog({
  open,
  surface,
  orgId,
  subscriptionActive = false,
  onClose,
  onDownsell,
  onLeave,
}: RetentionFunnelDialogProps) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [step, setStep] = useState<FunnelStep>('survey')
  const [reason, setReason] = useState<ChurnSurveyReason | ''>('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [funnelId, setFunnelId] = useState<string | null>(null)
  const [downsellPlan, setDownsellPlan] = useState<OrgPlan | null>(null)
  const [winback, setWinback] = useState<{
    percentOff: number
    months: number
  } | null>(null)

  // Every reopen starts a fresh funnel — a second cancel attempt that resumed
  // at the confirm step with a stale funnelId would attribute the new
  // departure to the old survey.
  useEffect(() => {
    if (!open) return
    setStep('survey')
    setReason('')
    setDetail('')
    setFunnelId(null)
    setDownsellPlan(null)
    setWinback(null)
    setBusy(false)
  }, [open])

  const retentionRequest = useCallback(
    async (body: Record<string, unknown>) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/billing/retention', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ orgId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      return { ok: response.ok, status: response.status, payload }
    },
    [user, orgId],
  )

  const submitSurvey = useCallback(async () => {
    if (!reason) return
    setBusy(true)
    try {
      const { ok, payload } = await retentionRequest({
        action: 'survey',
        surface,
        reason,
        ...(detail.trim() ? { detail: detail.trim() } : {}),
      })
      // A failed survey must not block the exit — record nothing and carry on
      // through the offers. The funnelId stays null, so the eventual cancel
      // records itself as funnel-skipped, which is the honest answer.
      const id = ok && typeof payload?.funnelId === 'string' ? payload.funnelId : null
      setFunnelId(id)
      const target = ok ? (payload?.downsellPlan as OrgPlan | null) : null
      setDownsellPlan(target)
      if (ok && payload?.winbackAvailable) {
        setWinback({
          percentOff: Number(payload.winbackPercentOff),
          months: Number(payload.winbackDurationMonths),
        })
      }
      // Steps with nothing to offer are skipped rather than shown empty.
      if (subscriptionActive && target) setStep('downsell')
      else if (subscriptionActive && ok && payload?.winbackAvailable) setStep('winback')
      else setStep('confirm')
    } finally {
      setBusy(false)
    }
  }, [reason, detail, surface, subscriptionActive, retentionRequest])

  const acceptDownsell = useCallback(async () => {
    if (!downsellPlan) return
    setBusy(true)
    try {
      const retained = await onDownsell(downsellPlan)
      if (retained) onClose()
    } finally {
      setBusy(false)
    }
  }, [downsellPlan, onDownsell, onClose])

  const acceptWinback = useCallback(async () => {
    setBusy(true)
    try {
      const { ok, payload } = await retentionRequest({
        action: 'winback',
        ...(funnelId ? { funnelId } : {}),
      })
      if (ok) {
        enqueueSnackbar(
          `Discount applied — ${payload?.percentOff}% off for the next ` +
            `${payload?.durationMonths} months.`,
          { variant: 'success', persist: false },
        )
        onClose()
        return
      }
      // The offer could not be applied (already used, or Stripe refused).
      // Say so once and move to the exit — never loop someone who is trying
      // to leave back through an offer that cannot be granted.
      enqueueSnackbar(payload?.error ?? 'That offer could not be applied.', {
        variant: 'warning',
        persist: false,
      })
      setStep('confirm')
    } finally {
      setBusy(false)
    }
  }, [retentionRequest, funnelId, enqueueSnackbar, onClose])

  const leave = useCallback(async () => {
    setBusy(true)
    try {
      await onLeave(funnelId)
      onClose()
    } finally {
      setBusy(false)
    }
  }, [onLeave, funnelId, onClose])

  /** Past the offers, to the exit. */
  const skipToNext = useCallback(() => {
    if (step === 'downsell' && winback && subscriptionActive) setStep('winback')
    else setStep('confirm')
  }, [step, winback, subscriptionActive])

  const leaving =
    surface === 'account_delete' ? 'delete this organization' : 'cancel'

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      {step === 'survey' && (
        <>
          <DialogTitle>Before you go — what went wrong?</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              One question, and it genuinely shapes what we build next.
            </DialogContentText>
            <RadioGroup
              value={reason}
              onChange={(event) =>
                setReason(event.target.value as ChurnSurveyReason)
              }
            >
              {CHURN_SURVEY_REASONS.map((value) => (
                <FormControlLabel
                  key={value}
                  value={value}
                  control={<Radio />}
                  label={REASON_LABELS[value]}
                />
              ))}
            </RadioGroup>
            <TextField
              fullWidth
              multiline
              minRows={2}
              sx={{ mt: 2 }}
              label="Anything else? (optional)"
              value={detail}
              // Bounded in the input as well as on the server, so the cap is
              // something you can see rather than something that silently
              // truncates what you typed.
              slotProps={{ htmlInput: { maxLength: CHURN_SURVEY_DETAIL_MAX_LENGTH } }}
              onChange={(event) => setDetail(event.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} disabled={busy}>
              Never mind
            </Button>
            <Button onClick={submitSurvey} disabled={!reason || busy}>
              Continue
            </Button>
          </DialogActions>
        </>
      )}

      {step === 'downsell' && downsellPlan && (
        <>
          <DialogTitle>Would a smaller plan work better?</DialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              <DialogContentText>
                {PLAN_LABELS?.[downsellPlan] ?? downsellPlan} costs less and
                keeps your sites, data and team exactly where they are.
              </DialogContentText>
              <Alert severity="info">
                Moving down takes effect at the end of your current billing
                period — you keep everything you have already paid for until
                then.
              </Alert>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={skipToNext} disabled={busy}>
              No thanks, continue
            </Button>
            <Button variant="contained" onClick={acceptDownsell} disabled={busy}>
              Switch to {PLAN_LABELS?.[downsellPlan] ?? downsellPlan}
            </Button>
          </DialogActions>
        </>
      )}

      {step === 'winback' && winback && (
        <>
          <DialogTitle>Stay for {winback.percentOff}% off?</DialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              <DialogContentText>
                Keep your current plan at {winback.percentOff}% off for the
                next {winback.months} months.
              </DialogContentText>
              {/* The bound is stated, not buried: after the discount runs out
                  the plan returns to its normal price, and someone deciding
                  whether to stay deserves to know that now. */}
              <Typography variant="body2" color="text.secondary">
                After {winback.months} months your plan returns to its regular
                price. One offer per organization.
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setStep('confirm')} disabled={busy}>
              No thanks, continue
            </Button>
            <Button variant="contained" onClick={acceptWinback} disabled={busy}>
              Apply the discount
            </Button>
          </DialogActions>
        </>
      )}

      {step === 'confirm' && (
        <>
          <DialogTitle>
            {surface === 'account_delete'
              ? 'Delete this organization?'
              : 'Cancel your subscription?'}
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              {surface === 'account_delete'
                ? 'This starts the deletion of this organization and everything in it. You can cancel the request during the grace period.'
                : 'Your plan stays active until the end of the paid period, then this organization moves to the Free plan. Nothing is deleted, and you can resume any time before it ends.'}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} disabled={busy}>
              Keep my plan
            </Button>
            <Button color="error" onClick={leave} disabled={busy}>
              Yes, {leaving}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}

export default RetentionFunnelDialog
