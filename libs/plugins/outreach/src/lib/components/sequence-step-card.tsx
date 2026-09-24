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
  mdiArrowDown,
  mdiArrowUp,
  mdiCodeBraces,
  mdiEmailFastOutline,
  mdiTrashCanOutline,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Autocomplete,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  IconButton,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useRef, useState } from 'react'
import { OUTREACH_MERGE_FIELDS } from '../engine/sequence-validation'
import {
  OUTREACH_MAX_STEP_DELAY_BUSINESS_DAYS,
  OUTREACH_TASK_KIND_LABELS,
  OUTREACH_TASK_KINDS,
  type OutreachEmailStep,
  type OutreachSequenceStep,
  type OutreachTaskKind,
  type OutreachTaskStep,
} from '../model/outreach.types'
import type { OutreachTemplateOption } from './use-outreach-crm'

export interface OutreachStepCardProps {
  step: OutreachSequenceStep
  /** Its position, from 0. */
  index: number
  /** How many steps the sequence has, for the move controls. */
  count: number
  /** Whether it is the sequence's first email, which always starts the thread. */
  firstEmail: boolean
  /** Whether it is sent as a reply in the thread an earlier email started. */
  inThread: boolean
  /** The subject the thread was started with, for an in-thread email's note. */
  threadSubject: string
  templates: readonly OutreachTemplateOption[]
  /** The issue to show beside each field, by the field's own name. */
  issues: Partial<Record<string, string>>
  disabled?: boolean
  onChange(step: OutreachSequenceStep): void
  onMove(direction: -1 | 1): void
  onRemove(): void
  /**
   * Opens the test-send dialog for this email step (AGL-3325). Absent for a
   * step that cannot be tested — a task, or an archived sequence.
   */
  onSendTest?(): void
  /** Why the test cannot be sent yet, shown on the disabled button; `null` when it can. */
  sendTestDisabledReason?: string | null
}

/** The merge fields, grouped the way the picker heads them. */
const FIELD_GROUPS = [
  ...new Set(OUTREACH_MERGE_FIELDS.map((field) => field.group)),
]

/**
 * One step of the sequence editor (AGL-2980): an email — subject, body or a
 * CRM template, merge fields, the wait before it — or a task for the rep.
 */
