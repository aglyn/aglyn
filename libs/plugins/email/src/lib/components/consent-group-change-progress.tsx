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

import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreDoc,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
  Button,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { doc } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CONSENT_GROUP_CHANGES_COLLECTION,
  CONSENT_GROUP_SWEEP_DELAY_MS,
  postConsentGroups,
  readConsentGroupChangeJob,
  type ConsentGroupChangeMarker,
  type ConsentGroupChangePhase,
  type ConsentGroupsProgressResponse,
} from './consent-groups-api'

/**
 * The least time between two `continue` calls from one page. A call that
 * returns at once — the job is waiting on its sweep, or another runner holds
 * it — must not become a loop that asks again the instant it is answered.
 */
export const CONSENT_GROUP_CONTINUE_GAP_MS = 3_000

/** What each phase is called while it runs, and what it means for the reader. */
export const CONSENT_GROUP_PHASE_TEXT: Readonly<
  Record<ConsentGroupChangePhase, { title: string; body: string }>
> = {
  carry: {
    title: 'Copying opt-outs — nothing has changed yet',
    body:
      'Opt-outs are being copied onto every site that will stop sharing them, ' +
      'so nobody who opted out can be emailed after the change. Until this ' +
      'finishes, your consent groups work exactly as they did.',
  },
  rehome: {
    title: 'In effect — combining CRM records',
    body:
      'Every send already follows your new consent groups. The CRM records ' +
      'these sites keep are being combined or copied, so some may show under ' +
      'their old group for a little while.',
  },
  sweep: {
    title: 'Finishing up',
    body:
      'A last pass for anything written while the change ran. You can make ' +
      'another change once this finishes.',
  },
}

export interface ConsentGroupChangeProgressProps {
  orgId: string
  changeId: string
  /** The org's marker for this change, when the org document carries it yet. */
  marker: ConsentGroupChangeMarker | null
  /**
   * The reader may drive and stop the change. Anyone else sees where it is,
   * and opens no read of the job for it.
   */
  canDrive: boolean
  /** The change finished, or was stopped before it took effect. */
  onFinished: (outcome: 'done' | 'canceled') => void
}

/**
 * A consent group change while it runs (AGL-3320).
 *
 * ## It finishes on its own; an open page only makes it faster
 *
 * The route works in slices of under a minute and a cron resumes it every
 * quarter hour, so closing the page never strands a change. While this is
 * mounted for somebody who may drive it, it asks for the next slice as soon
 * as nobody else holds the job — the job document's lease says when — so a
 * change the admin is watching finishes in minutes rather than quarter hours.
 *
 * ## Only the first phase can be stopped
 *
 * Before the flip nothing an admin would notice has changed: refusals were
 * copied, which never lets anybody be mailed who could not be before, and
 * the old declaration still holds. So **Stop before it takes effect** is
 * offered exactly then. After the flip the new declaration is what every
 * send reads, and stopping would leave the CRM's records half moved.
 *
 * ## A stall is shown, not hidden
 *
 * After five failures in a row the job stops retrying itself on every call
 * and records why. The banner shows that reason and **Retry now**; the cron
 * keeps trying either way.
 */
