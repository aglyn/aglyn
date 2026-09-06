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
import {
  mdiAccountGroupOutline,
  mdiDeleteOutline,
  mdiDotsHorizontalCircleOutline,
  mdiEmailOutline,
  mdiNoteTextOutline,
  mdiPencilOutline,
  mdiPhoneOutline,
} from '@aglyn/shared-data-mdi'
import { MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser, useUserName } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { deleteDoc, doc } from 'firebase/firestore'
import { type ReactNode, useCallback } from 'react'
import { type ActivityScope, useCanEditActivity } from './activity-queries'

/**
 * One glyph per kind. Typed against the union so a kind added to the list
 * cannot render with no icon — `MdiIcon` would fall back to its default
 * glyph silently, and a log where every note looks like a placeholder is
 * worse than a build error.
 */
const KIND_ICONS: Record<CrmActivityKind, { path: string }> = {
  call: mdiPhoneOutline,
  email: mdiEmailOutline,
  meeting: mdiAccountGroupOutline,
  note: mdiNoteTextOutline,
  other: mdiDotsHorizontalCircleOutline,
}

/** The icon for a kind — a stored kind outside the union draws as `other`. */
export function ActivityKindIcon(props: { kind: string; size?: number }) {
  const { kind, size = 1 } = props
  const icon = Aglyn.isCrmActivityKind(kind) ? KIND_ICONS[kind] : KIND_ICONS.other
  return <MdiIcon path={icon.path} size={size} />
}
ActivityKindIcon.displayName = 'ActivityKindIcon'

/**
 * The author's name for a row (AGL-2600).
 *
 * The denormalized `byName` leads: it is the only name a scoped colleague
 * can read, since a member document is readable by its subject and by
 * org-wide members alone. The signed-in user's OWN rows fall back to their
 * live name — the one case where a lookup is possible — and a row that
 * carries neither (written by a door that did not stamp one) reads as a
 * team member rather than as a uid.
 */
export function useActivityAuthorName(): (
  activity: Pick<CrmActivityRow, 'byUid' | 'byName'>,
) => string {
  const { data: user } = useUser()
  const ownName = useUserName()
  const uid = user?.uid
  return useCallback(
    (activity) => {
      if (activity.byName) return activity.byName
      if (uid && activity.byUid === uid && ownName) return ownName
      return 'A team member'
    },
    [uid, ownName],
  )
}

