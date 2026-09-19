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
import { mdiPlus } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
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
import { type ReactNode, useEffect, useMemo, useState } from 'react'
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
  type OutreachMailbox,
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
import { OutreachSequencePreview } from './sequence-preview'
import { OutreachStepCard } from './sequence-step-card'
import { OutreachRouteError, useOutreachApi } from './use-outreach-api'
import { useOutreachEmailTemplates } from './use-outreach-crm'
import type { OutreachSettingsLoad } from './use-outreach-settings'

export interface OutreachSequenceEditorProps {
  orgId: string
  orgMount?: ConsolePluginOrgMount
  /** The stored sequence, or `null` for a new one. */
  sequence: OutreachSequence | null
  /** The organization's compliance settings: its countries, and the preview's footer. */
  settings: OutreachSettingsLoad
  /** The organization's connected mailboxes: who the preview's emails are from. */
  mailboxes: readonly OutreachMailbox[]
  /** The mailbox picker, rendered in the sequence card beside the site. */
  mailboxField?: (props: {
    value: string
    onChange(mailboxId: string): void
    error?: string
    disabled?: boolean
  }) => ReactNode
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
  const hosts = orgMount?.hosts ?? []
  const orgCountries = settings.settings?.allowedCountries ?? ['US']

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

  const templates = useOutreachEmailTemplates(orgId, draft.hostId || null, uid)
  const mailbox =
    props.mailboxes.find((entry) => entry.id === draft.mailboxId) ?? null
  const archived = sequence?.status === 'archived'

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

  const update = (next: Partial<OutreachSequenceDraft>) => {
    setServerIssues([])
    setDraft((previous) => ({ ...previous, ...next }))
  }
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
  const countryOptions = [
    ...new Set([...orgCountries, ...draft.settings.allowedCountries]),
  ]

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
            help={pluginDocsHelp('outreach', { anchor: '#build-a-sequence' })}
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
              {props.mailboxField ? (
                props.mailboxField({
                  value: draft.mailboxId,
                  onChange: (mailboxId) => update({ mailboxId }),
                  error: issueAt('mailboxId'),
                  disabled: archived,
                })
              ) : issueAt('mailboxId') ? (
                <Alert severity="error">{issueAt('mailboxId')}</Alert>
              ) : null}
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
            help={pluginDocsHelp('outreach', {
              anchor: '#build-a-sequence',
              excerpt:
                'A sequence sends only to the countries both it and your organization allow, and in its mailbox’s sending hours unless it has its own.',
            })}
            contentGutterX
            contentGutterY
          >
            <Stack spacing={2}>
              <Autocomplete<string, true>
                multiple
                options={countryOptions}
                value={draft.settings.allowedCountries}
                getOptionLabel={outreachCountryLabel}
                onChange={(_event, next) =>
                  update({
                    settings: { ...draft.settings, allowedCountries: next },
                  })
                }
                disabled={archived}
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
                    error={Boolean(countriesIssue)}
                    helperText={
                      countriesIssue ??
                      'Among the countries your organization allows. Cold contacts are emailed only in the United States.'
                    }
                  />
                )}
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

          {archived ? null : (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ justifyContent: 'flex-end' }}
            >
              {props.onCancel ? (
                <Button
                  variant="text"
                  onClick={props.onCancel}
                  disabled={saving}
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                variant="contained"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? 'Saving…' : sequence ? 'Save' : 'Create sequence'}
              </Button>
            </Stack>
          )}
        </Stack>
      </Grid>
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