export function ConsentGroupChangeProgress(props: ConsentGroupChangeProgressProps) {
  const { orgId, changeId, marker, canDrive, onFinished } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  const jobRead = useFirestoreDoc<Record<string, unknown>>(
    () =>
      canDrive && orgId && changeId
        ? doc(firestore, 'orgs', orgId, CONSENT_GROUP_CHANGES_COLLECTION, changeId)
        : null,
    [firestore, orgId, changeId, canDrive],
  )
  const job = readConsentGroupChangeJob(
    jobRead.status === 'success' ? jobRead.data : undefined,
  )

  const [answer, setAnswer] = useState<ConsentGroupsProgressResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  /** A refusal that stops this page driving until somebody retries. */
  const [halted, setHalted] = useState<string | null>(null)
  /** Re-arms the driver after each answer. */
  const [tick, setTick] = useState(0)
  const lastCallAt = useRef(0)
  const finished = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const markerPhase =
    marker && marker.changeId === changeId ? marker.phase : null
  const answerPhase =
    answer && ['carry', 'rehome', 'sweep'].includes(String(answer.phase))
      ? (answer.phase as ConsentGroupChangePhase)
      : null
  const jobPhase = ['carry', 'rehome', 'sweep'].includes(String(job.phase))
    ? (job.phase as ConsentGroupChangePhase)
    : null
  const phase: ConsentGroupChangePhase =
    markerPhase ?? answerPhase ?? jobPhase ?? 'carry'
  const stalled = job.stalled || answer?.progress?.stalled === true
  const lastError = job.lastError ?? answer?.progress?.lastError ?? null

  const finish = useCallback(
    (outcome: 'done' | 'canceled') => {
      if (finished.current) return
      finished.current = true
      onFinished(outcome)
    },
    [onFinished],
  )

  // The job can finish without this page: the cron, or another tab.
  useEffect(() => {
    if (job.finished) finish(job.phase === 'canceled' ? 'canceled' : 'done')
  }, [job.finished, job.phase, finish])

  const drive = useCallback(async () => {
    if (!user || finished.current) return
    lastCallAt.current = Date.now()
    setBusy(true)
    const result = await postConsentGroups<ConsentGroupsProgressResponse>(user, {
      orgId,
      action: 'continue',
      changeId,
    })
    if (!mounted.current) return
    setBusy(false)
    if (result.ok) {
      setAnswer(result.body)
      if (result.body.done === true) return void finish('done')
      setTick((value) => value + 1)
      return
    }
    setHalted(result.failure.message)
  }, [user, orgId, changeId, finish])

  /*
   * The driver. It waits out the least gap between calls, any lease another
   * runner holds, and the delay before the sweep may run — then asks once.
   * Each answer re-arms it through `tick`; a lease renewed under it re-arms
   * it through the job document.
   */
  useEffect(() => {
    if (!canDrive || !user || finished.current) return
    if (busy || stopping || stalled || halted) return
    if (jobRead.status === 'loading') return
    const now = Date.now()
    let at = Math.max(now, lastCallAt.current + CONSENT_GROUP_CONTINUE_GAP_MS)
    if (job.leaseUntilMs != null && job.leaseUntilMs > now) {
      at = Math.max(at, job.leaseUntilMs + 1_000)
    }
    if (phase === 'sweep' && marker?.declaredAtMs) {
      at = Math.max(at, marker.declaredAtMs + CONSENT_GROUP_SWEEP_DELAY_MS)
    }
    const timer = setTimeout(() => void drive(), at - now)
    return () => clearTimeout(timer)
  }, [
    canDrive,
    user,
    busy,
    stopping,
    stalled,
    halted,
    jobRead.status,
    job.leaseUntilMs,
    phase,
    marker?.declaredAtMs,
    drive,
    tick,
  ])

  const retry = () => {
    setHalted(null)
    lastCallAt.current = 0
    void drive()
  }

  const stop = async () => {
    if (!user || stopping) return
    const accepted = await confirm({
      title: 'Stop this change?',
      description:
        'Nothing has taken effect yet, so your consent groups stay exactly as ' +
        'they are. Opt-outs already copied stay in place — a copied opt-out ' +
        'never lets anyone be emailed who couldn’t be before.',
      confirmationText: 'Stop the change',
      cancellationText: 'Keep going',
    })
      // `confirm` resolves with no value and REJECTS on cancel (AGL-950).
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setStopping(true)
    const result = await postConsentGroups(user, {
      orgId,
      action: 'cancel',
      changeId,
    })
    if (!mounted.current) return
    setStopping(false)
    if (result.ok) {
      enqueueSnackbar('Stopped. Your consent groups are unchanged.', {
        variant: 'success',
        persist: false,
      })
      return void finish('canceled')
    }
    enqueueSnackbar(result.failure.message, {
      variant: result.failure.kind === 'took-effect' ? 'info' : 'error',
      allowDuplicate: true,
    })
  }

  const text = CONSENT_GROUP_PHASE_TEXT[phase]
  return (
    <Alert
      severity={stalled || halted ? 'error' : 'info'}
      data-testid="consent-group-change-progress"
      sx={{ '& .MuiAlert-message': { width: '100%' } }}
    >
      <AlertTitle>{text.title}</AlertTitle>
      <Stack spacing={1}>
        <Typography variant="body2">{text.body}</Typography>
        {stalled ? (
          <Typography variant="body2">
            {`This change stopped after repeated errors${
              lastError ? `: ${lastError}` : '.'
            } It keeps trying on its own every 15 minutes, or you can retry now.`}
          </Typography>
        ) : null}
        {halted ? <Typography variant="body2">{halted}</Typography> : null}
        {!canDrive ? (
          <Typography variant="body2" color="text.secondary">
            {'It finishes on its own. Only members who can change consent groups can stop it.'}
          </Typography>
        ) : null}
        {!stalled && !halted ? (
          <LinearProgress aria-label="Consent group change in progress" />
        ) : null}
        {canDrive && (stalled || halted || phase === 'carry') ? (
          <Stack direction="row" spacing={1}>
            {stalled || halted ? (
              <Button size="small" variant="contained" onClick={retry} disabled={busy}>
                {'Retry now'}
              </Button>
            ) : null}
            {phase === 'carry' ? (
              <Button
                size="small"
                color="inherit"
                onClick={() => void stop()}
                disabled={stopping}
              >
                {'Stop before it takes effect'}
              </Button>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Alert>
  )
}
ConsentGroupChangeProgress.displayName = 'ConsentGroupChangeProgress'

export default ConsentGroupChangeProgress
