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
import CampaignPicker from '@aglyn/shared-ui-email-campaigns/components/campaign-picker.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useOrgCampaigns, useUser } from '@aglyn/tenant-feature-instance'
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
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
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
import { OutreachSequenceMailboxPicker } from './sequence-mailbox-picker'
import { OutreachSequencePreview } from './sequence-preview'
import { OutreachStepCard } from './sequence-step-card'
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
  const [taskAnchor, setTaskAnchor] = useState<HTMLElement | null>(null)
  // The step whose test-send dialog is open (AGL-3325), by index.
  const [testing, setTesting] = useState<number | null>(null)

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
  const archived = sequence?.status === 'archived'
  /*
   * The org's campaigns, for the picker (AGL-3254): read while the editor
   * is open. A sequence is the organization's record and so is a campaign,
   * so the choice is every campaign in the org, whichever site the
   * sequence sends as.
   */
  const campaigns = useOrgCampaigns(orgId, { enabled: true })

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
  const stepIssues = (index: number) => {
    const found: Record<string, string> = {}
    for (const issue of issues) {
      const key = stepIssueKey(issue.path)
      if (key?.index === index && !found[key.field])
        found[key.field] = issue.message
    }
    return found
  }
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
  const update = (next: Partial<OutreachSequenceDraft>) => {
    clearServerIssues()
    setDraft((previous) => ({ ...previous, ...next }))
  }
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
  const setStep = (index: number, step: OutreachSequenceStep) =>
    update({
      steps: draft.steps.map((entry, position) =>
        position === index ? step : entry,
      ),
    })
  const moveStep = (index: number, direction: -1 | 1) => {
    const steps = [...draft.steps]
    const [moved] = steps.splice(index, 1)
    steps.splice(index + direction, 0, moved)
    update({ steps })
  }
  const emailCount = draft.steps.filter((step) => step.kind === 'email').length
  const full = draft.steps.length >= OUTREACH_MAX_STEPS
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
          <CardDisplay
            header="Sequence"
            help={pluginDocsHelp('sequences', { anchor: '#build-a-sequence' })}
            // The whole sequence (steps and sending rules included) saves
            // from its first card's header, where the console puts a card's
            // actions (AGL-3333).
            HeaderProps={{
              action: archived ? undefined : (
                <Stack direction="row" spacing={1}>
                  {props.onCancel ? (
                    <Button
                      size="small"
                      variant="text"
                      onClick={props.onCancel}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => void save()}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : sequence ? 'Save' : 'Create sequence'}
                  </Button>
                </Stack>
              ),
            }}
            contentGutterX
            contentGutterY
          >
            <Stack spacing={2}>
              <TextField
                label="Name"
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                disabled={archived}
                error={Boolean(issueAt('name'))}
                helperText={issueAt('name')}
                slotProps={{
                  htmlInput: { maxLength: OUTREACH_SEQUENCE_NAME_MAX + 20 },
                }}
                fullWidth
              />
              <TextField
                select
                label="Site"
                value={
                  hosts.some((host) => host.id === draft.hostId)
                    ? draft.hostId
                    : ''
                }
                onChange={(event) => update({ hostId: event.target.value })}
                disabled={archived || !hosts.length}
                error={Boolean(issueAt('hostId'))}
                helperText={
                  issueAt('hostId') ??
                  'The site whose contacts this sequence emails.'
                }
                fullWidth
              >
                {hosts.map((host) => (
                  <MenuItem key={host.id} value={host.id}>
                    {host.name}
                  </MenuItem>
                ))}
              </TextField>
              <OutreachSequenceMailboxPicker
                orgId={orgId}
                uid={uid}
                mailboxes={props.mailboxes}
                mailboxesPath={props.mailboxesPath}
                value={draft.mailboxId}
                onChange={(mailboxId) => update({ mailboxId })}
                error={issueAt('mailboxId')}
                disabled={archived}
              />
              {/*
                The campaigns this sequence is part of (AGL-3254), picked the
                way a form's page picks them. Everyone enrolled joins them,
                and what the sequence produces is reported under them; it
                does not change who is enrolled or what is sent.
               */}
              <CampaignPicker
                options={campaigns.options}
                value={draft.campaignIds}
                onChange={(campaignIds) => update({ campaignIds })}
                label="Campaigns"
                helperText={
                  issueAt('campaignIds') ??
                  'The campaigns this sequence is part of. Everyone enrolled joins them, and its sends, replies, meetings and conversions count on their pages.'
                }
                disabled={archived}
                empty={campaigns.ready && !campaigns.options.length}
                emptyText="There are no campaigns yet. Create one from Marketing to file this sequence under it."
              />
            </Stack>
          </CardDisplay>

          {listIssue ? <Alert severity="error">{listIssue}</Alert> : null}
          {draft.steps.map((step, index) => (
            <OutreachStepCard
              key={step.id || `step-${index}`}
              step={step}
              index={index}
              count={draft.steps.length}
              firstEmail={
                draft.steps.findIndex((entry) => entry.kind === 'email') ===
                index
              }
              inThread={isInThreadEmailStep(draft.steps, index)}
              threadSubject={threadSubject(index)}
              templates={templates.data}
              issues={stepIssues(index)}
              disabled={archived}
              onChange={(next) => setStep(index, next)}
              onMove={(direction) => moveStep(index, direction)}
              onRemove={() =>
                update({
                  steps: draft.steps.filter(
                    (_entry, position) => position !== index,
                  ),
                })
              }
              onSendTest={
                step.kind === 'email' && !archived
                  ? () => setTesting(index)
                  : undefined
              }
              sendTestDisabledReason={sendTestDisabledReason}
            />
          ))}
          <Stack
            direction="row"
            spacing={1}
            sx={{ flexWrap: 'wrap', rowGap: 1 }}
          >
            <Button
              variant="outlined"
              startIcon={<MdiIcon path={mdiPlus.path} fontSize="small" />}
              disabled={
                archived || full || emailCount >= OUTREACH_MAX_EMAIL_STEPS
              }
              onClick={() =>
                update({
                  steps: [...draft.steps, newOutreachEmailStep(draft.steps)],
                })
              }
            >
              Add email
            </Button>
            <Button
              variant="outlined"
              startIcon={<MdiIcon path={mdiPlus.path} fontSize="small" />}
              disabled={archived || full}
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
                    update({
                      steps: [
                        ...draft.steps,
                        newOutreachTaskStep(draft.steps, kind),
                      ],
                    })
                  }}
                >
                  {OUTREACH_TASK_KIND_LABELS[kind]}
                </MenuItem>
              ))}
            </Menu>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {`Up to ${OUTREACH_MAX_STEPS} steps, ${OUTREACH_MAX_EMAIL_STEPS} of them emails.`}
          </Typography>

          <CardDisplay
            header="Who it sends to, and when"
            help={pluginDocsHelp('sequences', {
              anchor: '#build-a-sequence',
              excerpt:
                'A sequence sends only to the countries both it and your organization allow, and in its mailbox’s sending hours unless it has its own.',
            })}
            contentGutterX
            contentGutterY
          >
            <Stack spacing={2}>
              <OutreachCountriesField
                options={countryOptions}
                value={draftCountries}
                onChange={setCountries}
                issue={countriesIssue}
                disabled={archived}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={draft.settings.allowCustomers}
                    onChange={(event) =>
                      update({
                        settings: {
                          ...draft.settings,
                          allowCustomers: event.target.checked,
                        },
                      })
                    }
                    disabled={archived}
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
                      checked={draft.settings.trackClicks}
                      onChange={(event) =>
                        update({
                          settings: {
                            ...draft.settings,
                            trackClicks: event.target.checked,
                          },
                        })
                      }
                      disabled={archived}
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
                      checked={draft.settings.countOpens}
                      onChange={(event) =>
                        update({
                          settings: {
                            ...draft.settings,
                            countOpens: event.target.checked,
                          },
                        })
                      }
                      disabled={archived}
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
                      checked={draft.settings.listUnsubscribe}
                      onChange={(event) =>
                        update({
                          settings: {
                            ...draft.settings,
                            listUnsubscribe: event.target.checked,
                          },
                        })
                      }
                      disabled={archived}
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
              <OutreachSendWindowFields
                window={draft.settings.window}
                onChange={(window) =>
                  update({ settings: { ...draft.settings, window } })
                }
                daysIssue={issueAt('settings.window.days')}
                hoursIssue={issueAt('settings.window')}
                disabled={archived}
              />
            </Stack>
          </CardDisplay>

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
        <Box sx={{ position: { md: 'sticky' }, top: { md: 16 } }}>
          <OutreachSequencePreview
            steps={draft.steps}
            orgSettings={settings.settings}
            orgSettingsStatus={settings.status}
            templates={templates.data}
            sender={
              mailbox
                ? {
                    name: mailbox.displayName,
                    email: mailbox.sendAs || mailbox.email,
                  }
                : null
            }
            siteName={siteName}
          />
        </Box>
      </Grid>
    </Grid>
  )
}
OutreachSequenceEditor.displayName = 'OutreachSequenceEditor'

export default OutreachSequenceEditor
