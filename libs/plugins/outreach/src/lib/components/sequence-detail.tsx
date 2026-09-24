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

import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import type { ConsolePluginOrgMount } from '@aglyn/aglyn'
import {
  mdiAccountMultiplePlusOutline,
  mdiChevronLeft,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { useState } from 'react'
import { validateOutreachOrgSettings } from '../engine/sequence-validation'
import type { OutreachSequenceAction } from '../model/outreach-api'
import {
  outreachMailboxActivationIssue,
  outreachSequenceMailboxState,
  type OutreachSequenceIssue,
  type OutreachSequenceMailboxState,
} from '../model/sequence-draft'
import { OutreachEnrollDialog } from './enroll-dialog'
import { OutreachEnrollmentsTable } from './enrollments-table'
import {
  OutreachLink,
  OutreachLoading,
  OutreachLoadProblem,
  OutreachSequenceStatusChip,
  useOutreachNavigate,
} from './outreach-ui'
import { OutreachSequenceEditor } from './sequence-editor'
import { OutreachSequenceReportCard } from './sequence-report-card'
import { OutreachRouteError, useOutreachApi } from './use-outreach-api'
import {
  useOutreachEnrollments,
  useOutreachSequence,
  useOutreachSequenceLinks,
} from './use-outreach-data'
import type { OutreachMailboxesResult } from './use-outreach-mailboxes'
import type { OutreachSettingsLoad } from './use-outreach-settings'

export type OutreachSequenceTab = 'steps' | 'enrollments'

export interface OutreachSequenceDetailProps {
  orgId: string
  orgMount?: ConsolePluginOrgMount
  /** The organization document the shell loaded: whose consent groups name a site's contacts. */
  org?: Record<string, unknown> | null
  /** Where the Sequences section lives: `/[orgSlug]/outreach/sequences`. */
  sectionPath: string
  sequenceId: string
  tab: OutreachSequenceTab
  settings: OutreachSettingsLoad
  mailboxes: OutreachMailboxesResult
  /** The Mailboxes section: where a mailbox is connected, resumed or reconnected. */
  mailboxesPath: string
  /** The Compliance section: where the footer's legal name and address are set. */
  compliancePath: string
}

/** Something activation would refuse, and where it is put right. */
export interface OutreachActivationBlocker {
  message: string
  href: string
  linkLabel: string
}

/**
 * What stops a sequence being activated, read before anyone clicks: its
 * mailbox not sending, and a footer the organization cannot write yet —
 * each in the words the status route refuses with. Only a finished read
 * says something is missing, so nothing is claimed while one is loading.
 */
export function outreachActivationBlockers(input: {
  sequence: { mailboxId: string }
  mailboxes: OutreachMailboxesResult
  settings: OutreachSettingsLoad
  paths: { steps: string; mailboxes: string; compliance: string }
}): OutreachActivationBlocker[] {
  const blockers: OutreachActivationBlocker[] = []
  if (input.mailboxes.status === 'ready') {
    const mailbox =
      input.mailboxes.mailboxes.find((entry) => entry.id === input.sequence.mailboxId) ?? null
    const issue = outreachMailboxActivationIssue(input.sequence.mailboxId, mailbox)
    if (issue) {
      blockers.push(
        issue.code === 'mailbox_not_sending'
          ? { message: issue.message, href: input.paths.mailboxes, linkLabel: 'Open Mailboxes' }
          : { message: issue.message, href: input.paths.steps, linkLabel: 'Choose a mailbox' },
      )
    }
  }
  if (input.settings.status === 'ready') {
    for (const issue of validateOutreachOrgSettings(input.settings.settings)) {
      blockers.push({ message: issue.message, href: input.paths.compliance, linkLabel: 'Open Compliance' })
    }
  }
  return blockers
}

/** What an active sequence's page says while its mailbox is not sending. */
const NOT_SENDING: Record<Exclude<OutreachSequenceMailboxState, 'sending'>, string> = {
  none: 'This sequence has no mailbox, so nothing is sent from it.',
  gone: 'This sequence’s mailbox is no longer connected, so nothing is sent from it.',
  paused: 'This sequence’s mailbox is paused, so nothing is sent until it is resumed.',
  reconnect_required:
    'Google stopped accepting this sequence’s mailbox, so nothing is sent until it is reconnected.',
}

/** The words an action's button and its snackbar use. */
const ACTIONS: Record<OutreachSequenceAction, { label: string; done: string }> =
  {
    activate: { label: 'Activate', done: 'Sequence activated.' },
    pause: { label: 'Pause', done: 'Sequence paused.' },
    archive: { label: 'Archive', done: 'Sequence archived.' },
  }

/**
 * One sequence (AGL-2980): its steps in the editor, the people enrolled in
 * it, and what can be done with it — activate, pause, archive, delete a
 * draft, and enroll people in an active one.
 */
export function OutreachSequenceDetail(props: OutreachSequenceDetailProps) {
  const { orgId, sequenceId, sectionPath } = props
  const api = useOutreachApi(orgId)
  const navigate = useOutreachNavigate()
  const { enqueueSnackbar } = useSnackbar()
  const { data: user } = useUser()
  const loaded = useOutreachSequence(orgId, sequenceId)
  const enrollments = useOutreachEnrollments(
    props.tab === 'enrollments' ? orgId : null,
    sequenceId,
  )
  // One document however large the sequence, and read on both tabs, because
  // the report card sits above them (AGL-3239).
  const links = useOutreachSequenceLinks(orgId, sequenceId)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<{
    message: string
    issues: OutreachSequenceIssue[]
  } | null>(null)
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(
    null,
  )
  const [enrolling, setEnrolling] = useState(false)

  const sequence = loaded.data
  const detailPath = `${sectionPath}/${sequenceId}`
  const back = (
    <OutreachLink href={sectionPath}>
      <Stack
        direction="row"
        spacing={0.5}
        component="span"
        sx={{ alignItems: 'center', display: 'inline-flex' }}
      >
        <MdiIcon path={mdiChevronLeft.path} fontSize="small" />
        <span>Sequences</span>
      </Stack>
    </OutreachLink>
  )

  if (loaded.status === 'loading')
    return <OutreachLoading label="Loading the sequence…" />
  if (loaded.status === 'error' || loaded.status === 'refused') {
    return <OutreachLoadProblem status={loaded.status} what="sequence" />
  }
  if (!sequence) {
    return (
      <Stack spacing={2}>
        {back}
        <Card variant="outlined">
          <EmptyStateComponent label="This sequence no longer exists" />
        </Card>
      </Stack>
    )
  }

  const mailbox =
    props.mailboxes.mailboxes.find((entry) => entry.id === sequence.mailboxId) ??
    null
  const mailboxState =
    props.mailboxes.status === 'ready'
      ? outreachSequenceMailboxState(sequence.mailboxId, mailbox)
      : 'sending'
  const activatable = sequence.status === 'draft' || sequence.status === 'paused'
  const blockers = activatable
    ? outreachActivationBlockers({
        sequence,
        mailboxes: props.mailboxes,
        settings: props.settings,
        paths: {
          steps: detailPath,
          mailboxes: props.mailboxesPath,
          compliance: props.compliancePath,
        },
      })
    : []
  // Enrolling onto a mailbox that is gone is refused by the route; a paused
  // one only makes the new people wait with everyone else.
  const canEnroll =
    sequence.status === 'active' &&
    mailboxState !== 'gone' &&
    mailboxState !== 'none'
  const act = async (action: OutreachSequenceAction) => {
    setBusy(true)
    setRefusal(null)
    try {
      const answer = await api.setSequenceStatus(sequence.id, action)
      enqueueSnackbar(
        action === 'archive' && answer.stoppedEnrollments
          ? `${ACTIONS.archive.done} ${answer.stoppedEnrollments} ${answer.stoppedEnrollments === 1 ? 'person was' : 'people were'} stopped.`
          : ACTIONS[action].done,
        { variant: 'success' },
      )
    } catch (error) {
      setRefusal({
        message: (error as Error).message,
        issues:
          error instanceof OutreachRouteError
            ? error.issues.filter(
                (issue): issue is OutreachSequenceIssue => 'path' in issue,
              )
            : [],
      })
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    setRefusal(null)
    try {
      await api.deleteSequence(sequence.id)
      enqueueSnackbar('Sequence deleted.', { variant: 'success' })
      navigate(sectionPath)
    } catch (error) {
      setRefusal({ message: (error as Error).message, issues: [] })
      setBusy(false)
    }
  }

  const enrollButton = (
    <Button
      variant="contained"
      startIcon={
        <MdiIcon path={mdiAccountMultiplePlusOutline.path} fontSize="small" />
      }
      disabled={!canEnroll}
      onClick={() => setEnrolling(true)}
    >
      Enroll people
    </Button>
  )

  return (
    <Stack spacing={2}>
      {back}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', minWidth: 0 }}
        >
          <Typography
            variant="h5"
            component="h2"
            sx={{ wordBreak: 'break-word' }}
          >
            {sequence.name}
          </Typography>
          <OutreachSequenceStatusChip status={sequence.status} />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {activatable ? (
            <Button
              variant="outlined"
              disabled={busy || blockers.length > 0}
              onClick={() => void act('activate')}
            >
              {ACTIONS.activate.label}
            </Button>
          ) : null}
          {sequence.status === 'active' ? (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => void act('pause')}
            >
              {ACTIONS.pause.label}
            </Button>
          ) : null}
          {sequence.status !== 'archived' ? (
            <Button
              variant="outlined"
              color="error"
              disabled={busy}
              onClick={() => setConfirming('archive')}
            >
              {ACTIONS.archive.label}
            </Button>
          ) : null}
          {sequence.status === 'draft' ? (
            <Button
              variant="text"
              color="error"
              disabled={busy}
              onClick={() => setConfirming('delete')}
            >
              Delete
            </Button>
          ) : null}
          {sequence.status === 'active' ? enrollButton : null}
        </Stack>
      </Stack>

      {refusal ? (
        <Alert severity="error" onClose={() => setRefusal(null)}>
          <Stack spacing={0.5}>
            <span>{refusal.message}</span>
            {refusal.issues.length > 1 ? (
              <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2.5 }}>
                {refusal.issues.slice(1).map((issue) => (
                  <li key={`${issue.path}:${issue.code}`}>{issue.message}</li>
                ))}
              </Stack>
            ) : null}
          </Stack>
        </Alert>
      ) : null}
      {blockers.length ? (
        <Alert severity="warning" data-testid="outreach-activation-blockers">
          <Stack spacing={0.5}>
            <span>
              {sequence.status === 'draft'
                ? 'A draft sends nothing, and this one can’t be activated yet:'
                : 'This sequence can’t be activated again yet:'}
            </span>
            <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2.5 }}>
              {blockers.map((blocker) => (
                <li key={blocker.message}>
                  {blocker.message}{' '}
                  <OutreachLink href={blocker.href}>{blocker.linkLabel}</OutreachLink>
                </li>
              ))}
            </Stack>
          </Stack>
        </Alert>
      ) : sequence.status === 'draft' ? (
        <Alert severity="info">
          A draft sends nothing. Activate it to enroll people.
        </Alert>
      ) : null}
      {sequence.status === 'active' && mailboxState !== 'sending' ? (
        <Alert severity="warning">
          {NOT_SENDING[mailboxState]}{' '}
          <OutreachLink href={props.mailboxesPath}>Open Mailboxes</OutreachLink>
        </Alert>
      ) : null}

      {/*
        * Above the tabs, not inside one (AGL-3239): what a sequence is doing
        * is the question a rep opens it with, and putting it behind a tab
        * makes the steps the first answer to "how is this going".
        *
        * A draft has sent nothing and measured nothing, so it gets no card
        * rather than a row of zeroes.
        */}
      {sequence.status === 'draft' ? null : (
        <OutreachSequenceReportCard
          sequence={sequence}
          links={links}
          timeZone={mailbox?.timezone ?? null}
        />
      )}

      <Tabs
        value={props.tab}
        onChange={(_event, next: OutreachSequenceTab) =>
          navigate(next === 'steps' ? detailPath : `${detailPath}/enrollments`)
        }
        aria-label="Sequence"
      >
        <Tab value="steps" label="Steps" />
        <Tab value="enrollments" label="Enrollments" />
      </Tabs>

      {props.tab === 'steps' ? (
        <OutreachSequenceEditor
          orgId={orgId}
          orgMount={props.orgMount}
          org={props.org}
          sequence={sequence}
          settings={props.settings}
          mailboxes={props.mailboxes}
          mailboxesPath={props.mailboxesPath}
          onSaved={() => undefined}
        />
      ) : (
        <OutreachEnrollmentsTable
          enrollments={enrollments}
          steps={sequence.steps}
          trackClicks={sequence.settings.trackClicks}
          timeZone={mailbox?.timezone ?? null}
          api={api}
          enrollAction={sequence.status === 'active' ? enrollButton : undefined}
        />
      )}

      <OutreachEnrollDialog
        open={enrolling}
        onClose={() => setEnrolling(false)}
        orgId={orgId}
        sequence={sequence}
        contactGroupId={
          sequence.hostId
            ? consentGroupForHost(props.org ?? null, sequence.hostId).groupId
            : ''
        }
        uid={user?.uid ?? null}
        api={api}
      />

      <Dialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {confirming === 'delete'
            ? 'Delete this draft?'
            : 'Archive this sequence?'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirming === 'delete'
              ? 'It is removed for good. Nobody was ever enrolled in it.'
              : 'Archiving is final. Everyone still in it is stopped, and it takes no one new.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              const chosen = confirming
              setConfirming(null)
              if (chosen === 'delete') void remove()
              else void act('archive')
            }}
          >
            {confirming === 'delete' ? 'Delete' : 'Archive'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
OutreachSequenceDetail.displayName = 'OutreachSequenceDetail'

export default OutreachSequenceDetail
