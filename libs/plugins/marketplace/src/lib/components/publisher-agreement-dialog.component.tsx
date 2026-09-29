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
  PUBLISHER_AGREEMENT_TITLE,
  PUBLISHER_AGREEMENT_VERSION,
  publisherAgreementChangesSince,
  publisherAgreementPresentation,
} from '@aglyn/aglyn/app-utils/publisher-agreement'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import type { PublisherAgreementRefusal } from '../model/publisher-agreement-refusal'
import {
  acceptPublisherAgreement,
  fetchPublisherAgreementAcceptors,
  type PublisherAgreementAcceptor,
} from './publisher-agreement-client'
import PublisherAgreementSummary from './publisher-agreement-summary.component'

export interface PublisherAgreementDialogProps {
  open: boolean
  /** The org the acceptance binds. */
  orgId: string
  /** Where the org stands: `none`, or `outdated` with the version it accepted. */
  standing: Pick<PublisherAgreementRefusal, 'state' | 'accepted'>
  /**
   * The verb of what accepting continues — "publish" — when the dialog was
   * opened by a refused action. Absent when it is offered before one.
   */
  continueWith?: string
  /** The acceptance is recorded; the caller continues. */
  onAccepted: () => void
  /** Closed without accepting. */
  onClose: () => void
}

/** Who may accept: still asking, answered, or not answerable from here. */
type Acceptors =
  | { status: 'loading' }
  | { status: 'answered'; people: PublisherAgreementAcceptor[] }
  | { status: 'unanswered' }

/**
 * The Marketplace Publisher Agreement, presented where an action needed it
 * (AGL-3407).
 *
 * A publish refused for the agreement used to answer with a sentence naming
 * the tab to go and find — Marketplace → Publisher Profile — which cost the
 * publisher the form they had filled and a trip through the console. This is
 * the same agreement, the same summary and the same acceptance as that card
 * (`PublisherAgreementSummary`, `acceptPublisherAgreement`), opened on top of
 * whatever they were doing, so accepting continues it.
 *
 * ── Only someone who can bind the org is offered the button ───────────────
 *
 * The accept route admits an owner or admin (`canActAsPublisher`), and the
 * dialog asks the roster for exactly those roles. Anyone else is told who
 * they are, because "you cannot" with no name is a dead end. When the roster
 * cannot answer, the button is offered and the route decides — its refusal is
 * shown here — since a client that guessed "no" would strand an admin.
 *
 * ── A changed agreement says what changed ─────────────────────────────────
 *
 * For an `outdated` acceptance it lists the edits since the version the org
 * accepted, from `PUBLISHER_AGREEMENT_CHANGES`, so re-accepting means reading
 * two clauses rather than rereading the document to find them.
 */
