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

import { pluginDocsHelp, type ConsolePluginOrgMount } from '@aglyn/aglyn'
import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import { mdiPlus } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import ContainerPicker, {
  type ContainerPickerProps,
} from '@aglyn/tenant-feature-instance/components/container-picker'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useOrgContainerOptions, useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Grid,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isInThreadEmailStep,
  OUTREACH_SEQUENCE_NAME_MAX,
  validateOutreachSequence,
} from '../engine/sequence-validation'
import { outreachCountryLabel } from '../model/compliance-settings'
import {
  OUTREACH_MAX_EMAIL_STEPS,
  OUTREACH_MAX_STEPS,
  OUTREACH_TASK_KIND_LABELS,
  OUTREACH_TASK_KINDS,
  type OutreachSequence,
  type OutreachSequenceStep,
  type OutreachTaskKind,
} from '../model/outreach.types'
import {
  emptyOutreachSequenceDraft,
  newOutreachEmailStep,
  newOutreachTaskStep,
  outreachSequenceDraftOf,
  type OutreachSequenceDraft,
  type OutreachSequenceIssue,
} from '../model/sequence-draft'
import { OutreachSendWindowFields } from './send-window-fields'
import { OutreachSequenceMailboxPicker, OutreachSequenceRotationPicker } from './sequence-mailbox-picker'
import { OutreachSequencePreview } from './sequence-preview'
import {
  OutreachStepCard,
  type OutreachStepCardProps,
} from './sequence-step-card'
import { OutreachStepTestDialog } from './step-test-dialog'
import { OutreachRouteError, useOutreachApi } from './use-outreach-api'
import { useOutreachEmailTemplates } from './use-outreach-crm'
import type { OutreachMailboxesResult } from './use-outreach-mailboxes'
import type { OutreachSettingsLoad } from './use-outreach-settings'

export interface OutreachSequenceEditorProps {
  orgId: string
  orgMount?: ConsolePluginOrgMount
  /** The organization document, for the consent group a test send's person picker searches (AGL-3325). */
  org?: Record<string, unknown> | null
  /** The stored sequence, or `null` for a new one. */
  sequence: OutreachSequence | null
  /** The organization's compliance settings: its countries, and the preview's footer. */
  settings: OutreachSettingsLoad
  /**
   * The organization's mailboxes, from the Mailboxes section's listener:
   * what the picker offers, and who the preview's emails are from.
   */
  mailboxes: OutreachMailboxesResult
  /** The Mailboxes section, where the picker sends a member to connect one. */
  mailboxesPath: string
  onSaved(sequence: OutreachSequence): void
  onCancel?(): void
}

/** The step a dotted issue path is about, and the field within it. */
function stepIssueKey(path: string): { index: number; field: string } | null {
  const match = /^steps\.(\d+)(?:\.(.+))?$/.exec(path)
  if (!match) return null
  const field = match[2] ?? 'step'
  return { index: Number(match[1]), field: field === 'id' ? 'step' : field }
}

interface OutreachCountriesFieldProps {
  options: readonly string[]
  value: readonly string[]
  onChange(next: string[]): void
  issue?: string
  disabled: boolean
}

/**
 * The countries a sequence sends to, as chips in an Autocomplete.
 *
 * MEMOIZED, AND EVERY PROP IT TAKES IS STABLE WHILE THE COUNTRIES ARE
 * (AGL-3423). A multiple Autocomplete hands its input a new chip array as
 * `startAdornment` on every render, and MUI's `InputBase` copies that into
 * its `FormControl` from a passive effect — a state update after every
 * commit this field takes part in. React 19 counts a commit that leaves such
 * an update pending as a nested update, and keystrokes the browser delivers
 * back to back (a held key, fast typing on a busy page) commit one after
 * another with nothing in between to clear the count: fifty-one of them and
 * the next keystroke's own `setState` throws "Maximum update depth exceeded"
 * (minified error #185), which is what typing a step's body reported. Kept
 * out of the editor's other renders, the field commits only when the
 * countries, their options or their issue change.
 */
