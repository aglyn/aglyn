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

import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material'
import { type ReactNode, useState } from 'react'
import type { OutreachEnrollmentAction } from '../model/outreach-api'
import type { OutreachEnrollment, OutreachSequenceStep } from '../model/outreach.types'
import { OutreachCurateStepDialog, outreachNextEmailStepIndex } from './curate-step-dialog'
import type { OutreachApi } from './use-outreach-api'

/**
 * WHAT A MEMBER CAN DO TO ONE ENROLLMENT (AGL-2980, AGL-3324), in one place
 * for the two places it is offered: a row's menu on the Enrollments tab, and
 * the header of the person's own page (AGL-3332). The same actions, the same
 * words, the same two confirmations — a Stop that asked first in one place
 * and not in the other would be two products.
 */

/** The four the action route takes, and curating the next step (AGL-3324). */
export type OutreachEnrollmentRowAction = OutreachEnrollmentAction | 'curate'

/** What a member may do to an enrollment in the status it is in. */
export function outreachEnrollmentActionsFor(
  enrollment: OutreachEnrollment,
  steps: readonly OutreachSequenceStep[],
): OutreachEnrollmentRowAction[] {
  const actions: OutreachEnrollmentRowAction[] = []
  // Rewrite the next email for this one person, while one is still to go.
  if (outreachNextEmailStepIndex(enrollment, steps) !== null) actions.push('curate')
  if (enrollment.status === 'active') actions.push('pause', 'stop')
  if (enrollment.status === 'paused') actions.push('resume', 'stop')
  if (enrollment.status !== 'opted_out') actions.push('do_not_contact')
  return actions
}

export const OUTREACH_ENROLLMENT_ACTION_LABELS: Record<OutreachEnrollmentRowAction, string> = {
  curate: 'Curate next step',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  do_not_contact: 'Mark do-not-contact',
}

/** The two actions that end something for good. */
export const OUTREACH_DESTRUCTIVE_ENROLLMENT_ACTIONS: readonly OutreachEnrollmentRowAction[] = [
  'stop',
  'do_not_contact',
]

/** What the snackbar says once an action lands. */
const DONE_LABELS: Record<Exclude<OutreachEnrollmentAction, 'do_not_contact'>, string> = {
  pause: 'Paused.',
  resume: 'Resumed.',
  stop: 'Stopped.',
}

/** The two actions that end something for good ask first. */
const CONFIRM: Partial<Record<OutreachEnrollmentAction, { title: string; body: string; label: string }>> = {
  stop: {
    title: 'Stop this enrollment?',
    body: 'They won’t get any more steps from this sequence, and they can’t be enrolled in it again.',
    label: 'Stop',
  },
  do_not_contact: {
    title: 'Mark do-not-contact?',
    body:
      'The address goes on your organization’s do-not-contact list, which every sequence checks before ' +
      'every send, and they are stopped in every sequence they are in.',
    label: 'Mark do-not-contact',
  },
}

export interface OutreachEnrollmentActions {
  /** The enrollment an action is running on, if any. */
  busy: string | null
  /** Runs one action: straight away, after its confirmation, or in the curate dialog. */
  choose(enrollment: OutreachEnrollment, action: OutreachEnrollmentRowAction): void
  /** The actions as menu items, the destructive ones marked. */
  menuItems(
    enrollment: OutreachEnrollment,
    only?: (action: OutreachEnrollmentRowAction) => boolean,
  ): RowActionsMenuItem[]
  /** The confirmation and the curate dialog, rendered once wherever the actions are offered. */
  dialogs: ReactNode
}

export function useOutreachEnrollmentActions(input: {
  api: OutreachApi
  steps: readonly OutreachSequenceStep[]
}): OutreachEnrollmentActions {
  const { api, steps } = input
  const { enqueueSnackbar } = useSnackbar()
  const [confirming, setConfirming] = useState<{
    enrollment: OutreachEnrollment
    action: OutreachEnrollmentAction
  } | null>(null)
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [curating, setCurating] = useState<OutreachEnrollment | null>(null)

  const act = async (enrollment: OutreachEnrollment, action: OutreachEnrollmentAction, why?: string) => {
    setBusy(enrollment.id)
    try {
      const answer = await api.actOnEnrollment(enrollment.id, action, why)
      const others = answer.stoppedOthers
      enqueueSnackbar(
        action === 'do_not_contact'
          ? `Marked do-not-contact${others ? `, and stopped in ${others} other ${others === 1 ? 'sequence' : 'sequences'}` : ''}.`
          : answer.changed
            ? DONE_LABELS[action]
            : 'Nothing to change.',
        { variant: 'success' },
      )
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
    } finally {
      setBusy(null)
    }
  }

  const choose = (enrollment: OutreachEnrollment, action: OutreachEnrollmentRowAction) => {
    if (action === 'curate') {
      setCurating(enrollment)
    } else if (CONFIRM[action]) {
      setDetail('')
      setConfirming({ enrollment, action })
    } else {
      void act(enrollment, action)
    }
  }

  const menuItems = (
    enrollment: OutreachEnrollment,
    only?: (action: OutreachEnrollmentRowAction) => boolean,
  ): RowActionsMenuItem[] =>
    outreachEnrollmentActionsFor(enrollment, steps)
      .filter((action) => !only || only(action))
      .map((action) => ({
        key: action,
        label: OUTREACH_ENROLLMENT_ACTION_LABELS[action],
        onClick: () => choose(enrollment, action),
        destructive: OUTREACH_DESTRUCTIVE_ENROLLMENT_ACTIONS.includes(action),
        disabled: busy === enrollment.id,
      }))

  const dialogs = (
    <>
      <OutreachCurateStepDialog enrollment={curating} steps={steps} api={api} onClose={() => setCurating(null)} />
      <Dialog open={Boolean(confirming)} onClose={() => setConfirming(null)} fullWidth maxWidth="xs">
        {confirming ? (
          <>
            <DialogTitle>{CONFIRM[confirming.action]?.title}</DialogTitle>
            <DialogContent>
              <Stack spacing={2}>
                <DialogContentText>{CONFIRM[confirming.action]?.body}</DialogContentText>
                <TextField
                  label="Why (optional)"
                  value={detail}
                  onChange={(event) => setDetail(event.target.value)}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 200 } }}
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirming(null)}>Cancel</Button>
              <Button
                color="error"
                variant="contained"
                onClick={() => {
                  const { enrollment, action } = confirming
                  setConfirming(null)
                  void act(enrollment, action, detail.trim() || undefined)
                }}
              >
                {CONFIRM[confirming.action]?.label}
              </Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </>
  )

  return { busy, choose, menuItems, dialogs }
}