/** "45 min" or "2 h 05 min" — a duration a manager reads at a glance. */
function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${String(rest).padStart(2, '0')} min` : `${hours} h`
}

export interface ActivityRowProps {
  activity: CrmActivityRow
  /** Where the delete is written, from `useActivityScope`. */
  scope: ActivityScope
  /** Opens the dialog on this activity. Absent, the row offers no edit. */
  onEdit?: (activity: CrmActivityRow) => void
  /**
   * What sits after the kind, before the body — a feed puts the record the
   * activity is about here, a record page needs nothing.
   */
  subject?: ReactNode
  /** The clock the relative time is read against; `Date.now()` when absent. */
  nowMs?: number
  /**
   * Whether THIS reader may edit and delete the row — the author, or an
   * org-wide member. Decided by whoever draws the rows, through
   * `useCanEditActivity`, once for the whole list: a row that asked for
   * itself would read the member document once per row.
   */
  editable?: boolean
}

/**
 * One logged activity: the kind's icon and label, what was said, how it
 * went, who logged it and how long ago — with edit and delete for whoever
 * may (AGL-2600).
 *
 * Edit and delete appear only when `editable` says this reader may — the
 * author or an org-wide member. That is the console's verdict and not the
 * rules' — see `useCanEditActivity` for why the rules admit more — so the
 * controls are hidden rather than disabled: a disabled button asks "why
 * not?", and the honest answer would be "you could, through the API".
 */
export function ActivityRow(props: ActivityRowProps) {
  const { activity, scope, onEdit, subject, nowMs, editable } = props
  const { firestore, dataScope } = scope
  const authorName = useActivityAuthorName()
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()

  const handleDelete = useCallback(async () => {
    if (!dataScope) return
    const confirmed = await confirm({
      title: 'Delete this activity?',
      description:
        `This ${Aglyn.CRM_ACTIVITY_KIND_LABELS[
          Aglyn.isCrmActivityKind(activity.kind) ? activity.kind : 'other'
        ].toLowerCase()} is removed from the record it was logged against. ` +
        'Nothing the platform captured — a form, an order, a booking — is ' +
        'affected.',
      confirmationText: 'Delete activity',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    try {
      await deleteDoc(
        doc(
          firestore,
          dataScope[0],
          dataScope[1],
          Aglyn.CRM_COLLECTIONS.activities,
          activity.$id,
        ),
      )
      enqueueSnackbar('Activity deleted', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [dataScope, confirm, activity, firestore, enqueueSnackbar])

  const label =
    Aglyn.CRM_ACTIVITY_KIND_LABELS[
      Aglyn.isCrmActivityKind(activity.kind) ? activity.kind : 'other'
    ]
  /*
   * A message the platform SENT (AGL-2615) carries a subject, an address
   * and a delivery state the webhook advances; the state is the chip beside
   * the kind, red once the message did not land. What was sent is a record
   * of a fact and offers no edit — a rewritten body would misstate what
   * left — though whoever may delete a row may still delete this one.
   */
  const sent = activity.direction === 'outbound'
  const deliveryState = Aglyn.isCrmEmailDeliveryState(activity.deliveryState)
    ? activity.deliveryState
    : null
  const when = new Date(activity.atMs)
  const detail = [
    activity.outcome ? activity.outcome : null,
    typeof activity.durationMinutes === 'number' && activity.durationMinutes > 0
      ? durationLabel(activity.durationMinutes)
      : null,
  ].filter(Boolean)

  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      <Stack
        sx={{
          color: 'text.secondary',
          pt: 0.25,
          fontSize: (theme) => theme.typography.h6.fontSize,
        }}
      >
        <ActivityKindIcon kind={activity.kind} />
      </Stack>
      <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
        >
          <Chip label={label} size="small" />
          {deliveryState ? (
            <Tooltip
              title={
                typeof activity.deliveryAtMs === 'number'
                  ? new Date(activity.deliveryAtMs).toLocaleString()
                  : ''
              }
            >
              <Chip
                label={Aglyn.CRM_EMAIL_DELIVERY_STATE_LABELS[deliveryState]}
                size="small"
                variant="outlined"
                color={Aglyn.isCrmEmailDeliveryFailure(deliveryState) ? 'error' : 'default'}
                data-testid="activity-delivery-state"
              />
            </Tooltip>
          ) : null}
          {subject}
          {detail.length ? (
            <Typography variant="caption" color="text.secondary">
              {detail.join(' · ')}
            </Typography>
          ) : null}
        </Stack>
        {activity.subject ? (
          <Typography variant="subtitle2">{activity.subject}</Typography>
        ) : null}
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {activity.body}
        </Typography>
        <Tooltip title={when.toLocaleString()}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ alignSelf: 'flex-start' }}
          >
            {[
              authorName(activity),
              sent && activity.to ? `to ${activity.to}` : null,
              Aglyn.activityTimeLabel(activity.atMs, nowMs ?? Date.now()),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Tooltip>
      </Stack>
      {editable ? (
        <Stack direction="row" spacing={0.5}>
          {onEdit && !sent ? (
            <IconButton
              size="small"
              aria-label="Edit activity"
              onClick={() => onEdit(activity)}
            >
              <MdiIcon path={mdiPencilOutline.path} size={0.8} />
            </IconButton>
          ) : null}
          <IconButton
            size="small"
            aria-label="Delete activity"
            onClick={handleDelete}
          >
            <MdiIcon path={mdiDeleteOutline.path} size={0.8} />
          </IconButton>
        </Stack>
      ) : null}
    </Stack>
  )
}
ActivityRow.displayName = 'ActivityRow'

export interface ActivityListProps {
  /** Newest-first, as the listener hands them back. */
  rows: readonly CrmActivityRow[]
  scope: ActivityScope
  onEdit?: (activity: CrmActivityRow) => void
  /** What the list says when there is nothing in it. */
  emptyText?: string
  /** The way out of an empty list — the record's "Log activity" button. */
  emptyAction?: ReactNode
  /** A further page exists; `onShowMore` widens the window. */
  hasMore?: boolean
  onShowMore?: () => void
  /** The record each row is about, for a list that spans records. */
  subjectFor?: (activity: CrmActivityRow) => ReactNode
  /**
   * No controls on any row, whoever is reading — and no member read to
   * decide them. A feed that spans records is a place to see what happened,
   * not to rewrite it; the record's own page is where an activity is
   * corrected, beside everything else about it.
   */
  readOnly?: boolean
}

/**
 * A newest-first list of logged activities with a "show more" foot
 * (AGL-2600).
 *
 * The rows arrive ordered — the query is `orderBy('atMs', 'desc')` — and the
 * list does not sort them again; a second sort here is a second place for
 * the order to be defined. The foot appears only while the probe row says
 * more exists, so it never leads nowhere.
 *
 * Who may edit is decided here, once, and handed to every row: the verdict
 * reads the member document, and the list is the one place that can ask
 * for it a single time however many rows it draws.
 */
export function ActivityList(props: ActivityListProps) {
  const {
    rows,
    scope,
    onEdit,
    emptyText = 'Nothing logged yet.',
    emptyAction,
    hasMore,
    onShowMore,
    subjectFor,
    readOnly,
  } = props
  const canEdit = useCanEditActivity(scope.orgId, !readOnly)
  if (!rows.length) {
    return (
      <EmptyStateComponent
        compact
        label={'Nothing logged yet'}
        description={emptyText}
        action={emptyAction}
      />
    )
  }
  return (
    <Stack spacing={2}>
      {rows.map((activity) => (
        <ActivityRow
          key={activity.$id}
          activity={activity}
          scope={scope}
          onEdit={onEdit}
          subject={subjectFor?.(activity)}
          editable={canEdit(activity)}
        />
      ))}
      {hasMore && onShowMore ? (
        <Button size="small" onClick={onShowMore} sx={{ alignSelf: 'flex-start' }}>
          {'Show more'}
        </Button>
      ) : null}
    </Stack>
  )
}
ActivityList.displayName = 'ActivityList'

export default ActivityList
