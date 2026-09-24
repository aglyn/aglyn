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
  Chip,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'
import {
  isInThreadEmailStep,
  validateOutreachCuratedStep,
  type OutreachValidationIssue,
} from '../engine/sequence-validation'
import type { OutreachCurateDraft, OutreachStepOverrideRequest } from '../model/outreach-api'
import {
  OUTREACH_CURATION_CONFIRMATION_LABEL,
  type OutreachSequenceStep,
  type OutreachStepOverrideSource,
} from '../model/outreach.types'

/**
 * ONE PERSON'S COPY OF ONE STEP, AS THE MEMBER READS AND DECIDES IT
 * (AGL-3324).
 *
 * The enroll dialog shows one of these under each person for every email
 * step the AI drafted; the Enrollments tab shows one for the next step. The
 * member edits the subject and the body, reads what the validator says,
 * ticks the confirmation — a fourth attestation beside the three a cold
 * contact asks for — and either USES the copy or KEEPS the template. Until
 * they decide, nothing about the draft leaves the browser: the enroll and
 * the save carry only what was used.
 *
 * Validated as they type, with the same rules the route applies again: a
 * draft that breaks one cannot be used as it stands.
 */

/** What the member holds for one drafted step. */
export interface OutreachCuratedDraftState {
  stepIndex: number
  /** Whether the email starts a thread, and so has a subject of its own. */
  startsThread: boolean
  subject: string
  body: string
  /** The words as they were drafted, so an edit can be told from a confirmation. */
  original: { subject: string; body: string }
  source: OutreachStepOverrideSource
  /** The member ticked the confirmation. */
  confirmed: boolean
  /** Used, kept as the template, or still open. */
  decision: 'pending' | 'use' | 'keep'
  /** The AI's prompt and model, for the override's audit record. */
  prompt?: string
  model?: string
}

/** A drafted step as the route answered it, ready for the member. */
export function outreachDraftState(
  draft: Pick<OutreachCurateDraft, 'stepIndex' | 'subject' | 'body'>,
  steps: readonly OutreachSequenceStep[],
  source: OutreachStepOverrideSource,
  audit?: { prompt: string; model: string },
): OutreachCuratedDraftState {
  const startsThread = !isInThreadEmailStep(steps, draft.stepIndex)
  const subject = startsThread ? (draft.subject ?? '') : ''
  return {
    stepIndex: draft.stepIndex,
    startsThread,
    subject,
    body: draft.body,
    original: { subject, body: draft.body },
    source,
    confirmed: false,
    decision: 'pending',
    ...(audit ? { prompt: audit.prompt, model: audit.model } : {}),
  }
}

/** The member's own starting point: the step's words, for them to rewrite by hand. */
export function outreachMemberDraftStates(
  steps: readonly OutreachSequenceStep[],
  stepIndexes: readonly number[],
): OutreachCuratedDraftState[] {
  return stepIndexes.flatMap((stepIndex) => {
    const step = steps[stepIndex]
    if (step?.kind !== 'email') return []
    return [
      outreachDraftState(
        // A step that sends a CRM template has no words here to start from.
        { stepIndex, subject: step.subject, body: step.templateId ? '' : step.body },
        steps,
        'member',
      ),
    ]
  })
}

/** The request a USED draft becomes; `null` for one that was kept or is still open. */
export function outreachDraftToOverride(
  draft: OutreachCuratedDraftState,
): OutreachStepOverrideRequest | null {
  if (draft.decision !== 'use') return null
  const edited =
    draft.source === 'ai' &&
    (draft.body !== draft.original.body || (draft.startsThread && draft.subject !== draft.original.subject))
  return {
    stepIndex: draft.stepIndex,
    ...(draft.startsThread ? { subject: draft.subject } : {}),
    body: draft.body,
    source: draft.source,
    ...(edited ? { edited: true } : {}),
    ...(draft.source === 'ai' && draft.prompt ? { prompt: draft.prompt } : {}),
    ...(draft.source === 'ai' && draft.model ? { model: draft.model } : {}),
  }
}

