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
  SITE_JOURNEY_STEP_TYPES,
  type SiteJourneyStepType,
} from '@aglyn/aglyn/app-utils/site-journey'
import { mdiArrowDown, mdiArrowUp, mdiDeleteOutline, mdiPlus } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { FUNNEL_STEP_TYPE_LABELS, normalizeFunnelDefinition } from '../model/funnel-definition'
import { inventoryListFor, stepInventoryProblem, type FunnelInventory } from '../model/funnel-inventory'
import {
  FUNNEL_LABEL_MAX,
  FUNNEL_MAX_STEPS,
  FUNNEL_MIN_STEPS,
  FUNNEL_NAME_MAX,
  type FunnelDefinition,
  type FunnelStep,
} from '../model/funnels.types'

/**
 * A funnel's editor (AGL-3605): a name and 2–8 steps, each picked from what
 * the site really has. The same checks the save door makes run here first,
 * so a step the site does not have is named before anything is sent.
 */

export interface FunnelEditorDialogProps {
  open: boolean
  /** The funnel being edited, a draft to review, or `null` for a new one. */
  initial: FunnelDefinition | null
  /** Steps a proposal dropped, listed above the draft. */
  dropped?: readonly string[]
  inventory: FunnelInventory | null
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (funnel: FunnelDefinition) => void
}

const ANY = ''

function blankStep(type: SiteJourneyStepType = 'page', inventory?: FunnelInventory | null): FunnelStep {
  if (type === 'page') return { type, key: inventory?.pages[0] ?? '/', match: 'exact' }
  return { type, key: ANY }
}

function StepKeyField(props: {
  step: FunnelStep
  inventory: FunnelInventory | null
  index: number
  onChange: (step: FunnelStep) => void
}) {
  const { step, inventory, index, onChange } = props
  if (step.type === 'order') return null
  if (step.type === 'event') {
    return (
      <TextField
        size="small"
        label="Event name"
        value={step.key}
        slotProps={{ htmlInput: { 'aria-label': `Step ${index + 1} event name` } }}
        helperText="As the interaction's Send an analytics event step names it"
        onChange={(event) => onChange({ ...step, key: event.target.value })}
      />
    )
  }
  if (step.type === 'page') {
    const pages = inventory?.pages ?? []
    return (
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          select
          size="small"
          label="Page"
          value={pages.includes(step.key) ? step.key : ''}
          sx={{ minWidth: 220 }}
          slotProps={{ htmlInput: { 'aria-label': `Step ${index + 1} page` } }}
          onChange={(event) => onChange({ ...step, key: event.target.value })}
        >
          {pages.map((path) => (
            <MenuItem key={path} value={path}>
              {path}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Match"
          value={step.match ?? 'exact'}
          slotProps={{ htmlInput: { 'aria-label': `Step ${index + 1} match` } }}
          onChange={(event) =>
            onChange({ ...step, match: event.target.value === 'prefix' ? 'prefix' : 'exact' })
          }
        >
          <MenuItem value="exact">{'This page only'}</MenuItem>
          <MenuItem value="prefix">{'This page and everything under it'}</MenuItem>
        </TextField>
      </Stack>
    )
  }
  const list = (inventory && inventoryListFor(inventory, step.type)) ?? []
  return (
    <TextField
      select
      size="small"
      label="Which"
      value={step.key}
      sx={{ minWidth: 220 }}
      slotProps={{ htmlInput: { 'aria-label': `Step ${index + 1} pick` } }}
      onChange={(event) => onChange({ ...step, key: event.target.value })}
    >
      <MenuItem value={ANY}>{'Any'}</MenuItem>
      {list.map((item) => (
        <MenuItem key={item.id} value={item.id}>
          {item.name}
        </MenuItem>
      ))}
    </TextField>
  )
}

export function FunnelEditorDialog(props: FunnelEditorDialogProps) {
  const { open, initial, inventory, saving, error, onClose, onSave } = props
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<FunnelStep[]>([])
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setSteps(
      initial?.steps.length
        ? initial.steps.map((step) => ({ ...step }))
        : [blankStep('page', inventory), blankStep('form')],
    )
    setProblem(null)
    // Reset only when the dialog opens or is handed another funnel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const update = (index: number, step: FunnelStep) =>
    setSteps((all) => all.map((one, at) => (at === index ? step : one)))
  const move = (index: number, by: number) =>
    setSteps((all) => {
      const next = [...all]
      const [taken] = next.splice(index, 1)
      next.splice(index + by, 0, taken)
      return next
    })

  const submit = () => {
    const normalized = normalizeFunnelDefinition({ name, steps })
    if ('error' in normalized) return setProblem(normalized.error)
    if (inventory) {
      for (const [index, step] of normalized.funnel.steps.entries()) {
        const found = stepInventoryProblem(step, inventory)
        if (found) return setProblem(`Step ${index + 1}: ${found}`)
      }
    }
    setProblem(null)
    onSave(normalized.funnel)
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>{initial?.name ? 'Edit funnel' : 'New funnel'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {props.dropped?.length ? (
            <Alert severity="info">
              {`Left out of the suggestion: ${props.dropped.join(' ')}`}
            </Alert>
          ) : null}
          <TextField
            label="Name"
            size="small"
            value={name}
            slotProps={{ htmlInput: { maxLength: FUNNEL_NAME_MAX } }}
            onChange={(event) => setName(event.target.value)}
          />
          {steps.map((step, index) => (
            <Paper key={index} variant="outlined" sx={{ p: 1.5 }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                    {`Step ${index + 1}`}
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label={`Move step ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <MdiIcon path={mdiArrowUp.path} />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label={`Move step ${index + 1} down`}
                    disabled={index === steps.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <MdiIcon path={mdiArrowDown.path} />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label={`Remove step ${index + 1}`}
                    disabled={steps.length <= FUNNEL_MIN_STEPS}
                    onClick={() => setSteps((all) => all.filter((_, at) => at !== index))}
                  >
                    <MdiIcon path={mdiDeleteOutline.path} />
                  </IconButton>
                </Stack>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                  <TextField
                    select
                    size="small"
                    label="Step"
                    value={step.type}
                    sx={{ minWidth: 220 }}
                    slotProps={{ htmlInput: { 'aria-label': `Step ${index + 1} type` } }}
                    onChange={(event) =>
                      update(index, blankStep(event.target.value as SiteJourneyStepType, inventory))
                    }
                  >
                    {SITE_JOURNEY_STEP_TYPES.map((type) => (
                      <MenuItem key={type} value={type}>
                        {FUNNEL_STEP_TYPE_LABELS[type]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <StepKeyField
                    step={step}
                    inventory={inventory}
                    index={index}
                    onChange={(next) => update(index, { ...next, label: undefined })}
                  />
                </Stack>
                <TextField
                  size="small"
                  label="Label (optional)"
                  value={step.label ?? ''}
                  slotProps={{ htmlInput: { maxLength: FUNNEL_LABEL_MAX } }}
                  onChange={(event) => update(index, { ...step, label: event.target.value })}
                />
              </Stack>
            </Paper>
          ))}
          <Button
            size="small"
            startIcon={<MdiIcon path={mdiPlus.path} />}
            disabled={steps.length >= FUNNEL_MAX_STEPS}
            onClick={() => setSteps((all) => [...all, blankStep('page', inventory)])}
            sx={{ alignSelf: 'flex-start' }}
          >
            {'Add a step'}
          </Button>
          {problem || error ? <Alert severity="error">{problem ?? error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {'Cancel'}
        </Button>
        <Button variant="contained" onClick={submit} disabled={saving || !inventory}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default FunnelEditorDialog
