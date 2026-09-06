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

import * as Aglyn from '@aglyn/aglyn'
import type { CrmActivityKind, CrmActivityRow } from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser, useUserName } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material'
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getCountFromServer,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import type { ActivityRecordLink, ActivityScope } from './activity-queries'

/** The longest body a single activity stores — a call summary, not a document. */
const BODY_MAX = 4000
const OUTCOME_MAX = 200
const DURATION_MAX_MINUTES = 24 * 60

/**
 * Epoch millis as the value a `datetime-local` input holds, in the LOCAL
 * zone — the input has no zone of its own, so an ISO string with a `Z`
 * would land the call an offset away from when it happened.
 */
function toLocalInput(ms: number): string {
  if (!Number.isFinite(ms)) return ''
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** The inverse: a `datetime-local` value parsed as local time, or `null`. */
function fromLocalInput(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

interface Draft {
  kind: CrmActivityKind
  body: string
  /** The `datetime-local` string, not millis — what the input holds. */
  at: string
  outcome: string
  /** Free text until save, so a half-typed number does not snap to zero. */
  durationMinutes: string
}

const freshDraft = (): Draft => ({
  kind: 'call',
  body: '',
  at: toLocalInput(Date.now()),
  outcome: '',
  durationMinutes: '',
})

const draftFrom = (activity: CrmActivityRow): Draft => ({
  kind: Aglyn.isCrmActivityKind(activity.kind) ? activity.kind : 'other',
  body: activity.body ?? '',
  at: toLocalInput(activity.atMs),
  outcome: activity.outcome ?? '',
  durationMinutes:
    typeof activity.durationMinutes === 'number'
      ? String(activity.durationMinutes)
      : '',
})

export interface LogActivityDialogProps {
  open: boolean
  onClose: () => void
  /** Where the activity is written, from `useActivityScope`. */
  scope: ActivityScope
  /**
   * The record the activity is filed against, FIXED by the caller. A
   * contact's page logs against that contact; the dialog offers no picker,
   * because an activity logged from a record page is about that record and
   * a picker would be a way to file it somewhere the reader is not looking.
   */
  link: ActivityRecordLink
  /**
   * When set, the dialog EDITS this activity rather than logging a new one.
   * The link, the author and the scope stay what they were; only what was
   * said, when, and how it went can change.
   */
  activity?: CrmActivityRow | null
}

/**
 * Log a call, an email, a meeting, a note or something else against a
 * record (AGL-2600) — or correct one already logged.
 *
 * ## What is written
 *
 * A new activity carries the whole `CrmScoped` stamp: `visibleTo` from
 * `crmScopeTokens`, so it lands in exactly the scope a contact captured on
 * this site would; `hostId` as provenance; `byUid` and `byName` for the
 * author, the name denormalized because a colleague reading the log cannot
 * resolve a uid (see `CrmActivity.byName`); `atMs` for when it HAPPENED,
 * which the reader picks and which defaults to now; and the timestamps.
 *
 * An edit rewrites only the fields the dialog shows. `visibleTo` is never
 * touched — the rules refuse a scoped member changing it, and widening a
 * record is an act for an org-wide member on the record itself — and neither
 * is the author or the link. A kind that stops taking an outcome takes the
 * outcome and the duration off the document rather than leaving a stale
 * "left a voicemail" on what is now a note.
 *
 * ## Who may write
 *
 * The rules admit any member who may write scoped org data, on create and
 * on update alike; they do not distinguish the author. The card that opens
 * this dialog for an edit checks the author itself (`useCanEditActivity`),
 * so what reaches here has already passed the console's verdict.
 */
export function LogActivityDialog(props: LogActivityDialogProps) {
  const { open, onClose, scope, link, activity } = props
  const { firestore, dataScope, hostId, readTokens, writeTokens } = scope
  const { data: user } = useUser()
  const authorName = useUserName()
  const { enqueueSnackbar } = useSnackbar()
  const [draft, setDraft] = useState<Draft>(freshDraft)
  const [saving, setSaving] = useState(false)

  /*
   * Seeded on OPEN, not on mount: the dialog stays mounted between uses so
   * its state survives a close, and "log another call" must start from now
   * rather than from the last call's timestamp.
   */
  useEffect(() => {
    if (open) setDraft(activity ? draftFrom(activity) : freshDraft())
  }, [open, activity])

  const hasOutcome = Aglyn.activityKindHasOutcome(draft.kind)
  const atMs = fromLocalInput(draft.at)
  const body = draft.body.trim()
  const duration = draft.durationMinutes.trim()
    ? Number(draft.durationMinutes)
    : null
  const durationValid =
    duration === null ||
    (Number.isInteger(duration) &&
      duration >= 0 &&
      duration <= DURATION_MAX_MINUTES)
  const canSave =
    Boolean(dataScope) &&
    Boolean(user?.uid) &&
    body.length > 0 &&
    atMs !== null &&
    durationValid &&
    !saving

  const handleSave = useCallback(async () => {
    // Every guard the button reads, again — a callback can outlive the
    // render that disabled it.
    if (!dataScope || !user?.uid || !body || atMs === null || !durationValid) {
      return
    }
    setSaving(true)
    try {
      const said = {
        kind: draft.kind,
        body: body.slice(0, BODY_MAX),
        atMs,
      }
      const outcome = hasOutcome ? draft.outcome.trim().slice(0, OUTCOME_MAX) : ''
      const durationMinutes = hasOutcome && duration !== null ? duration : null
      if (activity) {
        await updateDoc(
          doc(
            firestore,
            dataScope[0],
            dataScope[1],
            Aglyn.CRM_COLLECTIONS.activities,
            activity.$id,
          ),
          {
            ...said,
            // Cleared rather than left: a call turned into a note must not
            // keep the call's outcome, and Firestore refuses `undefined`.
            outcome: outcome ? outcome : deleteField(),
            durationMinutes:
              durationMinutes !== null ? durationMinutes : deleteField(),
            updatedAt: new Date(),
          },
        )
        enqueueSnackbar('Activity updated', { variant: 'success', persist: false })
      } else {
        /*
         * THE PER-RECORD CEILING (AGL-2611): one aggregate on the record
         * this dialog is filing under, before the write — the same count
         * the automation step and the REST create take, on the same link.
         * Scoped to the tokens this viewer may list, as every activity
         * listener is, so the rules admit the aggregate for a scoped
         * member exactly as they admit the timeline.
         */
        const lead = Aglyn.crmActivityCeilingLink(link)
        if (lead) {
          const logged = (
            await getCountFromServer(
              query(
                collection(
                  firestore,
                  dataScope[0],
                  dataScope[1],
                  Aglyn.CRM_COLLECTIONS.activities,
                ),
                where('visibleTo', 'array-contains-any', readTokens),
                where(lead.field, '==', lead.id),
              ),
            )
          ).data().count
          if (!Aglyn.crmActivityLogHasRoom(logged)) {
            enqueueSnackbar(Aglyn.CRM_ACTIVITY_LOG_FULL_MESSAGE, {
              variant: 'warning',
              persist: false,
            })
            return
          }
        }
        await addDoc(
          collection(
            firestore,
            dataScope[0],
            dataScope[1],
            Aglyn.CRM_COLLECTIONS.activities,
          ),
          {
            ...said,
            ...(outcome ? { outcome } : {}),
            ...(durationMinutes !== null ? { durationMinutes } : {}),
            // Only the link the caller fixed. A key with no value is
            // `undefined`, which Firestore refuses, so each is spread in
            // rather than written blank.
            ...(link.contactId ? { contactId: link.contactId } : {}),
            ...(link.companyId ? { companyId: link.companyId } : {}),
            ...(link.dealId ? { dealId: link.dealId } : {}),
            ...(link.leadId ? { leadId: link.leadId } : {}),
            visibleTo: writeTokens,
            hostId,
            byUid: user.uid,
            // Absent rather than blank while the profile is still resolving:
            // the row reads a stored name over anything else, and an empty
            // string would be a name.
            ...(authorName ? { byName: authorName } : {}),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        )
        enqueueSnackbar('Activity logged', { variant: 'success', persist: false })
      }
      onClose()
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSaving(false)
    }
  }, [
    dataScope,
    user,
    body,
    atMs,
    durationValid,
    draft.kind,
    draft.outcome,
    hasOutcome,
    duration,
    activity,
    firestore,
    enqueueSnackbar,
    link,
    readTokens,
    writeTokens,
    hostId,
    authorName,
    onClose,
  ])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{activity ? 'Edit activity' : 'Log activity'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <TextField
            select
            size="small"
            label="Kind"
            value={draft.kind}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                kind: Aglyn.isCrmActivityKind(event.target.value)
                  ? event.target.value
                  : prev.kind,
              }))
            }
            sx={{ minWidth: 140 }}
          >
            {Aglyn.CRM_ACTIVITY_KINDS.map((kind) => (
              <MenuItem key={kind} value={kind}>
                {Aglyn.CRM_ACTIVITY_KIND_LABELS[kind]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="When"
            type="datetime-local"
            value={draft.at}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, at: event.target.value }))
            }
            error={draft.at.length > 0 && atMs === null}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ flex: 1 }}
          />
        </Stack>
        <TextField
          size="small"
          label="What happened"
          value={draft.body}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, body: event.target.value }))
          }
          multiline
          minRows={3}
          autoFocus
          slotProps={{ htmlInput: { maxLength: BODY_MAX } }}
        />
        {hasOutcome ? (
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label="Outcome"
              placeholder="Left a voicemail"
              value={draft.outcome}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, outcome: event.target.value }))
              }
              slotProps={{ htmlInput: { maxLength: OUTCOME_MAX } }}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label="Minutes"
              type="number"
              value={draft.durationMinutes}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  durationMinutes: event.target.value,
                }))
              }
              error={!durationValid}
              slotProps={{
                htmlInput: { min: 0, max: DURATION_MAX_MINUTES, step: 1 },
              }}
              sx={{ width: 120 }}
            />
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!canSave}
          onClick={handleSave}
        >
          {activity ? 'Save' : 'Log'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
LogActivityDialog.displayName = 'LogActivityDialog'

export default LogActivityDialog