export function OutreachStepCard(props: OutreachStepCardProps) {
  const { step, index, count, disabled } = props
  const title =
    step.kind === 'email'
      ? `Step ${index + 1} · Email`
      : `Step ${index + 1} · ${OUTREACH_TASK_KIND_LABELS[(step as OutreachTaskStep).taskKind] ?? 'Task'}`
  return (
    <Card variant="outlined" component="section" aria-label={title}>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
              {title}
            </Typography>
            <Tooltip title="Move up">
              <span>
                <IconButton
                  size="small"
                  aria-label={`Move step ${index + 1} up`}
                  disabled={disabled || index === 0}
                  onClick={() => props.onMove(-1)}
                >
                  <MdiIcon path={mdiArrowUp.path} fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Move down">
              <span>
                <IconButton
                  size="small"
                  aria-label={`Move step ${index + 1} down`}
                  disabled={disabled || index === count - 1}
                  onClick={() => props.onMove(1)}
                >
                  <MdiIcon path={mdiArrowDown.path} fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Remove">
              <span>
                <IconButton
                  size="small"
                  aria-label={`Remove step ${index + 1}`}
                  disabled={disabled || count === 1}
                  onClick={props.onRemove}
                >
                  <MdiIcon path={mdiTrashCanOutline.path} fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
          <DelayField {...props} />
          {step.kind === 'email' ? (
            <EmailStepFields {...props} step={step} />
          ) : step.kind === 'task' ? (
            <TaskStepFields {...props} step={step} />
          ) : (
            <Typography variant="body2" color="error">
              {props.issues['step'] ?? 'A step is an email or a task.'}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}
OutreachStepCard.displayName = 'OutreachStepCard'

function DelayField(props: OutreachStepCardProps) {
  const { step, index, disabled } = props
  const first = index === 0
  const issue = props.issues['delayBusinessDays']
  return (
    <TextField
      type="number"
      label={
        first
          ? 'Wait after enrolling (business days)'
          : 'Wait after the step before (business days)'
      }
      value={
        Number.isFinite(step.delayBusinessDays) ? step.delayBusinessDays : ''
      }
      onChange={(event) =>
        props.onChange({
          ...step,
          delayBusinessDays:
            event.target.value === '' ? Number.NaN : Number(event.target.value),
        })
      }
      disabled={disabled}
      error={Boolean(issue)}
      helperText={
        issue ??
        (first
          ? '0 sends at the next opening of the sending hours.'
          : 'Counted in the mailbox’s timezone, skipping weekends.')
      }
      slotProps={{
        htmlInput: {
          min: 0,
          max: OUTREACH_MAX_STEP_DELAY_BUSINESS_DAYS,
          step: 1,
        },
      }}
      sx={{ maxWidth: { sm: 360 } }}
    />
  )
}

function EmailStepFields(
  props: OutreachStepCardProps & { step: OutreachEmailStep },
) {
  const { step, disabled, issues } = props
  const subjectRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const lastFocused = useRef<'subject' | 'body'>('body')
  const [fieldsAnchor, setFieldsAnchor] = useState<HTMLElement | null>(null)
  const template =
    props.templates.find((option) => option.id === step.templateId) ?? null
  const showSubject = !props.inThread

  /** Puts `{{key}}` where the caret was in the field last focused. */
  const insertField = (key: string) => {
    setFieldsAnchor(null)
    const token = `{{${key}}}`
    const target =
      lastFocused.current === 'subject' && showSubject
        ? 'subject'
        : template
          ? null
          : 'body'
    if (!target) return
    const element = target === 'subject' ? subjectRef.current : bodyRef.current
    const value = step[target]
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? value.length
    props.onChange({
      ...step,
      [target]: `${value.slice(0, start)}${token}${value.slice(end)}`,
    })
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <Stack spacing={2}>
      {props.firstEmail ? null : (
        <FormControlLabel
          control={
            <Switch
              checked={step.replyInThread !== false}
              onChange={(event) =>
                props.onChange({ ...step, replyInThread: event.target.checked })
              }
              disabled={disabled}
            />
          }
          label="Reply in the same thread"
        />
      )}
      {showSubject ? (
        <TextField
          label="Subject"
          value={step.subject}
          inputRef={subjectRef}
          onFocus={() => (lastFocused.current = 'subject')}
          onChange={(event) =>
            props.onChange({ ...step, subject: event.target.value })
          }
          disabled={disabled}
          error={Boolean(issues['subject'])}
          helperText={issues['subject']}
          fullWidth
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          {props.threadSubject
            ? `Sent as a reply: “Re: ${props.threadSubject}”.`
            : 'Sent as a reply in the thread the earlier email started.'}
        </Typography>
      )}
      <Autocomplete<OutreachTemplateOption>
        options={[...props.templates]}
        value={template}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        onChange={(_event, next) =>
          props.onChange({
            ...step,
            templateId: next?.id ?? null,
            body: next ? '' : step.body,
          })
        }
        disabled={disabled}
        renderInput={(params) => (
          <TextField
            {...params}
            label="CRM email template"
            helperText={
              template
                ? 'The template’s body is sent; this step’s own subject is the one used.'
                : 'Optional. Pick one to send its body instead of writing it here.'
            }
          />
        )}
      />
      {template ? (
        <TextField
          label="Body (from the template)"
          value={template.body}
          multiline
          minRows={4}
          fullWidth
          disabled
        />
      ) : (
        <TextField
          label="Body"
          value={step.body}
          inputRef={bodyRef}
          onFocus={() => (lastFocused.current = 'body')}
          onChange={(event) =>
            props.onChange({ ...step, body: event.target.value })
          }
          disabled={disabled}
          error={Boolean(issues['body'])}
          helperText={issues['body']}
          multiline
          minRows={6}
          fullWidth
        />
      )}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<MdiIcon path={mdiCodeBraces.path} fontSize="small" />}
          onClick={(event) => setFieldsAnchor(event.currentTarget)}
          disabled={disabled || (Boolean(template) && !showSubject)}
          aria-haspopup="menu"
        >
          Insert field
        </Button>
        {props.onSendTest ? (
          <Tooltip title={props.sendTestDisabledReason ?? ''}>
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<MdiIcon path={mdiEmailFastOutline.path} fontSize="small" />}
                onClick={props.onSendTest}
                disabled={Boolean(props.sendTestDisabledReason)}
                aria-label={`Send a test of step ${props.index + 1}`}
              >
                Send a test
              </Button>
            </span>
          </Tooltip>
        ) : null}
      </Stack>
      <Menu
        anchorEl={fieldsAnchor}
        open={Boolean(fieldsAnchor)}
        onClose={() => setFieldsAnchor(null)}
      >
        {FIELD_GROUPS.flatMap((group) => [
          <ListSubheader key={`group-${group}`}>{group}</ListSubheader>,
          ...OUTREACH_MERGE_FIELDS.filter((field) => field.group === group).map(
            (field) => (
              <MenuItem key={field.key} onClick={() => insertField(field.key)}>
                {field.label}
              </MenuItem>
            ),
          ),
        ])}
      </Menu>
    </Stack>
  )
}

function TaskStepFields(
  props: OutreachStepCardProps & { step: OutreachTaskStep },
) {
  const { step, disabled, issues } = props
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField
        select
        label="Task"
        value={OUTREACH_TASK_KINDS.includes(step.taskKind) ? step.taskKind : ''}
        onChange={(event) =>
          props.onChange({
            ...step,
            taskKind: event.target.value as OutreachTaskKind,
          })
        }
        disabled={disabled}
        error={Boolean(issues['taskKind'])}
        helperText={issues['taskKind']}
        sx={{ minWidth: { sm: 180 } }}
      >
        {OUTREACH_TASK_KINDS.map((kind) => (
          <MenuItem key={kind} value={kind}>
            {OUTREACH_TASK_KIND_LABELS[kind]}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Title"
        value={step.title}
        onChange={(event) =>
          props.onChange({ ...step, title: event.target.value })
        }
        disabled={disabled}
        error={Boolean(issues['title'])}
        helperText={
          issues['title'] ??
          'What the task says, for example “Connect on LinkedIn”.'
        }
        fullWidth
      />
    </Stack>
  )
}

export default OutreachStepCard