export function PublisherAgreementDialog(props: PublisherAgreementDialogProps) {
  const { open, orgId, standing, continueWith, onAccepted, onClose } = props
  const { data: user } = useUser()
  const [acceptors, setAcceptors] = useState<Acceptors>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  const presentation = publisherAgreementPresentation(standing.state)
  const changes = publisherAgreementChangesSince(standing.accepted)

  useEffect(() => {
    if (!open || !orgId) return undefined
    let active = true
    setProblem('')
    setAcceptors({ status: 'loading' })
    void fetchPublisherAgreementAcceptors(user, orgId).then((people) => {
      if (!active) return
      setAcceptors(
        people ? { status: 'answered', people } : { status: 'unanswered' },
      )
    })
    return () => {
      active = false
    }
    // The roster is asked once per opening; a refreshed user token is the
    // same person and not a reason to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orgId])

  const uid = (user as { uid?: string } | null | undefined)?.uid ?? ''
  const mayAccept =
    acceptors.status === 'unanswered' ||
    (acceptors.status === 'answered' &&
      acceptors.people.some((person) => person.uid === uid))
  const offerAccept = presentation.canAccept && acceptors.status !== 'loading' && mayAccept

  const handleAccept = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setProblem('')
    try {
      const refused = await acceptPublisherAgreement(user, orgId)
      if (refused) return void setProblem(refused)
      onAccepted()
    } catch (error) {
      console.error(error)
      setProblem('Could not record the acceptance. Try again.')
    } finally {
      setBusy(false)
    }
  }, [busy, user, orgId, onAccepted])

  const acceptLabel = busy
    ? 'Recording…'
    : continueWith
      ? `Accept and ${continueWith}`
      : standing.state === 'outdated'
        ? 'Accept the current version'
        : 'Accept on behalf of this organization'

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="publisher-agreement-dialog-title"
    >
      <DialogTitle id="publisher-agreement-dialog-title">
        {PUBLISHER_AGREEMENT_TITLE}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {/* An unpublished document replaces the state copy (AGL-1660):
              "you have not accepted" reads as the publisher's omission, and
              while there is no page to read, the omission is ours. */}
          {presentation.unavailableNotice ? (
            <Alert severity="warning">{presentation.unavailableNotice}</Alert>
          ) : (
            <Alert severity={standing.state === 'outdated' ? 'warning' : 'info'}>
              {standing.state === 'outdated'
                ? 'These terms have changed since your organization accepted ' +
                  `version ${standing.accepted ?? 'an earlier version'}. ` +
                  (continueWith
                    ? `The current version must be accepted to ${continueWith}.`
                    : 'Publishing is paused until the current version is accepted.')
                : 'Your organization has not accepted these terms. ' +
                  (continueWith
                    ? `They must be accepted to ${continueWith}.`
                    : 'They must be accepted before anything is published.')}
            </Alert>
          )}
          {changes.length ? (
            <Stack spacing={1}>
              <Typography variant="subtitle2">
                {`What changed since version ${standing.accepted}`}
              </Typography>
              {changes.map((entry) => (
                <Stack key={entry.version} spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    {`Version ${entry.version}`}
                  </Typography>
                  <Stack
                    component="ul"
                    spacing={0.5}
                    sx={{ m: 0, pl: 2.5 }}
                  >
                    {entry.changes.map((change) => (
                      <Typography key={change} component="li" variant="body2">
                        {change}
                      </Typography>
                    ))}
                  </Stack>
                </Stack>
              ))}
            </Stack>
          ) : null}
          <PublisherAgreementSummary documentUrl={presentation.documentUrl} />
          {presentation.canAccept && acceptors.status !== 'loading' ? (
            mayAccept ? (
              <Typography variant="caption" color="text.secondary">
                {`Accepting version ${PUBLISHER_AGREEMENT_VERSION} binds the ` +
                  'organization, not you personally, and we record who ' +
                  'accepted and when.'}
              </Typography>
            ) : (
              <Alert severity="info">
                <Typography variant="body2">
                  {'Only an owner or admin of your organization can accept ' +
                    'on its behalf.'}
                </Typography>
                {acceptors.status === 'answered' && acceptors.people.length ? (
                  <Typography variant="body2" component="div" sx={{ mt: 0.5 }}>
                    {'Ask '}
                    {acceptors.people
                      .map((person) =>
                        person.email && person.email !== person.label
                          ? `${person.label} (${person.email})`
                          : person.label,
                      )
                      .join(', ')}
                    {' to accept it, then try again.'}
                  </Typography>
                ) : null}
              </Alert>
            )
          ) : null}
          {problem ? <Alert severity="error">{problem}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={busy}>
          {offerAccept ? 'Cancel' : 'Close'}
        </Button>
        {offerAccept ? (
          <Button
            size="small"
            variant="contained"
            color="primary"
            disabled={busy}
            onClick={() => void handleAccept()}
          >
            {acceptLabel}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}

PublisherAgreementDialog.displayName = 'PublisherAgreementDialog'

export default PublisherAgreementDialog
