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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { HelpTip } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  type ChipProps,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { isOutreachGatewayFronted, outreachGatewayChip } from '../engine/mail-gateway'
import {
  OUTREACH_ENROLL_BATCH_MAX,
  type OutreachEnrollGateway,
  type OutreachEnrollOutcome,
  type OutreachEnrollPreviewPerson,
  type OutreachEnrollPreviewResponse,
  type OutreachEnrollPreviewStatus,
  type OutreachEnrollSource,
  type OutreachPreviewResponse,
  type OutreachStepTestResponse,
} from '../model/outreach-api'
import {
  OUTREACH_ATTESTATION_LABELS,
  OUTREACH_PERSONAL_LINE_MAX,
  type OutreachAttestationKind,
  type OutreachSequence,
  type OutreachSequenceStep,
} from '../model/outreach.types'
import { outreachEmailStepLabel } from './curate-step-dialog'
import {
  OutreachCuratedStepEditor,
  outreachDraftState,
  outreachDraftToOverride,
  outreachMemberDraftStates,
  type OutreachCuratedDraftState,
} from './curated-step-editor'
import { OutreachLoading, OutreachLoadProblem } from './outreach-ui'
import type { OutreachApi } from './use-outreach-api'
import {
  type OutreachContactOption,
  useOutreachContactSearch,
  useOutreachLeadSearch,
  useOutreachSavedViews,
} from './use-outreach-crm'

export interface OutreachEnrollDialogProps {
  open: boolean
  onClose(): void
  orgId: string
  sequence: OutreachSequence
  /** The consent group of the sequence's site: whose names a search shows. */
  contactGroupId: string
  uid: string | null
  api: OutreachApi
}

const STATUS_LABELS: Record<OutreachEnrollPreviewStatus, string> = {
  eligible: 'Eligible',
  needs_confirmation: 'Needs you',
  blocked: 'Blocked',
}

const STATUS_COLORS: Record<OutreachEnrollPreviewStatus, ChipProps['color']> = {
  eligible: 'success',
  needs_confirmation: 'warning',
  blocked: 'default',
}

/** The gateway chip's color by its tone (AGL-3326). */
const GATEWAY_TONE_COLORS: Record<NonNullable<ReturnType<typeof outreachGatewayChip>>['tone'], ChipProps['color']> = {
  refused: 'error',
  delivered: 'success',
  neutral: 'default',
  blocked: 'default',
}

/**
 * Whether the gateway in front of this person refused the sender this week
 * (AGL-3326): the person is shown, and left un-ticked, rather than blocked
 * — the founder decides, and ticking them is the decision.
 */
export function outreachGatewayRefusedThisWeek(gateway: OutreachEnrollGateway | null | undefined): boolean {
  return (gateway?.blocked7 ?? 0) > 0
}

/** Where one person's curated drafts stand (AGL-3324). */
type Curation =
  | { status: 'idle' }
  | { status: 'drafting' }
  | { status: 'failed'; message: string }
  | { status: 'ready' }

/** What the rep has supplied for one person. */
interface Supplied {
  include: boolean
  personalLine: string
  attestations: OutreachAttestationKind[]
  /** The email steps drafted for this person, by step index; absent until they curate. */
  drafts?: Record<number, OutreachCuratedDraftState>
  curation?: Curation
}

/** The drafts the rep used, as the enroll and the preview carry them. */
function usedOverrides(supplied: Supplied | undefined) {
  return Object.values(supplied?.drafts ?? {})
    .map(outreachDraftToOverride)
    .filter((override): override is NonNullable<typeof override> => override !== null)
}

/** Whether a drafted step is still waiting on the rep to use it or keep the template. */
function hasOpenDrafts(supplied: Supplied | undefined): boolean {
  return Object.values(supplied?.drafts ?? {}).some((draft) => draft.decision === 'pending')
}

/** Where one person's test send stands (AGL-3325). */
type StepTest =
  | { status: 'sending' }
  | { status: 'sent'; answer: OutreachStepTestResponse }
  | { status: 'failed'; message: string }

type Stage =
  | { kind: 'source' }
  | { kind: 'previewing' }
  | { kind: 'preview'; answer: OutreachEnrollPreviewResponse }
  | { kind: 'enrolling'; answer: OutreachEnrollPreviewResponse }
  | { kind: 'done'; results: OutreachEnrollOutcome[]; enrolled: number }

