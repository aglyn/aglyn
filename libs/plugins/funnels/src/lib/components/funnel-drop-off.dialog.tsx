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

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { DROP_OFF_WAIT_HOURS, waitLabel, type DropOffAction } from '../model/drop-off'

/**
 * "Act on this drop-off" (AGL-3605): pick a wait and what to do, and an
 * automation is drafted switched off on the site's Automation page, starting
 * on "Left a funnel" for this step. Nothing runs from here.
 */

export interface FunnelDropOffDialogProps {
  open: boolean
  /** The step people reached, 1-based, and the one they did not reach after it. */
  step: number
  stepLabel: string
  nextStepLabel: string
  onClose: () => void
  /**
   * Drafts it; resolves to the draft's name and where it is edited and
   * switched on (`null` when no page is known), or throws the door's sentence.
   */
  onDraft: (afterHours: number, action: DropOffAction) => Promise<{ name: string; href: string | null }>
}

export const DROP_OFF_COPY = {
  title: 'Act on this drop-off',
  explain:
    'Drafts an automation that starts when a person who submitted a form on this site reached this step and had not reached the next one after the wait. Anonymous visitors are never followed up.',
  off: 'It is saved switched off. Review the words on the Automation page, then switch it on.',
  email: 'Send them a follow-up email',
  task: 'Create a CRM task for the team',
  emailNote:
    'The email goes with its unsubscribe link, and never to anyone who unsubscribed or whose address is suppressed.',
  submit: 'Draft the automation',
} as const

export function FunnelDropOffDialog(props: FunnelDropOffDialogProps) {
  const { open, step, stepLabel, nextStepLabel, onClose, onDraft } = props
  const [afterHours, setAfterHours] = useState<number>(24)
  const [action, setAction] = useState<DropOffAction>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drafted, setDrafted] = useState<{ name: string; href: string | null } | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setDrafted(null)
  }, [open, step])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      setDrafted(await onDraft(afterHours, action))
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{DROP_OFF_COPY.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2">
            {`People who reached step ${step}, “${stepLabel}”, and not “${nextStepLabel}”.`}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {DROP_OFF_COPY.explain}
          </Typography>
          <TextField
            select
            size="small"
            label="After"
            value={afterHours}
            disabled={busy || drafted !== null}
            onChange={(event) => setAfterHours(Number(event.target.value))}
          >
            {DROP_OFF_WAIT_HOURS.map((hours) => (
              <MenuItem key={hours} value={hours}>
                {waitLabel(hours)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Then"
            value={action}
            disabled={busy || drafted !== null}
            helperText={action === 'email' ? DROP_OFF_COPY.emailNote : undefined}
            onChange={(event) => setAction(event.target.value as DropOffAction)}
          >
            <MenuItem value="email">{DROP_OFF_COPY.email}</MenuItem>
            <MenuItem value="task">{DROP_OFF_COPY.task}</MenuItem>
          </TextField>
          <Typography variant="body2" color="text.secondary">
            {DROP_OFF_COPY.off}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {drafted ? (
            <Alert severity="success">
              {`Drafted “${drafted.name}”, switched off. `}
              {drafted.href ? <Link href={drafted.href}>{'Open it on the Automation page'}</Link> : null}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {drafted ? 'Done' : 'Cancel'}
        </Button>
        {drafted ? null : (
          <Button variant="contained" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Drafting…' : DROP_OFF_COPY.submit}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

export default FunnelDropOffDialog
