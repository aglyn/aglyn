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

import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { AI_ALLOTMENT_MAX_CREDITS, type AiAllotmentMode } from '../model/ai-allotments'

export interface AiAllotmentValue {
  credits: number | null
  mode: AiAllotmentMode
  models: string[] | null
}

export interface AiAllotmentEditorProps {
  open: boolean
  title: string
  /** One sentence under the title: whose allotment, and what it bounds. */
  description?: string
  /** The allotment as it stands, or `null` for a new one. */
  initial: AiAllotmentValue | null
  /** The models an allowlist may name, from the allotments route. */
  models: ReadonlyArray<{ id: string; label: string }>
  /** The org-wide restriction: models only, no credits and no mode. */
  modelsOnly?: boolean
  /** The workspace's pool, for the note that an allotment never grants past it. */
  poolLimit?: number | null
  busy?: boolean
  error?: string | null
  onClose: () => void
  onSave: (value: AiAllotmentValue) => void
  /** Offered when the allotment exists. */
  onRemove?: () => void
}

/**
 * THE ALLOTMENT EDITOR (AGL-2942): credits a month, hard or soft, and an
 * optional model allowlist — one dialog for a member, a collaborator, a
 * site, a bulk selection and the org-wide restriction, so the four places a
 * manager sets an allotment ask the same questions in the same words.
 */
export function AiAllotmentEditor(props: AiAllotmentEditorProps) {
  const { open, initial, models, modelsOnly, poolLimit, busy, error } = props
  const [credits, setCredits] = useState('')
  const [mode, setMode] = useState<AiAllotmentMode>('hard')
  const [allowed, setAllowed] = useState<string[]>([])
  const [invalid, setInvalid] = useState<string | null>(null)

  // Reset from the allotment each time the dialog opens, keyed on the open
  // flag and the values rather than on the object's identity.
  const initialCredits = initial?.credits ?? null
  const initialMode = initial?.mode ?? 'hard'
  const initialModels = (initial?.models ?? []).join('\n')
  useEffect(() => {
    if (!open) return
    setCredits(initialCredits === null ? '' : String(initialCredits))
    setMode(initialMode)
    setAllowed(initialModels ? initialModels.split('\n') : [])
    setInvalid(null)
  }, [open, initialCredits, initialMode, initialModels])

  const parsedCredits = credits.trim() === '' ? null : Number(credits)
  const save = () => {
    if (!modelsOnly) {
      if (
        parsedCredits !== null &&
        (!Number.isInteger(parsedCredits) || parsedCredits < 1 || parsedCredits > AI_ALLOTMENT_MAX_CREDITS)
      ) {
        setInvalid('Enter a whole number of credits, 1 or more.')
        return
      }
      if (parsedCredits === null && !allowed.length) {
        setInvalid('Set credits, choose models, or remove the allotment.')
        return
      }
    }
    setInvalid(null)
    props.onSave({
      credits: modelsOnly ? null : parsedCredits,
      mode,
      models: allowed.length ? allowed : null,
    })
  }
  const toggle = (id: string) =>
    setAllowed((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    )

  return (
    <Dialog open={open} onClose={busy ? undefined : props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{props.title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {props.description ? (
          <Typography variant="body2" color="text.secondary">
            {props.description}
          </Typography>
        ) : null}
        {modelsOnly ? null : (
          <>
            <TextField
              label="Credits a month"
              type="number"
              size="small"
              value={credits}
              onChange={(event) => setCredits(event.target.value)}
              disabled={busy}
              slotProps={{ htmlInput: { min: 1, step: 100 } }}
              helperText={
                poolLimit && parsedCredits && parsedCredits > poolLimit
                  ? `Larger than the workspace's ${poolLimit.toLocaleString()} credits — the workspace's pool still stops first.`
                  : 'Counted from the first of the month (UTC). Leave empty to limit models only.'
              }
            />
            <div>
              <FormLabel id="ai-allotment-mode">{'At the allotment'}</FormLabel>
              <RadioGroup
                aria-labelledby="ai-allotment-mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as AiAllotmentMode)}
              >
                <FormControlLabel
                  value="hard"
                  control={<Radio size="small" />}
                  disabled={busy}
                  label="Stop AI requests (hard)"
                />
                <FormControlLabel
                  value="soft"
                  control={<Radio size="small" />}
                  disabled={busy}
                  label="Keep going and alert at 80% and 100% (soft)"
                />
              </RadioGroup>
            </div>
          </>
        )}
        {models.length ? (
          <div>
            <FormLabel component="legend">
              {modelsOnly ? 'Models the organization may use' : 'Limit to these models (optional)'}
            </FormLabel>
            <FormGroup>
              {models.map((model) => (
                <FormControlLabel
                  key={model.id}
                  control={
                    <Checkbox
                      size="small"
                      checked={allowed.includes(model.id)}
                      onChange={() => toggle(model.id)}
                      disabled={busy}
                    />
                  }
                  label={model.label}
                />
              ))}
            </FormGroup>
            <FormHelperText>
              {modelsOnly
                ? 'None checked means no restriction. Auto keeps choosing among the checked models.'
                : 'None checked means every model the plan offers. Auto keeps choosing among the checked models.'}
            </FormHelperText>
          </div>
        ) : null}
        {invalid || error ? <Alert severity="error">{invalid ?? error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        {props.onRemove ? (
          <Button color="error" disabled={busy} onClick={props.onRemove} sx={{ mr: 'auto' }}>
            {modelsOnly ? 'Clear restriction' : 'Remove allotment'}
          </Button>
        ) : null}
        <Button disabled={busy} onClick={props.onClose}>
          {'Cancel'}
        </Button>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            variant="contained"
            disabled={busy}
            onClick={save}
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  )
}
AiAllotmentEditor.displayName = 'AiAllotmentEditor'

export default AiAllotmentEditor