/** Whether a person may be sent to Confirm as the rep has left them. */
export function outreachPersonReady(
  person: OutreachEnrollPreviewPerson,
  supplied: Supplied | undefined,
): boolean {
  if (person.status === 'blocked' || !supplied?.include) return false
  const line = supplied.personalLine.trim()
  if (line.length > OUTREACH_PERSONAL_LINE_MAX) return false
  // A draft the rep has read but neither used nor kept holds them back
  // (AGL-3324): nothing is enrolled with a decision still open.
  if (hasOpenDrafts(supplied)) return false
  if (person.status === 'eligible') return true
  if (person.requires.personalLine && !line) return false
  return person.requires.attestations.every((kind) =>
    supplied.attestations.includes(kind),
  )
}

/**
 * Enroll people in a sequence (AGL-2980).
 *
 * The rep picks a saved Contacts view or searches for people, and sees each
 * marked as the gates see them: eligible, blocked with the reason, or
 * waiting on them — for a cold contact, a personal line and the three
 * attestations only they can make, stored on the enrollment with who ticked
 * them and when. Enroll sends only the people who are ready, and the server
 * checks every gate again as it enrolls them.
 */
export function OutreachEnrollDialog(props: OutreachEnrollDialogProps) {
  const { orgId, sequence, api } = props
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  const [tab, setTab] = useState<'view' | 'search' | 'leads'>('view')
  const [viewId, setViewId] = useState('')
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Map<string, OutreachContactOption>>(
    new Map(),
  )
  // The leads picked from the sequence's site (AGL-3234), kept apart from
  // the contacts: the two are different records and the source names which.
  const [leadText, setLeadText] = useState('')
  const [pickedLeads, setPickedLeads] = useState<Map<string, OutreachContactOption>>(
    new Map(),
  )
  const [stage, setStage] = useState<Stage>({ kind: 'source' })
  const [problem, setProblem] = useState<string | null>(null)
  const [supplied, setSupplied] = useState<Record<string, Supplied>>({})
  const [emailPreview, setEmailPreview] = useState<
    Record<
      string,
      | { status: 'loading' }
      | { status: 'ready'; answer: OutreachPreviewResponse }
      | { status: 'failed'; message: string }
    >
  >({})
  const [stepTests, setStepTests] = useState<Record<string, StepTest>>({})

  const views = useOutreachSavedViews(props.open ? orgId : null, props.uid)
  const search = useOutreachContactSearch({
    orgId: props.open && tab === 'search' ? orgId : null,
    hostId: sequence.hostId,
    contactGroupId: props.contactGroupId,
    text,
  })
  const leadSearch = useOutreachLeadSearch({
    // The lead silo is the org's (AGL-3275); the site still narrows it.
    orgId,
    hostId: sequence.hostId,
    text: leadText,
    enabled: props.open && tab === 'leads',
  })

  const reset = () => {
    setStage({ kind: 'source' })
    setProblem(null)
    setSupplied({})
    setEmailPreview({})
    setStepTests({})
  }
  const close = () => {
    reset()
    setPicked(new Map())
    setPickedLeads(new Map())
    setText('')
    setLeadText('')
    setViewId('')
    props.onClose()
  }

  const preview = async (source: OutreachEnrollSource) => {
    setProblem(null)
    setStage({ kind: 'previewing' })
    try {
      const answer = await api.previewEnrollment(sequence.id, source)
      setSupplied(
        Object.fromEntries(
          answer.people.map((person) => [
            person.personId,
            {
              // A person whose gateway refused the sender this week starts
              // un-ticked (AGL-3326); the chip beside them says why.
              include: person.status !== 'blocked' && !outreachGatewayRefusedThisWeek(person.gateway),
              personalLine: '',
              attestations: [],
            },
          ]),
        ),
      )
      setStage({ kind: 'preview', answer })
    } catch (error) {
      setProblem((error as Error).message)
      setStage({ kind: 'source' })
    }
  }

  const answer =
    stage.kind === 'preview' || stage.kind === 'enrolling' ? stage.answer : null
  const ready = useMemo(
    () =>
      answer
        ? answer.people.filter((person) =>
            outreachPersonReady(person, supplied[person.personId]),
          )
        : [],
    [answer, supplied],
  )
  const waiting = answer
    ? answer.people.filter(
        (person) =>
          person.status !== 'blocked' &&
          supplied[person.personId]?.include &&
          !outreachPersonReady(person, supplied[person.personId]),
      ).length
    : 0

  const enroll = async () => {
    if (!answer || !ready.length) return
    setProblem(null)
    setStage({ kind: 'enrolling', answer })
    try {
      const result = await api.enroll(
        sequence.id,
        ready.map((person) => ({
          // A contact by id, or a lead by its key (AGL-3234).
          ...(person.target === 'lead' && person.leadId
            ? { leadId: person.leadId }
            : { contactId: person.contactId }),
          personalLine: supplied[person.personId]?.personalLine.trim() ?? '',
          attestations: supplied[person.personId]?.attestations ?? [],
          // The steps they curated and confirmed (AGL-3324); nothing else.
          ...(usedOverrides(supplied[person.personId]).length
            ? { stepOverrides: usedOverrides(supplied[person.personId]) }
            : {}),
        })),
      )
      setStage({
        kind: 'done',
        results: result.results,
        enrolled: result.enrolled,
      })
    } catch (error) {
      setProblem((error as Error).message)
      setStage({ kind: 'preview', answer })
    }
  }

  const supply = (personId: string, next: Partial<Supplied>) =>
    setSupplied((previous) => ({
      ...previous,
      [personId]: { ...previous[personId], ...next } as Supplied,
    }))

  const previewEmail = async (person: OutreachEnrollPreviewPerson) => {
    setEmailPreview((previous) => ({
      ...previous,
      [person.personId]: { status: 'loading' },
    }))
    try {
      const overrides = usedOverrides(supplied[person.personId])
      const result = await api.previewEmail({
        sequenceId: sequence.id,
        ...(person.target === 'lead' && person.leadId
          ? { leadId: person.leadId }
          : { contactId: person.contactId }),
        personalLine: supplied[person.personId]?.personalLine.trim() ?? '',
        // The preview shows the curated version (AGL-3324).
        ...(overrides.length ? { stepOverrides: overrides } : {}),
      })
      setEmailPreview((previous) => ({
        ...previous,
        [person.personId]: { status: 'ready', answer: result },
      }))
    } catch (error) {
      setEmailPreview((previous) => ({
        ...previous,
        [person.personId]: {
          status: 'failed',
          message: (error as Error).message,
        },
      }))
    }
  }

  /**
   * Curate for this person (AGL-3324): every email step drafted from their
   * record, the sequence's steps and the personal line as written so far,
   * shown under them for the rep to edit and confirm. Nothing is stored
   * until Enroll carries the drafts they used.
   */
  const curate = async (person: OutreachEnrollPreviewPerson) => {
    supply(person.personId, { curation: { status: 'drafting' } })
    try {
      const answer = await api.curateDrafts({
        sequenceId: sequence.id,
        ...(person.target === 'lead' && person.leadId
          ? { leadId: person.leadId }
          : { contactId: person.contactId }),
        personalLine: supplied[person.personId]?.personalLine.trim() ?? '',
      })
      const audit = { prompt: answer.prompt, model: answer.model }
      supply(person.personId, {
        curation: { status: 'ready' },
        drafts: Object.fromEntries(
          answer.drafts.map((draft) => [draft.stepIndex, outreachDraftState(draft, sequence.steps, 'ai', audit)]),
        ),
      })
    } catch (error) {
      supply(person.personId, { curation: { status: 'failed', message: (error as Error).message } })
    }
  }

  /** The rep's own words for every email step, when the AI cannot draft. */
  const writeThemselves = (person: OutreachEnrollPreviewPerson) => {
    const stepIndexes = sequence.steps
      .map((step, index) => (step.kind === 'email' ? index : -1))
      .filter((index) => index >= 0)
    supply(person.personId, {
      curation: { status: 'ready' },
      drafts: Object.fromEntries(
        outreachMemberDraftStates(sequence.steps, stepIndexes).map((draft) => [draft.stepIndex, draft]),
      ),
    })
  }

  /**
   * This person's first email, sent to the member as a test (AGL-3325):
   * their record, the personal line as written so far and the curated copy
   * they used (AGL-3324) fill it, and nothing is enrolled or stored for
   * them.
   */
  const sendTest = async (person: OutreachEnrollPreviewPerson) => {
    setStepTests((previous) => ({ ...previous, [person.personId]: { status: 'sending' } }))
    try {
      const overrides = usedOverrides(supplied[person.personId])
      const answer = await api.sendStepTest({
        sequenceId: sequence.id,
        ...(person.target === 'lead' && person.leadId
          ? { leadId: person.leadId }
          : { contactId: person.contactId }),
        personalLine: supplied[person.personId]?.personalLine.trim() ?? '',
        ...(overrides.length ? { stepOverrides: overrides } : {}),
      })
      setStepTests((previous) => ({ ...previous, [person.personId]: { status: 'sent', answer } }))
    } catch (error) {
      setStepTests((previous) => ({
        ...previous,
        [person.personId]: { status: 'failed', message: (error as Error).message },
      }))
    }
  }

  const title = `Enroll people in ${sequence.name}`

  return (
    <Dialog
      open={props.open}
      onClose={close}
      fullWidth
      maxWidth="md"
      fullScreen={narrow}
      aria-label={title}
    >
      <DialogTitle>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <span>{title}</span>
          <HelpTip {...pluginDocsHelp('sequences', { anchor: '#enroll' })} />
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {problem ? <Alert severity="error">{problem}</Alert> : null}

          {stage.kind === 'source' ? (
            <>
              <Tabs
                value={tab}
                onChange={(_event, next) => setTab(next)}
                aria-label="Where the people come from"
              >
                <Tab value="view" label="Saved view" />
                <Tab value="search" label="Search" />
                <Tab value="leads" label="Leads" />
              </Tabs>
              {tab === 'view' ? (
                views.status === 'loading' ? (
                  <OutreachLoading label="Loading saved views…" />
                ) : views.status === 'error' || views.status === 'refused' ? (
                  <OutreachLoadProblem
                    status={views.status}
                    what="saved views"
                    message={
                      views.status === 'refused'
                        ? 'Enrolling reads your CRM’s contacts, and your role does not include Manage data.'
                        : null
                    }
                  />
                ) : views.data.length ? (
                  <TextField
                    select
                    label="Saved Contacts view"
                    value={viewId}
                    onChange={(event) => setViewId(event.target.value)}
                    helperText={`Enrolls up to ${OUTREACH_ENROLL_BATCH_MAX} of the people the view shows at this sequence’s site — a Contacts view, or a Leads view of the site’s leads.`}
                    fullWidth
                  >
                    {views.data.map((view) => (
                      <MenuItem key={view.id} value={view.id}>
                        {view.section === 'leads' ? `${view.name} (Leads)` : view.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : (
                  <Alert severity="info">
                    You have no saved Contacts views to enroll from. Save one in
                    the CRM, or search instead.
                  </Alert>
                )
              ) : tab === 'leads' ? (
                <Stack spacing={1.5}>
                  <TextField
                    label="Search leads"
                    placeholder="A name, or an email address"
                    value={leadText}
                    onChange={(event) => setLeadText(event.target.value)}
                    helperText="The open leads at this sequence’s site. A lead is enrolled as it is, and follows itself to the contact it becomes."
                    fullWidth
                    autoFocus
                  />
                  {leadSearch.status === 'loading' ? (
                    <OutreachLoading label="Reading leads…" />
                  ) : null}
                  {leadSearch.status === 'error' || leadSearch.status === 'refused' ? (
                    <OutreachLoadProblem
                      status={leadSearch.status}
                      what="leads"
                      message={
                        leadSearch.status === 'refused'
                          ? 'Enrolling reads your CRM’s leads, and your role does not include Manage data.'
                          : 'The leads could not be read. Try again.'
                      }
                    />
                  ) : null}
                  {leadSearch.status === 'ready' && !leadSearch.idle && !leadSearch.data.length ? (
                    <Typography variant="body2" color="text.secondary">
                      No open leads at this sequence’s site match.
                    </Typography>
                  ) : null}
                  {leadSearch.data.length ? (
                    <List dense aria-label="Lead results">
                      {leadSearch.data.map((lead) => {
                        const checked = pickedLeads.has(lead.id)
                        return (
                          <ListItem key={lead.id} disablePadding>
                            <ListItemButton
                              onClick={() =>
                                setPickedLeads((previous) => {
                                  const next = new Map(previous)
                                  if (checked) next.delete(lead.id)
                                  else if (next.size < OUTREACH_ENROLL_BATCH_MAX) next.set(lead.id, lead)
                                  return next
                                })
                              }
                            >
                              <ListItemIcon>
                                <Checkbox edge="start" checked={checked} tabIndex={-1} disableRipple />
                              </ListItemIcon>
                              <ListItemText
                                primary={lead.name || lead.email || lead.id}
                                secondary={lead.email}
                              />
                            </ListItemButton>
                          </ListItem>
                        )
                      })}
                    </List>
                  ) : null}
                  {pickedLeads.size ? (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ flexWrap: 'wrap', rowGap: 1 }}
                      aria-label="Picked leads"
                    >
                      {[...pickedLeads.values()].map((lead) => (
                        <Chip
                          key={lead.id}
                          size="small"
                          label={lead.name || lead.email || lead.id}
                          onDelete={() =>
                            setPickedLeads((previous) => {
                              const next = new Map(previous)
                              next.delete(lead.id)
                              return next
                            })
                          }
                        />
                      ))}
                    </Stack>
                  ) : null}
                </Stack>
              ) : (
                <Stack spacing={1.5}>
                  <TextField
                    label="Search contacts"
                    placeholder="A name, or an email address"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    fullWidth
                    autoFocus
                  />
                  {search.status === 'loading' ? (
                    <OutreachLoading label="Searching…" />
                  ) : null}
                  {search.status === 'error' || search.status === 'refused' ? (
                    <OutreachLoadProblem
                      status={search.status}
                      what="contacts"
                      message={
                        search.status === 'refused'
                          ? 'Enrolling reads your CRM’s contacts, and your role does not include Manage data.'
                          : 'The search failed. Try again.'
                      }
                    />
                  ) : null}
                  {search.status === 'ready' &&
                  !search.idle &&
                  !search.data.length ? (
                    <Typography variant="body2" color="text.secondary">
                      No contacts at this sequence’s site match.
                    </Typography>
                  ) : null}
                  {search.data.length ? (
                    <List dense aria-label="Search results">
                      {search.data.map((contact) => {
                        const checked = picked.has(contact.id)
                        return (
                          <ListItem key={contact.id} disablePadding>
                            <ListItemButton
                              onClick={() =>
                                setPicked((previous) => {
                                  const next = new Map(previous)
                                  if (checked) next.delete(contact.id)
                                  else if (
                                    next.size < OUTREACH_ENROLL_BATCH_MAX
                                  )
                                    next.set(contact.id, contact)
                                  return next
                                })
                              }
                            >
                              <ListItemIcon>
                                <Checkbox
                                  edge="start"
                                  checked={checked}
                                  tabIndex={-1}
                                  disableRipple
                                />
                              </ListItemIcon>
                              <ListItemText
                                primary={
                                  contact.name || contact.email || contact.id
                                }
                                secondary={contact.email}
                              />
                            </ListItemButton>
                          </ListItem>
                        )
                      })}
                    </List>
                  ) : null}
                  {picked.size ? (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ flexWrap: 'wrap', rowGap: 1 }}
                      aria-label="Picked"
                    >
                      {[...picked.values()].map((contact) => (
                        <Chip
                          key={contact.id}
                          size="small"
                          label={contact.name || contact.email || contact.id}
                          onDelete={() =>
                            setPicked((previous) => {
                              const next = new Map(previous)
                              next.delete(contact.id)
                              return next
                            })
                          }
                        />
                      ))}
                    </Stack>
                  ) : null}
                </Stack>
              )}
            </>
          ) : null}

          {stage.kind === 'previewing' ? (
            <OutreachLoading label="Checking each person…" />
          ) : null}

          {answer ? (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {summary(answer)}
              </Typography>
              {answer.truncated ? (
                <Alert severity="info">
                  {`This shows the first ${answer.people.length} of ${answer.total}. Enroll these, then preview again for the rest.`}
                </Alert>
              ) : null}
              <Stack
                spacing={1}
                component="ul"
                sx={{ listStyle: 'none', p: 0, m: 0 }}
                aria-label="People"
              >
                {answer.people.map((person) => (
                  <PersonRow
                    key={person.personId}
                    person={person}
                    steps={sequence.steps}
                    supplied={supplied[person.personId]}
                    onSupply={(next) => supply(person.personId, next)}
                    emailPreview={emailPreview[person.personId]}
                    onPreviewEmail={() => void previewEmail(person)}
                    stepTest={stepTests[person.personId]}
                    onSendTest={() => void sendTest(person)}
                    onCurate={() => void curate(person)}
                    onWriteThemselves={() => writeThemselves(person)}
                    disabled={stage.kind === 'enrolling'}
                  />
                ))}
              </Stack>
              {waiting ? (
                <Typography variant="body2" color="text.secondary">
                  {`${waiting} ${waiting === 1 ? 'person still needs' : 'people still need'} a personal line or a confirmation, or a decision on a draft, and won't be enrolled until they have one.`}
                </Typography>
              ) : null}
            </Stack>
          ) : null}

          {stage.kind === 'done' ? (
            <DoneSummary results={stage.results} enrolled={stage.enrolled} />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {stage.kind === 'done' ? (
          <Button variant="contained" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            {stage.kind === 'preview' || stage.kind === 'enrolling' ? (
              <>
                <Button onClick={reset} disabled={stage.kind === 'enrolling'}>
                  Back
                </Button>
                <Button
                  variant="contained"
                  disabled={!ready.length || stage.kind === 'enrolling'}
                  onClick={() => void enroll()}
                >
                  {stage.kind === 'enrolling'
                    ? 'Enrolling…'
                    : `Enroll ${ready.length} ${ready.length === 1 ? 'person' : 'people'}`}
                </Button>
              </>
            ) : (
              <Button
                variant="contained"
                disabled={
                  stage.kind === 'previewing' ||
                  (tab === 'view' ? !viewId : tab === 'leads' ? !pickedLeads.size : !picked.size)
                }
                onClick={() =>
                  void preview(
                    tab === 'view'
                      ? { kind: 'view', viewId }
                      : tab === 'leads'
                        ? { kind: 'leads', leadIds: [...pickedLeads.keys()] }
                        : { kind: 'contacts', contactIds: [...picked.keys()] },
                  )
                }
              >
                Check people
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
OutreachEnrollDialog.displayName = 'OutreachEnrollDialog'

function summary(answer: OutreachEnrollPreviewResponse): string {
  const count = (status: OutreachEnrollPreviewStatus) =>
    answer.people.filter((person) => person.status === status).length
  // The people behind a security gateway (AGL-3326): a Barracuda, a
  // Proofpoint or a Mimecast refuses a sender for a whole company, and a
  // LinkedIn note first is the cheaper first touch there.
  const fronted = answer.people.filter(
    (person) => person.status !== 'blocked' && isOutreachGatewayFronted(person.gateway?.gateway),
  ).length
  return (
    `${count('eligible')} eligible · ${count('needs_confirmation')} need you · ${count('blocked')} blocked` +
    (fronted ? ` · ${fronted} gateway-fronted — LinkedIn-first?` : '')
  )
}

/** The Check-people chip for one person's mail gateway (AGL-3326), or nothing. */
function GatewayChip(props: { gateway: OutreachEnrollGateway | null; name: string }) {
  const chip = outreachGatewayChip(props.gateway)
  if (!chip) return null
  return (
    <Chip
      size="small"
      variant={chip.tone === 'neutral' ? 'outlined' : 'filled'}
      color={GATEWAY_TONE_COLORS[chip.tone]}
      label={chip.label}
      aria-label={`Mail gateway for ${props.name}: ${chip.label}`}
    />
  )
}

function PersonRow(props: {
  person: OutreachEnrollPreviewPerson
  steps: readonly OutreachSequenceStep[]
  supplied: Supplied | undefined
  onSupply(next: Partial<Supplied>): void
  emailPreview:
    | { status: 'loading' }
    | { status: 'ready'; answer: OutreachPreviewResponse }
    | { status: 'failed'; message: string }
    | undefined
  onPreviewEmail(): void
  stepTest: StepTest | undefined
  onSendTest(): void
  onCurate(): void
  onWriteThemselves(): void
  disabled: boolean
}) {
  const { person, supplied, disabled } = props
  const name = person.name || person.email || person.personId
  const line = supplied?.personalLine ?? ''
  const tooLong = line.trim().length > OUTREACH_PERSONAL_LINE_MAX
  const curation = supplied?.curation ?? { status: 'idle' }
  const drafts = Object.values(supplied?.drafts ?? {}).sort((a, b) => a.stepIndex - b.stepIndex)
  const usedCount = drafts.filter((draft) => draft.decision === 'use').length
  return (
    <Paper component="li" variant="outlined" sx={{ p: 1.5 }} aria-label={name}>
      <Stack spacing={1}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' } }}
        >
          <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="body2">{name}</Typography>
            {person.email && person.email !== name ? (
              <Typography variant="caption" color="text.secondary">
                {person.email}
              </Typography>
            ) : null}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {person.target === 'lead' ? (
              <Chip size="small" variant="outlined" label="Lead" />
            ) : null}
            {person.cold ? (
              <Chip size="small" variant="outlined" label="Cold" />
            ) : null}
            <GatewayChip gateway={person.gateway} name={name} />
            <Chip
              size="small"
              label={STATUS_LABELS[person.status]}
              color={STATUS_COLORS[person.status]}
            />
          </Stack>
        </Stack>
        {person.status === 'blocked' ? (
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
            {person.blocks.map((block) => (
              <Typography
                key={block.code}
                component="li"
                variant="body2"
                color="text.secondary"
              >
                {block.reason}
              </Typography>
            ))}
          </Stack>
        ) : (
          <Stack spacing={1}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={supplied?.include ?? true}
                  onChange={(event) =>
                    props.onSupply({ include: event.target.checked })
                  }
                  disabled={disabled}
                />
              }
              label="Enroll this person"
            />
            {supplied?.include === false && outreachGatewayRefusedThisWeek(person.gateway) ? (
              <Typography variant="caption" color="text.secondary">
                {`Left un-ticked: their mail gateway refused ${person.gateway?.blocked7 === 1 ? 'an email' : `${person.gateway?.blocked7} emails`} from this organization this week. Tick them to enroll anyway${person.gateway?.hold ? ' — the email will go, and it is your call' : ''}.`}
              </Typography>
            ) : null}
            {supplied?.include === false ? null : (
              <>
                <TextField
                  label={
                    person.requires.personalLine
                      ? 'Personal line'
                      : 'Personal line (optional)'
                  }
                  placeholder="One sentence on why you're writing to this person now."
                  value={line}
                  onChange={(event) =>
                    props.onSupply({ personalLine: event.target.value })
                  }
                  disabled={disabled}
                  required={person.requires.personalLine}
                  error={tooLong}
                  helperText={
                    tooLong
                      ? `Keep it to one sentence, under ${OUTREACH_PERSONAL_LINE_MAX} characters.`
                      : 'Goes where the emails say {{enrollment.personalLine}}.'
                  }
                  fullWidth
                  size="small"
                />
                {person.requires.attestations.length ? (
                  <FormGroup aria-label={`What you confirm about ${name}`}>
                    {person.requires.attestations.map((kind) => (
                      <FormControlLabel
                        key={kind}
                        control={
                          <Checkbox
                            checked={
                              supplied?.attestations.includes(kind) ?? false
                            }
                            onChange={(event) =>
                              props.onSupply({
                                attestations: event.target.checked
                                  ? [...(supplied?.attestations ?? []), kind]
                                  : (supplied?.attestations ?? []).filter(
                                      (entry) => entry !== kind,
                                    ),
                              })
                            }
                            disabled={disabled}
                          />
                        }
                        label={OUTREACH_ATTESTATION_LABELS[kind]}
                      />
                    ))}
                  </FormGroup>
                ) : null}
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                  <Button
                    size="small"
                    onClick={props.onPreviewEmail}
                    disabled={disabled}
                  >
                    Preview the first email
                  </Button>
                  <Button
                    size="small"
                    onClick={props.onSendTest}
                    disabled={disabled || props.stepTest?.status === 'sending'}
                  >
                    {props.stepTest?.status === 'sending' ? 'Sending…' : 'Send me this as a test'}
                  </Button>
                  <Button
                    size="small"
                    onClick={props.onCurate}
                    disabled={disabled || curation.status === 'drafting'}
                  >
                    {drafts.length ? 'Curate again' : 'Curate for this person'}
                  </Button>
                </Stack>
                {props.stepTest?.status === 'failed' ? (
                  <Alert severity="error">{props.stepTest.message}</Alert>
                ) : null}
                {props.stepTest?.status === 'sent' ? (
                  <Alert severity="success">
                    {`Sent to ${props.stepTest.answer.sentTo} as “${props.stepTest.answer.subject}”. ${name} was not enrolled.`}
                  </Alert>
                ) : null}
                {curation.status === 'drafting' ? (
                  <OutreachLoading label="Drafting their emails…" />
                ) : null}
                {curation.status === 'failed' ? (
                  <Stack spacing={1}>
                    <Alert severity="warning">{curation.message}</Alert>
                    <Stack direction="row">
                      <Button size="small" onClick={props.onWriteThemselves} disabled={disabled}>
                        Write them yourself
                      </Button>
                    </Stack>
                  </Stack>
                ) : null}
                {drafts.length ? (
                  <Stack spacing={1} aria-label={`Curated emails for ${name}`}>
                    <Typography variant="caption" color="text.secondary">
                      {usedCount
                        ? `${usedCount} of ${drafts.length} ${drafts.length === 1 ? 'email' : 'emails'} curated for ${name}. Nothing is sent that you haven't confirmed.`
                        : `Their emails, rewritten for them. Read each one, edit it, and use it or keep the template.`}
                    </Typography>
                    {drafts.map((draft) => (
                      <OutreachCuratedStepEditor
                        key={draft.stepIndex}
                        draft={draft}
                        label={outreachEmailStepLabel(props.steps, draft.stepIndex)}
                        onChange={(next) =>
                          props.onSupply({ drafts: { ...(supplied?.drafts ?? {}), [next.stepIndex]: next } })
                        }
                        disabled={disabled}
                      />
                    ))}
                  </Stack>
                ) : null}
                {props.emailPreview?.status === 'loading' ? (
                  <OutreachLoading label="Writing the email…" />
                ) : null}
                {props.emailPreview?.status === 'failed' ? (
                  <Alert severity="error">{props.emailPreview.message}</Alert>
                ) : null}
                {props.emailPreview?.status === 'ready' ? (
                  props.emailPreview.answer.error ? (
                    <Alert severity="info">
                      {props.emailPreview.answer.error.message}
                    </Alert>
                  ) : (
                    <Paper
                      variant="outlined"
                      sx={{ p: 1.5 }}
                      aria-label={`First email to ${name}`}
                    >
                      <Typography variant="body2">{`Subject: ${props.emailPreview.answer.subject}`}</Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          mt: 1,
                        }}
                      >
                        {props.emailPreview.answer.text}
                      </Typography>
                    </Paper>
                  )
                ) : null}
              </>
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}

function DoneSummary(props: {
  results: OutreachEnrollOutcome[]
  enrolled: number
}) {
  const refused = props.results.filter(
    (
      result,
    ): result is Extract<OutreachEnrollOutcome, { outcome: 'blocked' }> =>
      result.outcome === 'blocked',
  )
  return (
    <Stack spacing={1.5}>
      <Alert severity={props.enrolled ? 'success' : 'info'}>
        {props.enrolled
          ? `Enrolled ${props.enrolled} ${props.enrolled === 1 ? 'person' : 'people'}. Their first step goes out in the mailbox's sending hours.`
          : 'Nobody was enrolled.'}
      </Alert>
      {refused.length ? (
        <Stack spacing={1}>
          <Typography variant="subtitle2">
            Not enrolled, checked again just now:
          </Typography>
          {refused.map((result) => (
            <Stack key={result.personId} spacing={0.25}>
              <Typography variant="body2">
                {result.email ?? result.personId}
              </Typography>
              {result.blocks.map((block) => (
                <Typography
                  key={block.code}
                  variant="body2"
                  color="text.secondary"
                >
                  {block.reason}
                </Typography>
              ))}
            </Stack>
          ))}
        </Stack>
      ) : null}
    </Stack>
  )
}

export default OutreachEnrollDialog
