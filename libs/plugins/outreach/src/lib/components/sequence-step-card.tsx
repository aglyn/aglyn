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
import { memo, useCallback, useRef, useState } from 'react'
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

/** A text field that redraws only when what it shows changes (AGL-3423). */
const MemoTextField = memo(TextField) as typeof TextField

type FieldChange = { target: { value: string } }
type SwitchChange = { target: { checked: boolean } }

const HEADER_ROW = { alignItems: 'center' } as const
const TITLE = { flexGrow: 1 } as const
const DELAY_FIELD = { maxWidth: { sm: 360 } } as const
const DELAY_SLOT_PROPS = {
  htmlInput: {
    min: 0,
    max: OUTREACH_MAX_STEP_DELAY_BUSINESS_DAYS,
    step: 1,
  },
}
const ACTIONS_ROW = { flexWrap: 'wrap', rowGap: 1 } as const
const TASK_ROW = { xs: 'column', sm: 'row' } as const
const TASK_KIND_FIELD = { minWidth: { sm: 180 } } as const

const templateName = (option: OutreachTemplateOption): string => option.name
const sameTemplate = (
  option: OutreachTemplateOption,
  value: OutreachTemplateOption,
): boolean => option.id === value.id

/** Every task kind, as the Task select lists them, built once. */
const TASK_KIND_MENU = OUTREACH_TASK_KINDS.map((kind) => (
  <MenuItem key={kind} value={kind}>
    {OUTREACH_TASK_KIND_LABELS[kind]}
  </MenuItem>
))

/**
 * One step of the sequence editor (AGL-2980): an email — subject, body or a
 * CRM template, merge fields, the wait before it — or a task for the rep.
 *
 * ## Each field redraws on its own (AGL-3423)
 *
 * The editor keeps the whole sequence in one draft, so a letter typed into a
 * step hands its card a new step. The card's fields are memoized, with
 * handlers that keep their identity and write the step as last drawn, so the
 * letter redraws the field it lands in rather than the wait, the subject, the
 * template picker and the body together. A keystroke that costs one field
 * leaves typed input nothing to queue behind, which is what kept the
 * countries chips from being redrawn by fifty keystrokes in a row (#185).
 */
