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
  DialogContentText,
  DialogTitle,
  Stack,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useEffect, useState } from 'react'
import type { OutreachEnrollment, OutreachSequenceStep } from '../model/outreach.types'
import {
  OutreachCuratedStepEditor,
  outreachDraftState,
  outreachDraftToOverride,
  outreachMemberDraftStates,
  type OutreachCuratedDraftState,
} from './curated-step-editor'
import { OutreachLoading } from './outreach-ui'
import type { OutreachApi } from './use-outreach-api'

/**
 * CURATE THE NEXT STEP OF AN ENROLLMENT (AGL-3324): Enrollments tab › row ›
 * Curate next step.
 *
 * Step 2 of a sequence was written before the person replied, clicked or
 * changed their site; this rewrites it for them now. The dialog asks the
 * workspace's AI for the next email step's copy the moment it opens, shows
 * it in the editor, and stores it only on "Use this" — through the save
 * route, which validates it again and files "Curated step N" on the
 * person's record. "Keep the template" clears a copy the enrollment already
 * carried for the step, so the step goes back to the sequence's own words.
 *
 * When the AI cannot draft — the workspace has no generator, the member
 * lacks the permission, the allotment is spent — the member can still write
 * the copy themselves, from the step's own words.
 */

/** The next email step that has not gone out, or `null`. */
export function outreachNextEmailStepIndex(
  enrollment: Pick<OutreachEnrollment, 'stepIndex' | 'status'>,
  steps: readonly OutreachSequenceStep[],
): number | null {
  if (enrollment.status !== 'active' && enrollment.status !== 'paused') return null
  const index = steps.findIndex((step, position) => position >= enrollment.stepIndex && step.kind === 'email')
  return index >= 0 ? index : null
}

/** "Email 2 · step 3", as the sequence's preview names an email. */
export function outreachEmailStepLabel(steps: readonly OutreachSequenceStep[], stepIndex: number): string {
  const position = steps.slice(0, stepIndex + 1).filter((step) => step.kind === 'email').length
  return `Email ${position} · step ${stepIndex + 1}`
}

export interface OutreachCurateStepDialogProps {
  /** The enrollment to curate, or `null` while closed. */
  enrollment: OutreachEnrollment | null
  steps: readonly OutreachSequenceStep[]
  api: OutreachApi
  onClose(): void
}

type Stage =
  | { kind: 'drafting' }
  | { kind: 'failed'; message: string }
  | { kind: 'editing'; draft: OutreachCuratedDraftState }
  | { kind: 'saving'; draft: OutreachCuratedDraftState }

export function OutreachCurateStepDialog(props: OutreachCurateStepDialogProps) {
  const { enrollment, steps, api } = props
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  const { enqueueSnackbar } = useSnackbar()
  const [stage, setStage] = useState<Stage>({ kind: 'drafting' })
  const stepIndex = enrollment ? outreachNextEmailStepIndex(enrollment, steps) : null
  const enrollmentId = enrollment?.id ?? null
  const existing = stepIndex !== null ? enrollment?.stepOverrides?.[String(stepIndex)] : undefined

  useEffect(() => {
    if (!enrollmentId || stepIndex === null) return
    let cancelled = false
    setStage({ kind: 'drafting' })
    api
      .curateDrafts({ enrollmentId, stepIndexes: [stepIndex] })
      .then((answer) => {
        if (cancelled) return
        const draft = answer.drafts.find((entry) => entry.stepIndex === stepIndex)
        if (!draft) {
          setStage({ kind: 'failed', message: 'No draft came back for this step. Try again.' })
          return
        }
        setStage({
          kind: 'editing',
          draft: outreachDraftState(draft, steps, 'ai', { prompt: answer.prompt, model: answer.model }),
        })
      })
      .catch((error) => {
        if (!cancelled) setStage({ kind: 'failed', message: (error as Error).message })
      })
    return () => {
      cancelled = true
    }
  }, [api, enrollmentId, stepIndex, steps])

  const writeItYourself = () => {
    if (stepIndex === null) return
    const [draft] = outreachMemberDraftStates(steps, [stepIndex])
    if (draft) {
      // A copy the enrollment already carries is the better starting point.
      setStage({
        kind: 'editing',
        draft: existing
          ? { ...draft, subject: existing.subject ?? draft.subject, body: existing.body ?? draft.body }
          : draft,
      })
    }
  }

  const decide = async (draft: OutreachCuratedDraftState) => {
    if (!enrollmentId || stepIndex === null) return
    if (draft.decision === 'pending') {
      setStage({ kind: 'editing', draft })
      return
    }
    const override = outreachDraftToOverride(draft)
    if (draft.decision === 'keep' && !existing) {
      props.onClose()
      return
    }
    setStage({ kind: 'saving', draft })
    try {
      await api.saveCuratedStep(
        enrollmentId,
        stepIndex,
        override
          ? {
              ...(override.subject !== undefined ? { subject: override.subject } : {}),
              body: override.body,
              source: override.source,
              ...(override.edited ? { edited: true } : {}),
              ...(override.prompt ? { prompt: override.prompt } : {}),
              ...(override.model ? { model: override.model } : {}),
            }
          : null,
      )
      enqueueSnackbar(
        override ? `Curated step ${stepIndex + 1}. It goes out as written.` : 'Template kept.',
        { variant: 'success' },
      )
      props.onClose()
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
      setStage({ kind: 'editing', draft: { ...draft, decision: 'pending' } })
    }
  }

  const title = enrollment
    ? `Curate the next email for ${enrollment.contactName || enrollment.email}`
    : 'Curate the next email'

  return (
    <Dialog open={Boolean(enrollment)} onClose={props.onClose} fullWidth maxWidth="md" fullScreen={narrow} aria-label={title}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {stepIndex === null ? (
            <Alert severity="info">Every email in this sequence has gone out to this person.</Alert>
          ) : null}
          {stepIndex !== null ? (
            <DialogContentText>
              {`${outreachEmailStepLabel(steps, stepIndex)}, rewritten for this person from their record and your personal line. Nothing is sent until you confirm it.`}
            </DialogContentText>
          ) : null}
          {stage.kind === 'drafting' && stepIndex !== null ? <OutreachLoading label="Drafting the email…" /> : null}
          {stage.kind === 'failed' ? (
            <Stack spacing={1}>
              <Alert severity="warning">{stage.message}</Alert>
              <Stack direction="row">
                <Button size="small" onClick={writeItYourself}>
                  Write it yourself
                </Button>
              </Stack>
            </Stack>
          ) : null}
          {(stage.kind === 'editing' || stage.kind === 'saving') && stepIndex !== null ? (
            <OutreachCuratedStepEditor
              draft={stage.draft}
              label={outreachEmailStepLabel(steps, stepIndex)}
              onChange={(next) => void decide(next)}
              disabled={stage.kind === 'saving'}
            />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} disabled={stage.kind === 'saving'}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
OutreachCurateStepDialog.displayName = 'OutreachCurateStepDialog'

export default OutreachCurateStepDialog