/** The validator's verdict on the draft as it stands. */
export function outreachDraftIssues(draft: OutreachCuratedDraftState): OutreachValidationIssue[] {
  return validateOutreachCuratedStep(
    { subject: draft.startsThread ? draft.subject : undefined, body: draft.body, startsThread: draft.startsThread },
    `stepOverrides.${draft.stepIndex}`,
  )
}

/** Whether the draft may be used as it stands: confirmed, and nothing the validator refuses. */
export function outreachDraftUsable(draft: OutreachCuratedDraftState): boolean {
  return draft.confirmed && !outreachDraftIssues(draft).some((issue) => issue.severity === 'error')
}

export interface OutreachCuratedStepEditorProps {
  draft: OutreachCuratedDraftState
  /** "Email 1 · step 1", as the sequence's preview names it. */
  label: string
  onChange(next: OutreachCuratedDraftState): void
  disabled?: boolean
}

export function OutreachCuratedStepEditor(props: OutreachCuratedStepEditorProps) {
  const { draft, label, onChange } = props
  const disabled = props.disabled === true
  const issues = useMemo(() => outreachDraftIssues(draft), [draft])
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  const change = (next: Partial<OutreachCuratedDraftState>) => onChange({ ...draft, ...next })
  const who = draft.source === 'ai' ? 'AI draft' : 'Your words'

  if (draft.decision !== 'pending') {
    return (
      <Paper variant="outlined" sx={{ p: 1.5 }} aria-label={`${label} — ${draft.decision === 'use' ? 'curated' : 'template kept'}`}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="body2" sx={{ flexGrow: 1 }}>
            {label}
          </Typography>
          <Chip
            size="small"
            color={draft.decision === 'use' ? 'success' : 'default'}
            label={draft.decision === 'use' ? `Curated · ${who}` : 'Template kept'}
          />
          <Button size="small" onClick={() => change({ decision: 'pending' })} disabled={disabled}>
            Change
          </Button>
        </Stack>
      </Paper>
    )
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} aria-label={`${label} — draft`}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {label}
          </Typography>
          <Chip size="small" variant="outlined" label={who} />
        </Stack>
        {draft.startsThread ? (
          <TextField
            label="Subject"
            value={draft.subject}
            onChange={(event) => change({ subject: event.target.value, confirmed: false })}
            disabled={disabled}
            size="small"
            fullWidth
            error={errors.some((issue) => issue.path.endsWith('.subject'))}
          />
        ) : (
          <Typography variant="caption" color="text.secondary">
            Sent as a reply in the thread, under the thread’s subject.
          </Typography>
        )}
        <TextField
          label="Email"
          value={draft.body}
          onChange={(event) => change({ body: event.target.value, confirmed: false })}
          disabled={disabled}
          multiline
          minRows={6}
          fullWidth
          error={errors.some((issue) => issue.path.endsWith('.body'))}
          helperText="Plain text. The footer is added when it’s sent."
        />
        {errors.length ? (
          <Alert severity="error">
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
              {errors.map((issue) => (
                <li key={`${issue.path}:${issue.code}`}>{issue.message}</li>
              ))}
            </Stack>
          </Alert>
        ) : null}
        {warnings.length ? (
          <Typography variant="caption" color="text.secondary">
            {warnings.map((issue) => issue.message).join(' ')}
          </Typography>
        ) : null}
        <FormControlLabel
          control={
            <Checkbox
              checked={draft.confirmed}
              onChange={(event) => change({ confirmed: event.target.checked })}
              disabled={disabled || errors.length > 0}
            />
          }
          label={OUTREACH_CURATION_CONFIRMATION_LABEL}
        />
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="contained"
            disabled={disabled || !outreachDraftUsable(draft)}
            onClick={() => change({ decision: 'use' })}
          >
            Use this
          </Button>
          <Button size="small" disabled={disabled} onClick={() => change({ decision: 'keep' })}>
            Keep the template
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}
OutreachCuratedStepEditor.displayName = 'OutreachCuratedStepEditor'

export default OutreachCuratedStepEditor