export function OutreachStepCard(props: OutreachStepCardProps) {
  const { step, index, count, disabled } = props
  // The card as last drawn, which every handler below writes from.
  const latest = useRef(props)
  latest.current = props
  const moveUp = useCallback(() => latest.current.onMove(-1), [])
  const moveDown = useCallback(() => latest.current.onMove(1), [])
  const remove = useCallback(() => latest.current.onRemove(), [])
  const setDelay = useCallback(
    (event: FieldChange) =>
      latest.current.onChange({
        ...latest.current.step,
        delayBusinessDays:
          event.target.value === '' ? Number.NaN : Number(event.target.value),
      }),
    [],
  )
  const title =
    step.kind === 'email'
      ? `Step ${index + 1} · Email`
      : `Step ${index + 1} · ${OUTREACH_TASK_KIND_LABELS[(step as OutreachTaskStep).taskKind] ?? 'Task'}`
  return (
    <Card variant="outlined" component="section" aria-label={title}>
      <CardContent>
        <Stack spacing={2}>
          <StepHeader
            title={title}
            index={index}
            count={count}
            disabled={disabled}
            onMoveUp={moveUp}
            onMoveDown={moveDown}
            onRemove={remove}
          />
          <DelayField
            first={index === 0}
            value={step.delayBusinessDays}
            issue={props.issues['delayBusinessDays']}
            disabled={disabled}
            onChange={setDelay}
          />
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

/** The step's title and the controls that move or remove it. */
const StepHeader = memo(function StepHeader(props: {
  title: string
  index: number
  count: number
  disabled?: boolean
  onMoveUp(): void
  onMoveDown(): void
  onRemove(): void
}) {
  const { index, count, disabled } = props
  return (
    <Stack direction="row" spacing={1} sx={HEADER_ROW}>
      <Typography variant="subtitle1" sx={TITLE}>
        {props.title}
      </Typography>
      <Tooltip title="Move up">
        <span>
          <IconButton
            size="small"
            aria-label={`Move step ${index + 1} up`}
            disabled={disabled || index === 0}
            onClick={props.onMoveUp}
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
            onClick={props.onMoveDown}
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
  )
})

const DelayField = memo(function DelayField(props: {
  /** Whether it is the first step, whose wait starts at enrollment. */
  first: boolean
  value: number
  issue?: string
  disabled?: boolean
  onChange(event: FieldChange): void
}) {
  const { first, value, issue } = props
  return (
    <TextField
      type="number"
      label={
        first
          ? 'Wait after enrolling (business days)'
          : 'Wait after the step before (business days)'
      }
      value={Number.isFinite(value) ? value : ''}
      onChange={props.onChange}
      disabled={props.disabled}
      error={Boolean(issue)}
      helperText={
        issue ??
        (first
          ? '0 sends at the next opening of the sending hours.'
          : 'Counted in the mailbox’s timezone, skipping weekends.')
      }
      slotProps={DELAY_SLOT_PROPS}
      sx={DELAY_FIELD}
    />
  )
})

function EmailStepFields(
  props: OutreachStepCardProps & { step: OutreachEmailStep },
) {
  const { step, disabled, issues } = props
  // The step as last drawn, which every handler below writes from.
  const latest = useRef(props)
  latest.current = props
  const subjectRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const lastFocused = useRef<'subject' | 'body'>('body')
  const [fieldsAnchor, setFieldsAnchor] = useState<HTMLElement | null>(null)
  const template =
    props.templates.find((option) => option.id === step.templateId) ?? null
  const showSubject = !props.inThread

  const write = useCallback(
    (patch: Partial<OutreachEmailStep>) =>
      latest.current.onChange({ ...latest.current.step, ...patch }),
    [],
  )
  const setReply = useCallback(
    (event: SwitchChange) => write({ replyInThread: event.target.checked }),
    [write],
  )
  const setSubject = useCallback(
    (event: FieldChange) => write({ subject: event.target.value }),
    [write],
  )
  const setBody = useCallback(
    (event: FieldChange) => write({ body: event.target.value }),
    [write],
  )
  const pickTemplate = useCallback(
    (next: OutreachTemplateOption | null) =>
      write({
        templateId: next?.id ?? null,
        body: next ? '' : latest.current.step.body,
      }),
    [write],
  )
  const focusSubject = useCallback(() => {
    lastFocused.current = 'subject'
  }, [])
  const focusBody = useCallback(() => {
    lastFocused.current = 'body'
  }, [])
  const openFields = useCallback(
    (event: { currentTarget: HTMLElement }) =>
      setFieldsAnchor(event.currentTarget),
    [],
  )
  const closeFields = useCallback(() => setFieldsAnchor(null), [])
  const sendTest = useCallback(() => latest.current.onSendTest?.(), [])

  /** Puts `{{key}}` where the caret was in the field last focused. */
  const insertField = useCallback((key: string) => {
    setFieldsAnchor(null)
    const current = latest.current
    const token = `{{${key}}}`
    const target =
      lastFocused.current === 'subject' && !current.inThread
        ? 'subject'
        : current.templates.some(
              (option) => option.id === current.step.templateId,
            )
          ? null
          : 'body'
    if (!target) return
    const element = target === 'subject' ? subjectRef.current : bodyRef.current
    const value = current.step[target]
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? value.length
    current.onChange({
      ...current.step,
      [target]: `${value.slice(0, start)}${token}${value.slice(end)}`,
    })
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + token.length, start + token.length)
    })
  }, [])

  return (
    <Stack spacing={2}>
      {props.firstEmail ? null : (
        <ReplyInThreadField
          checked={step.replyInThread !== false}
          disabled={disabled}
          onChange={setReply}
        />
      )}
      {showSubject ? (
        <MemoTextField
          label="Subject"
          value={step.subject}
          inputRef={subjectRef}
          onFocus={focusSubject}
          onChange={setSubject}
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
      <TemplateField
        templates={props.templates}
        template={template}
        disabled={disabled}
        onChange={pickTemplate}
      />
      {template ? (
        <MemoTextField
          label="Body (from the template)"
          value={template.body}
          multiline
          minRows={4}
          fullWidth
          disabled
        />
      ) : (
        <MemoTextField
          label="Body"
          value={step.body}
          inputRef={bodyRef}
          onFocus={focusBody}
          onChange={setBody}
          disabled={disabled}
          error={Boolean(issues['body'])}
          helperText={issues['body']}
          multiline
          minRows={6}
          fullWidth
        />
      )}
      <EmailStepActions
        stepNumber={props.index + 1}
        insertDisabled={Boolean(disabled || (template && !showSubject))}
        canSendTest={Boolean(props.onSendTest)}
        sendTestDisabledReason={props.sendTestDisabledReason}
        onInsertField={openFields}
        onSendTest={sendTest}
      />
      <MergeFieldMenu
        anchorEl={fieldsAnchor}
        onClose={closeFields}
        onPick={insertField}
      />
    </Stack>
  )
}

const ReplyInThreadField = memo(function ReplyInThreadField(props: {
  checked: boolean
  disabled?: boolean
  onChange(event: SwitchChange): void
}) {
  return (
    <FormControlLabel
      control={
        <Switch
          checked={props.checked}
          onChange={props.onChange}
          disabled={props.disabled}
        />
      }
      label="Reply in the same thread"
    />
  )
})

const TemplateField = memo(function TemplateField(props: {
  templates: readonly OutreachTemplateOption[]
  template: OutreachTemplateOption | null
  disabled?: boolean
  onChange(next: OutreachTemplateOption | null): void
}) {
  const { template, onChange } = props
  return (
    <Autocomplete<OutreachTemplateOption>
      options={[...props.templates]}
      value={template}
      getOptionLabel={templateName}
      isOptionEqualToValue={sameTemplate}
      onChange={(_event, next) => onChange(next)}
      disabled={props.disabled}
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
  )
})

const EmailStepActions = memo(function EmailStepActions(props: {
  stepNumber: number
  insertDisabled: boolean
  canSendTest: boolean
  sendTestDisabledReason?: string | null
  onInsertField(event: { currentTarget: HTMLElement }): void
  onSendTest(): void
}) {
  return (
    <Stack direction="row" spacing={1} sx={ACTIONS_ROW}>
      <Button
        size="small"
        variant="outlined"
        startIcon={<MdiIcon path={mdiCodeBraces.path} fontSize="small" />}
        onClick={props.onInsertField}
        disabled={props.insertDisabled}
        aria-haspopup="menu"
      >
        Insert field
      </Button>
      {props.canSendTest ? (
        <Tooltip title={props.sendTestDisabledReason ?? ''}>
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={<MdiIcon path={mdiEmailFastOutline.path} fontSize="small" />}
              onClick={props.onSendTest}
              disabled={Boolean(props.sendTestDisabledReason)}
              aria-label={`Send a test of step ${props.stepNumber}`}
            >
              Send a test
            </Button>
          </span>
        </Tooltip>
      ) : null}
    </Stack>
  )
})

const MergeFieldMenu = memo(function MergeFieldMenu(props: {
  anchorEl: HTMLElement | null
  onClose(): void
  onPick(key: string): void
}) {
  const { onPick } = props
  return (
    <Menu
      anchorEl={props.anchorEl}
      open={Boolean(props.anchorEl)}
      onClose={props.onClose}
    >
      {FIELD_GROUPS.flatMap((group) => [
        <ListSubheader key={`group-${group}`}>{group}</ListSubheader>,
        ...OUTREACH_MERGE_FIELDS.filter((field) => field.group === group).map(
          (field) => (
            <MenuItem key={field.key} onClick={() => onPick(field.key)}>
              {field.label}
            </MenuItem>
          ),
        ),
      ])}
    </Menu>
  )
})

function TaskStepFields(
  props: OutreachStepCardProps & { step: OutreachTaskStep },
) {
  const { step, disabled, issues } = props
  // The step as last drawn, which both handlers write from.
  const latest = useRef(props)
  latest.current = props
  const setKind = useCallback(
    (event: FieldChange) =>
      latest.current.onChange({
        ...latest.current.step,
        taskKind: event.target.value as OutreachTaskKind,
      }),
    [],
  )
  const setTitle = useCallback(
    (event: FieldChange) =>
      latest.current.onChange({
        ...latest.current.step,
        title: event.target.value,
      }),
    [],
  )
  return (
    <Stack direction={TASK_ROW} spacing={2}>
      <TaskKindField
        value={OUTREACH_TASK_KINDS.includes(step.taskKind) ? step.taskKind : ''}
        issue={issues['taskKind']}
        disabled={disabled}
        onChange={setKind}
      />
      <MemoTextField
        label="Title"
        value={step.title}
        onChange={setTitle}
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

const TaskKindField = memo(function TaskKindField(props: {
  value: string
  issue?: string
  disabled?: boolean
  onChange(event: FieldChange): void
}) {
  return (
    <TextField
      select
      label="Task"
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
      error={Boolean(props.issue)}
      helperText={props.issue}
      sx={TASK_KIND_FIELD}
    >
      {TASK_KIND_MENU}
    </TextField>
  )
})

export default OutreachStepCard