const OutreachCountriesField = memo(function OutreachCountriesField(
  props: OutreachCountriesFieldProps,
) {
  return (
    <Autocomplete<string, true>
      multiple
      options={props.options}
      value={props.value as string[]}
      getOptionLabel={outreachCountryLabel}
      onChange={(_event, next) => props.onChange(next)}
      disabled={props.disabled}
      renderValue={(value, getItemProps) =>
        value.map((code, index) => {
          const { key, ...item } = getItemProps({ index })
          return (
            <Chip
              key={key}
              size="small"
              label={outreachCountryLabel(code)}
              {...item}
            />
          )
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label="Countries"
          error={Boolean(props.issue)}
          helperText={
            props.issue ??
            'Among the countries your organization allows. Cold contacts are emailed only in the United States.'
          }
        />
      )}
    />
  )
})

/** Each step's issues by the field they are about, as its card reads them. */
type StepIssues = Partial<Record<string, string>>

/**
 * Each step's issues, the SAME record for a step while what it holds reads
 * the same (AGL-3423), so a step a keystroke did not touch keeps its props.
 */
function useStepIssues(
  issues: readonly OutreachSequenceIssue[],
  count: number,
): StepIssues[] {
  const held = useRef<Array<{ key: string; value: StepIssues }>>([])
  return useMemo(() => {
    const found: Record<string, string>[] = Array.from(
      { length: count },
      () => ({}),
    )
    for (const issue of issues) {
      const key = stepIssueKey(issue.path)
      const record = key ? found[key.index] : undefined
      if (key && record && !record[key.field])
        record[key.field] = issue.message
    }
    held.current = found.map((value, index) => {
      const key = JSON.stringify(value)
      const before = held.current[index]
      return before?.key === key ? before : { key, value }
    })
    return held.current.map((entry) => entry.value)
  }, [issues, count])
}

/** A text field that redraws only when what it shows changes (AGL-3423). */
const MemoTextField = memo(TextField) as typeof TextField

/*
 * The sections below are drawn from the one draft, and each redraws only
 * when what it shows changes (AGL-3423).
 */
const MemoMailboxPicker = memo(OutreachSequenceMailboxPicker)
const MemoRotationPicker = memo(OutreachSequenceRotationPicker)
/** A stable empty rotation, so the picker's props hold still while there is none. */
const NO_ROTATION: readonly string[] = []
const MemoContainerPicker = memo(ContainerPicker)
const MemoSendWindowFields = memo(OutreachSendWindowFields)
const MemoSequencePreview = memo(OutreachSequencePreview)

type FieldChange = { target: { value: string } }
type SwitchChange = { target: { checked: boolean } }
type SequenceSettings = OutreachSequenceDraft['settings']

const NAME_SLOT_PROPS = {
  htmlInput: { maxLength: OUTREACH_SEQUENCE_NAME_MAX + 20 },
}
const ADD_STEP_ROW = { flexWrap: 'wrap', rowGap: 1 } as const
const PREVIEW_COLUMN = {
  position: { md: 'sticky' },
  top: { md: 16 },
} as const

const SequenceSiteField = memo(function SequenceSiteField(props: {
  hosts: ConsolePluginOrgMount['hosts']
  value: string
  issue?: string
  disabled: boolean
  onChange(event: FieldChange): void
}) {
  const { hosts, value, issue } = props
  return (
    <TextField
      select
      label="Site"
      value={hosts.some((host) => host.id === value) ? value : ''}
      onChange={props.onChange}
      disabled={props.disabled || !hosts.length}
      error={Boolean(issue)}
      helperText={issue ?? 'The site whose contacts this sequence emails.'}
      fullWidth
    >
      {hosts.map((host) => (
        <MenuItem key={host.id} value={host.id}>
          {host.name}
        </MenuItem>
      ))}
    </TextField>
  )
})

/** The sequence card's header actions: Cancel, and the save of the whole sequence. */
const SequenceSaveActions = memo(function SequenceSaveActions(props: {
  saving: boolean
  /** "Save" for a stored sequence, "Create sequence" for a new one. */
  saveLabel: string
  onCancel?(): void
  onSave(): void
}) {
  return (
    <Stack direction="row" spacing={1}>
      {props.onCancel ? (
        <Button
          size="small"
          variant="text"
          onClick={props.onCancel}
          disabled={props.saving}
        >
          Cancel
        </Button>
      ) : null}
      <Button
        size="small"
        variant="contained"
        onClick={props.onSave}
        disabled={props.saving}
      >
        {props.saving ? 'Saving…' : props.saveLabel}
      </Button>
    </Stack>
  )
})

interface SequenceCardProps {
  orgId: string
  uid: string | null
  name: string
  hostId: string
  mailboxId: string
  /** The mailboxes it rotates through beside its own (AGL-3489). */
  mailboxIds: readonly string[]
  campaignIds: readonly string[]
  hosts: ConsolePluginOrgMount['hosts']
  mailboxes: OutreachMailboxesResult
  mailboxesPath: string
  campaignOptions: ContainerPickerProps['options']
  /** The organization has no campaigns at all. */
  noCampaigns: boolean
  nameIssue?: string
  hostIssue?: string
  mailboxIssue?: string
  rotationIssue?: string
  campaignsIssue?: string
  archived: boolean
  saving: boolean
  saveLabel: string
  onCancel?(): void
  onSave(): void
  onName(event: FieldChange): void
  onHost(event: FieldChange): void
  onMailbox(mailboxId: string): void
  onRotation(mailboxIds: string[]): void
  onCampaigns(campaignIds: string[]): void
}

/** The sequence's own card: its name, site, mailbox and campaigns. */
const SequenceCard = memo(function SequenceCard(props: SequenceCardProps) {
  const { archived } = props
  return (
    <CardDisplay
      header="Sequence"
      help={pluginDocsHelp('sequences', { anchor: '#build-a-sequence' })}
      // The whole sequence (steps and sending rules included) saves
      // from its first card's header, where the console puts a card's
      // actions (AGL-3333).
      HeaderProps={{
        action: archived ? undefined : (
          <SequenceSaveActions
            saving={props.saving}
            saveLabel={props.saveLabel}
            onCancel={props.onCancel}
            onSave={props.onSave}
          />
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <MemoTextField
          label="Name"
          value={props.name}
          onChange={props.onName}
          disabled={archived}
          error={Boolean(props.nameIssue)}
          helperText={props.nameIssue}
          slotProps={NAME_SLOT_PROPS}
          fullWidth
        />
        <SequenceSiteField
          hosts={props.hosts}
          value={props.hostId}
          issue={props.hostIssue}
          disabled={archived}
          onChange={props.onHost}
        />
        <MemoMailboxPicker
          orgId={props.orgId}
          uid={props.uid}
          mailboxes={props.mailboxes}
          mailboxesPath={props.mailboxesPath}
          value={props.mailboxId}
          onChange={props.onMailbox}
          error={props.mailboxIssue}
          disabled={archived}
        />
        <MemoRotationPicker
          orgId={props.orgId}
          uid={props.uid}
          mailboxes={props.mailboxes}
          mailboxId={props.mailboxId}
          value={props.mailboxIds}
          onChange={props.onRotation}
          error={props.rotationIssue}
          disabled={archived}
        />
        {/*
          The campaigns this sequence is part of (AGL-3254), picked the
          way a form's page picks them. Everyone enrolled joins them,
          and what the sequence produces is reported under them; it
          does not change who is enrolled or what is sent.
         */}
        <MemoContainerPicker
          kind="campaign"
          options={props.campaignOptions}
          value={props.campaignIds}
          onChange={props.onCampaigns}
          label="Campaigns"
          helperText={
            props.campaignsIssue ??
            'The campaigns this sequence is part of. Everyone enrolled joins them, and its sends, replies, meetings and conversions count on their pages.'
          }
          disabled={archived}
          empty={props.noCampaigns}
          emptyText="There are no campaigns yet. Create one from Marketing to file this sequence under it."
        />
      </Stack>
    </CardDisplay>
  )
})

interface SequenceStepItemProps
  extends Omit<
    OutreachStepCardProps,
    'onChange' | 'onMove' | 'onRemove' | 'onSendTest'
  > {
  /** Whether the step offers a test send: an email in a sequence that is not archived. */
  canSendTest: boolean
  onStepChange(index: number, step: OutreachSequenceStep): void
  onStepMove(index: number, direction: -1 | 1): void
  onStepRemove(index: number): void
  onStepTest(index: number): void
}

/**
 * One step's card, bound to its position. Memoized, with handlers that keep
 * their identity, so a keystroke in one step leaves the others undrawn.
 */
const SequenceStepItem = memo(function SequenceStepItem(
  props: SequenceStepItemProps,
) {
  const {
    index,
    canSendTest,
    onStepChange,
    onStepMove,
    onStepRemove,
    onStepTest,
    ...card
  } = props
  const onChange = useCallback(
    (step: OutreachSequenceStep) => onStepChange(index, step),
    [index, onStepChange],
  )
  const onMove = useCallback(
    (direction: -1 | 1) => onStepMove(index, direction),
    [index, onStepMove],
  )
  const onRemove = useCallback(
    () => onStepRemove(index),
    [index, onStepRemove],
  )
  const onSendTest = useCallback(() => onStepTest(index), [index, onStepTest])
  return (
    <OutreachStepCard
      {...card}
      index={index}
      onChange={onChange}
      onMove={onMove}
      onRemove={onRemove}
      onSendTest={canSendTest ? onSendTest : undefined}
    />
  )
})

/** Adds an email, or a task of a kind picked from its menu. */
const SequenceAddStep = memo(function SequenceAddStep(props: {
  emailDisabled: boolean
  taskDisabled: boolean
  onAddEmail(): void
  onAddTask(kind: OutreachTaskKind): void
}) {
  const { onAddTask } = props
  const [taskAnchor, setTaskAnchor] = useState<HTMLElement | null>(null)
  return (
    <Stack direction="row" spacing={1} sx={ADD_STEP_ROW}>
      <Button
        variant="outlined"
        startIcon={<MdiIcon path={mdiPlus.path} fontSize="small" />}
        disabled={props.emailDisabled}
        onClick={props.onAddEmail}
      >
        Add email
      </Button>
      <Button
        variant="outlined"
        startIcon={<MdiIcon path={mdiPlus.path} fontSize="small" />}
        disabled={props.taskDisabled}
        onClick={(event) => setTaskAnchor(event.currentTarget)}
        aria-haspopup="menu"
      >
        Add task
      </Button>
      <Menu
        anchorEl={taskAnchor}
        open={Boolean(taskAnchor)}
        onClose={() => setTaskAnchor(null)}
      >
        {OUTREACH_TASK_KINDS.map((kind: OutreachTaskKind) => (
          <MenuItem
            key={kind}
            onClick={() => {
              setTaskAnchor(null)
              onAddTask(kind)
            }}
          >
            {OUTREACH_TASK_KIND_LABELS[kind]}
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  )
})

interface SequenceSendingCardProps {
  settings: SequenceSettings
  countryOptions: readonly string[]
  countriesIssue?: string
  daysIssue?: string
  hoursIssue?: string
  disabled: boolean
  onCountries(next: string[]): void
  onSettings(patch: Partial<SequenceSettings>): void
}

/** Who the sequence sends to, and when: its countries, switches and hours. */
const SequenceSendingCard = memo(function SequenceSendingCard(
  props: SequenceSendingCardProps,
) {
  const { settings, disabled, onSettings } = props
  const setAllowCustomers = useCallback(
    (event: SwitchChange) =>
      onSettings({ allowCustomers: event.target.checked }),
    [onSettings],
  )
  const setTrackClicks = useCallback(
    (event: SwitchChange) => onSettings({ trackClicks: event.target.checked }),
    [onSettings],
  )
  const setCountOpens = useCallback(
    (event: SwitchChange) => onSettings({ countOpens: event.target.checked }),
    [onSettings],
  )
  const setListUnsubscribe = useCallback(
    (event: SwitchChange) =>
      onSettings({ listUnsubscribe: event.target.checked }),
    [onSettings],
  )
  const setWindow = useCallback(
    (window: SequenceSettings['window']) => onSettings({ window }),
    [onSettings],
  )
  return (
    <CardDisplay
      header="Who it sends to, and when"
      help={pluginDocsHelp('sequences', { anchor: '#sequence-sending-settings' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <OutreachCountriesField
          options={props.countryOptions}
          value={settings.allowedCountries}
          onChange={props.onCountries}
          issue={props.countriesIssue}
          disabled={disabled}
        />
        <FormControlLabel
          control={
            <Switch
              checked={settings.allowCustomers}
              onChange={setAllowCustomers}
              disabled={disabled}
            />
          }
          label="Include customers"
        />
        {/*
          * Click tracking (AGL-3239), with its cost stated where it is
          * chosen rather than in a document nobody opens. Off by
          * default: it changes the link a cold recipient sees. The
          * emails stay plain text either way; opens are the separate
          * switch below.
          */}
        <Stack spacing={0}>
          <FormControlLabel
            control={
              <Switch
                checked={settings.trackClicks}
                onChange={setTrackClicks}
                disabled={disabled}
              />
            }
            label="Count link clicks"
          />
          <Typography variant="caption" color="text.secondary">
            Links in these emails are replaced with links of ours that
            forward to the same page, so clicks can be counted. The
            recipient sees the replacement, not your address. The
            emails stay plain text.
          </Typography>
        </Stack>
        {/*
          * Open counting (AGL-3395), off by default, its cost stated
          * where it is chosen: an HTML copy with a tracking image is the
          * least one-to-one thing a sequence email can carry, so it is
          * for measuring a slice, not for every sequence.
          */}
        <Stack spacing={0}>
          <FormControlLabel
            control={
              <Switch
                checked={settings.countOpens}
                onChange={setCountOpens}
                disabled={disabled}
              />
            }
            label="Count opens"
          />
          <Typography variant="caption" color="text.secondary">
            Each email also goes out as HTML — the same words — with a
            tiny tracking image, so opens can be counted. The plain-text
            version is unchanged. It makes the email look less like one
            written by hand, and some spam filters score HTML with a
            remote image against you, so turn it on to measure a slice
            of your sends rather than for every sequence. Gmail opens
            count; Apple Mail loads every image on arrival, so its loads
            are counted separately.
          </Typography>
        </Stack>
        {/*
          * The mail-client unsubscribe button (AGL-3296), off by
          * default: the header is what makes Apple Mail, Gmail and
          * Outlook present a one-to-one email as a mailing list. The
          * footer's "reply 'no'" line is the way out either way.
          */}
        <Stack spacing={0}>
          <FormControlLabel
            control={
              <Switch
                checked={settings.listUnsubscribe}
                onChange={setListUnsubscribe}
                disabled={disabled}
              />
            }
            label="Add a mail-client unsubscribe button"
          />
          <Typography variant="caption" color="text.secondary">
            Adds the List-Unsubscribe header, so the recipient’s mail
            app shows its own Unsubscribe button. It’s the easiest way
            out for them, and fewer people mark you as spam when they
            have it, but mail apps then label the email as coming from
            a mailing list. Off, the footer’s “reply ‘no’” line is the
            way out, and it’s always there.
          </Typography>
        </Stack>
        <MemoSendWindowFields
          window={settings.window}
          onChange={setWindow}
          daysIssue={props.daysIssue}
          hoursIssue={props.hoursIssue}
          disabled={disabled}
        />
      </Stack>
    </CardDisplay>
  )
})

/**
 * The sequence editor (AGL-2980): the name, the site and mailbox, the steps,
 * who it sends to and when, beside a live preview of each email.
 *
 * Every issue the engine's validator finds is shown beside its field — the
 * same validator the save route refuses with — errors once a save was
 * attempted, warnings as soon as they appear. What only the server can
 * judge (whose mailbox, which countries the organization allows, what may
 * no longer change once people are enrolled) comes back from the save and
 * is shown in the same places.
 *
 * ## A keystroke redraws its own field (AGL-3423)
 *
 * The whole sequence is one draft, so every letter typed anywhere is a new
 * draft, and drawing the editor from it inline redrew every field of every
 * step, the settings and the preview with each one: 17 inputs and some 1,150
 * components for one letter in a three-step sequence. That cost is what lets
 * typed input queue, and queued keystrokes processed back to back are what
 * drove the countries chips into React's #185. The sequence card, each step,
 * the sending card and the preview are memoized and handed only what they
 * show, through handlers that keep their identity; the handlers that wrote
 * from the draft as drawn still do, through `drawn`. A letter now redraws the
 * field it lands in, and the preview when it shows that step's email.
 */
export function OutreachSequenceEditor(props: OutreachSequenceEditorProps) {
  const { orgId, orgMount, sequence, settings } = props
  const api = useOutreachApi(orgId)
  const { enqueueSnackbar } = useSnackbar()
  const { data: user } = useUser()
  const uid = user?.uid ?? null
  const mountedHosts = orgMount?.hosts
  const hosts = useMemo(() => mountedHosts ?? [], [mountedHosts])
  const allowedCountries = settings.settings?.allowedCountries
  const orgCountries = useMemo(
    () => allowedCountries ?? ['US'],
    [allowedCountries],
  )

  const [draft, setDraft] = useState<OutreachSequenceDraft>(() =>
    sequence
      ? outreachSequenceDraftOf(sequence)
      : emptyOutreachSequenceDraft({
          hostId: hosts.length === 1 ? hosts[0].id : '',
          allowedCountries: orgCountries,
        }),
  )
  const [attempted, setAttempted] = useState(false)
  const [serverIssues, setServerIssues] = useState<OutreachSequenceIssue[]>([])
  const [saving, setSaving] = useState(false)
  // The step whose test-send dialog is open (AGL-3325), by index.
  const [testing, setTesting] = useState<number | null>(null)
  // The draft as last drawn, which the handlers that build on it read.
  const drawn = useRef(draft)
  drawn.current = draft

  // A stored sequence the listener updated (a save, a status change) is the
  // new starting point.
  useEffect(() => {
    if (sequence) setDraft(outreachSequenceDraftOf(sequence))
  }, [sequence])
  // A new sequence starts on the organization's countries once they are read.
  const settingsCountries = settings.settings?.allowedCountries.join(',')
  useEffect(() => {
    if (!sequence && settingsCountries) {
      setDraft((previous) => ({
        ...previous,
        settings: {
          ...previous.settings,
          allowedCountries: settingsCountries.split(','),
        },
      }))
    }
  }, [sequence, settingsCountries])
  useEffect(() => {
    if (!sequence && !draft.hostId && hosts.length === 1)
      setDraft((previous) => ({ ...previous, hostId: hosts[0].id }))
  }, [sequence, draft.hostId, hosts])

  // A new sequence starts on the member's own mailbox when they have exactly
  // one that is sending.
  const ownSending = props.mailboxes.mailboxes.filter(
    (entry) => entry.connectedByUid === uid && entry.status === 'connected',
  )
  const onlyOwnMailbox = ownSending.length === 1 ? ownSending[0].id : ''
  useEffect(() => {
    if (!sequence && !draft.mailboxId && onlyOwnMailbox)
      setDraft((previous) => ({ ...previous, mailboxId: onlyOwnMailbox }))
  }, [sequence, draft.mailboxId, onlyOwnMailbox])

  const templates = useOutreachEmailTemplates(orgId, draft.hostId || null, uid)
  const mailbox =
    props.mailboxes.mailboxes.find((entry) => entry.id === draft.mailboxId) ??
    null
  const sender = useMemo(
    () =>
      mailbox
        ? { name: mailbox.displayName, email: mailbox.sendAs || mailbox.email }
        : null,
    [mailbox],
  )
  const archived = sequence?.status === 'archived'
  /*
   * The org's campaigns, for the picker (AGL-3254): read while the editor
   * is open. A sequence is the organization's record and so is a campaign,
   * so the choice is every campaign in the org, whichever site the
   * sequence sends as.
   */
  const campaigns = useOrgContainerOptions('campaign', orgId, { enabled: true })

  const issues = useMemo(() => {
    const judged = [
      ...validateOutreachSequence(draft),
      ...serverIssues,
    ] as OutreachSequenceIssue[]
    return judged.filter(
      (issue) =>
        issue.severity === 'warning' ||
        attempted ||
        serverIssues.includes(issue),
    )
  }, [draft, serverIssues, attempted])
  const issueAt = (path: string) =>
    issues.find((issue) => issue.path === path)?.message
  const stepIssues = useStepIssues(issues, draft.steps.length)
  const listIssue = issueAt('steps')
  const countriesIssue = issues.find((issue) =>
    issue.path.startsWith('settings.allowedCountries'),
  )?.message

  // An edit clears what the last save refused. The empty list stays the same
  // list, so an edit with nothing to clear does not change that state.
  const clearServerIssues = useCallback(
    () => setServerIssues((previous) => (previous.length ? [] : previous)),
    [],
  )
  const update = useCallback(
    (next: Partial<OutreachSequenceDraft>) => {
      clearServerIssues()
      setDraft((previous) => ({ ...previous, ...next }))
    },
    [clearServerIssues],
  )
  // Stable, for the memoized countries field: it reads the settings it
  // replaces from the draft it is given rather than from this render's.
  const setCountries = useCallback(
    (next: string[]) => {
      clearServerIssues()
      setDraft((previous) => ({
        ...previous,
        settings: { ...previous.settings, allowedCountries: next },
      }))
    },
    [clearServerIssues],
  )
  const setName = useCallback(
    (event: FieldChange) => update({ name: event.target.value }),
    [update],
  )
  const setHost = useCallback(
    (event: FieldChange) => update({ hostId: event.target.value }),
    [update],
  )
  const setMailbox = useCallback(
    (mailboxId: string) =>
      update({
        mailboxId,
        // The sequence's own mailbox is never also one it rotates through.
        mailboxIds: drawn.current.mailboxIds?.filter((id) => id !== mailboxId).length
          ? drawn.current.mailboxIds.filter((id) => id !== mailboxId)
          : undefined,
      }),
    [update],
  )
  const setRotation = useCallback(
    (mailboxIds: string[]) => update({ mailboxIds: mailboxIds.length ? mailboxIds : undefined }),
    [update],
  )
  const setCampaigns = useCallback(
    (campaignIds: string[]) => update({ campaignIds }),
    [update],
  )
  const setSettings = useCallback(
    (patch: Partial<SequenceSettings>) =>
      update({ settings: { ...drawn.current.settings, ...patch } }),
    [update],
  )
  const setStep = useCallback(
    (index: number, step: OutreachSequenceStep) =>
      update({
        steps: drawn.current.steps.map((entry, position) =>
          position === index ? step : entry,
        ),
      }),
    [update],
  )
  const moveStep = useCallback(
    (index: number, direction: -1 | 1) => {
      const steps = [...drawn.current.steps]
      const [moved] = steps.splice(index, 1)
      steps.splice(index + direction, 0, moved)
      update({ steps })
    },
    [update],
  )
  const removeStep = useCallback(
    (index: number) =>
      update({
        steps: drawn.current.steps.filter(
          (_entry, position) => position !== index,
        ),
      }),
    [update],
  )
  const addEmail = useCallback(
    () =>
      update({
        steps: [
          ...drawn.current.steps,
          newOutreachEmailStep(drawn.current.steps),
        ],
      }),
    [update],
  )
  const addTask = useCallback(
    (kind: OutreachTaskKind) =>
      update({
        steps: [
          ...drawn.current.steps,
          newOutreachTaskStep(drawn.current.steps, kind),
        ],
      }),
    [update],
  )
  const emailCount = draft.steps.filter((step) => step.kind === 'email').length
  const full = draft.steps.length >= OUTREACH_MAX_STEPS
  const firstEmail = draft.steps.findIndex((entry) => entry.kind === 'email')
  const threadSubject = (index: number) => {
    for (let position = index - 1; position >= 0; position -= 1) {
      const step = draft.steps[position]
      if (step.kind === 'email' && !isInThreadEmailStep(draft.steps, position))
        return step.subject
    }
    return ''
  }

  const save = async () => {
    setAttempted(true)
    if (
      validateOutreachSequence(draft).some(
        (issue) => issue.severity === 'error',
      )
    )
      return
    setSaving(true)
    try {
      const answer = await api.saveSequence(sequence?.id ?? null, draft)
      setServerIssues([])
      setAttempted(false)
      enqueueSnackbar(
        answer.created ? 'Sequence created.' : 'Sequence saved.',
        { variant: 'success' },
      )
      props.onSaved(answer.sequence)
    } catch (error) {
      if (error instanceof OutreachRouteError && error.issues.length) {
        setServerIssues(
          error.issues.filter(
            (issue): issue is OutreachSequenceIssue => 'path' in issue,
          ),
        )
      }
      enqueueSnackbar((error as Error).message, {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSaving(false)
    }
  }
  // The save as last drawn, behind a handler that keeps its identity.
  const drawnSave = useRef(save)
  drawnSave.current = save
  const onSave = useCallback(() => void drawnSave.current(), [])

  const siteName = hosts.find((host) => host.id === draft.hostId)?.name ?? ''
  const draftCountries = draft.settings.allowedCountries
  const countryOptions = useMemo(
    () => [...new Set([...orgCountries, ...draftCountries])],
    [orgCountries, draftCountries],
  )
  /*
   * A test sends the step as STORED (AGL-3325): the route reads the saved
   * sequence, so a new one has nothing to send yet and an edited one sends
   * its last save — said on the button and in the dialog rather than found
   * out in the inbox.
   */
  const unsaved =
    sequence !== null &&
    JSON.stringify(draft) !== JSON.stringify(outreachSequenceDraftOf(sequence))
  const sendTestDisabledReason = !sequence
    ? 'Create the sequence to send a test of it.'
    : !draft.mailboxId
      ? 'Choose a mailbox to send the test from.'
      : null

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Stack spacing={2}>
          {archived ? (
            <Alert severity="info">
              This sequence is archived, so it can’t be edited.
            </Alert>
          ) : null}
          <SequenceCard
            orgId={orgId}
            uid={uid}
            name={draft.name}
            hostId={draft.hostId}
            mailboxId={draft.mailboxId}
            mailboxIds={draft.mailboxIds ?? NO_ROTATION}
            campaignIds={draft.campaignIds}
            hosts={hosts}
            mailboxes={props.mailboxes}
            mailboxesPath={props.mailboxesPath}
            campaignOptions={campaigns.options}
            noCampaigns={campaigns.ready && !campaigns.options.length}
            nameIssue={issueAt('name')}
            hostIssue={issueAt('hostId')}
            mailboxIssue={issueAt('mailboxId')}
            rotationIssue={issueAt('mailboxIds')}
            campaignsIssue={issueAt('campaignIds')}
            archived={archived}
            saving={saving}
            saveLabel={sequence ? 'Save' : 'Create sequence'}
            onCancel={props.onCancel}
            onSave={onSave}
            onName={setName}
            onHost={setHost}
            onMailbox={setMailbox}
            onRotation={setRotation}
            onCampaigns={setCampaigns}
          />

          {listIssue ? <Alert severity="error">{listIssue}</Alert> : null}
          {draft.steps.map((step, index) => {
            const inThread = isInThreadEmailStep(draft.steps, index)
            return (
              <SequenceStepItem
                key={step.id || `step-${index}`}
                step={step}
                index={index}
                count={draft.steps.length}
                firstEmail={firstEmail === index}
                inThread={inThread}
                // Read only by an email sent in the thread, so no other
                // step is redrawn as the subject it replies to is typed.
                threadSubject={inThread ? threadSubject(index) : ''}
                templates={templates.data}
                issues={stepIssues[index]}
                disabled={archived}
                canSendTest={step.kind === 'email' && !archived}
                sendTestDisabledReason={sendTestDisabledReason}
                onStepChange={setStep}
                onStepMove={moveStep}
                onStepRemove={removeStep}
                onStepTest={setTesting}
              />
            )
          })}
          <SequenceAddStep
            emailDisabled={
              archived || full || emailCount >= OUTREACH_MAX_EMAIL_STEPS
            }
            taskDisabled={archived || full}
            onAddEmail={addEmail}
            onAddTask={addTask}
          />
          <Typography variant="caption" color="text.secondary">
            {`Up to ${OUTREACH_MAX_STEPS} steps, ${OUTREACH_MAX_EMAIL_STEPS} of them emails.`}
          </Typography>

          <SequenceSendingCard
            settings={draft.settings}
            countryOptions={countryOptions}
            countriesIssue={countriesIssue}
            daysIssue={issueAt('settings.window.days')}
            hoursIssue={issueAt('settings.window')}
            disabled={archived}
            onCountries={setCountries}
            onSettings={setSettings}
          />

        </Stack>
      </Grid>
      {sequence && testing !== null ? (
        <OutreachStepTestDialog
          open
          onClose={() => setTesting(null)}
          orgId={orgId}
          sequence={sequence}
          stepIndex={testing}
          contactGroupId={
            sequence.hostId
              ? consentGroupForHost(props.org ?? null, sequence.hostId).groupId
              : ''
          }
          selfEmail={user?.email ?? null}
          unsaved={unsaved}
          api={api}
        />
      ) : null}
      <Grid size={{ xs: 12, md: 5 }}>
        <Box sx={PREVIEW_COLUMN}>
          <MemoSequencePreview
            steps={draft.steps}
            orgSettings={settings.settings}
            orgSettingsStatus={settings.status}
            templates={templates.data}
            sender={sender}
            siteName={siteName}
          />
        </Box>
      </Grid>
    </Grid>
  )
}
OutreachSequenceEditor.displayName = 'OutreachSequenceEditor'

export default OutreachSequenceEditor
