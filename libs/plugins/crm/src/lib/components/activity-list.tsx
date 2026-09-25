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
  mdiEmailReceiveOutline,
  mdiNoteTextOutline,
  mdiPencilOutline,
  mdiPhoneOutline,
} from '@aglyn/shared-data-mdi'
import { MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser, useUserName } from '@aglyn/tenant-feature-instance'
import { Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { deleteDoc, doc } from 'firebase/firestore'
import { type ReactNode, useCallback, useState } from 'react'
import { type ActivityScope, useCanEditActivity } from './activity-queries'
import {
  TimelineEntry,
  type TimelineExpansion,
  useTimelineExpansion,
  useTimelinePages,
} from './activity-timeline'

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

/**
 * How long a note's own words may run on a collapsed row before it opens to
 * the rest; a single line under this reads whole, with nothing to open.
 */
const ACTIVITY_HEADING_MAX = 80

/**
 * What a collapsed activity reads as, and whether opening it shows more.
 *
 * A subject is the heading and the body is what the row opens to. With no
 * subject the body's first line is the heading, and a body that runs past
 * that line, or past what one line holds, opens to the whole text.
 */
export function activityHeading(activity: Pick<CrmActivityRow, 'subject' | 'body'>): {
  heading: string
  opens: boolean
} {
  const body = typeof activity.body === 'string' ? activity.body.trim() : ''
  const subject = typeof activity.subject === 'string' ? activity.subject.trim() : ''
  if (subject) return { heading: subject, opens: body !== '' }
  const firstLine = body.split('\n').find((line) => line.trim() !== '')?.trim() ?? ''
  return {
    heading: firstLine,
    opens: body !== firstLine || firstLine.length > ACTIVITY_HEADING_MAX,
  }
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
  /**
   * Whether the row is open to its body. The list holds it so the card's
   * "Expand all" reaches every row; a row drawn alone holds its own.
   */
  expanded?: boolean
  onToggle?: () => void
}

/**
 * One logged activity: the kind's icon and label, what was said, how it
 * went, who logged it and how long ago — with edit and delete for whoever
 * may (AGL-2600).
 *
 * Collapsed, the row is its chips, its heading and its caption: the kind,
 * the direction and delivery state, how a call went, the subject or the
 * note's first line, and who, to or from whom, and when. Opened, it shows
 * the body — an email's whole text, a note's every line.
 *
 * Edit and delete appear only when `editable` says this reader may — the
 * author or an org-wide member. That is the console's verdict and not the
 * rules' — see `useCanEditActivity` for why the rules admit more — so the
 * controls are hidden rather than disabled: a disabled button asks "why
 * not?", and the honest answer would be "you could, through the API".
 */
export function ActivityRow(props: ActivityRowProps) {
  const { activity, scope, onEdit, subject, nowMs, editable } = props
  const [ownExpanded, setOwnExpanded] = useState(false)
  const expanded = props.expanded ?? ownExpanded
  const onToggle = props.onToggle ?? (() => setOwnExpanded((open) => !open))
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
  /*
   * A message CAPTURED from a mailbox (AGL-2657) carries the provider's
   * Message-ID and, when a correspondent wrote it, the `inbound` direction.
   * It is drawn as its own thing — "Received" beside the kind, the sender
   * where a sent row shows the recipient, no author because nobody on the
   * team logged it — and a member's copied send reads "Sent" without a
   * delivery chip, since the platform did not carry it. Neither takes the
   * caller's "Logged" chip: nobody logged them.
   */
  const received = activity.direction === 'inbound'
  const captured = typeof activity.messageId === 'string' && activity.messageId !== ''
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

  const { heading, opens } = activityHeading(activity)
  const hasSubject = typeof activity.subject === 'string' && activity.subject.trim() !== ''

  return (
    <TimelineEntry
      icon={
        received ? (
          <MdiIcon path={mdiEmailReceiveOutline.path} />
        ) : (
          <ActivityKindIcon kind={activity.kind} />
        )
      }
      label={heading || label.toLowerCase()}
      expanded={expanded}
      onToggle={onToggle}
      chips={
        <>
          <Chip label={label} size="small" />
          {received ? (
            <Chip
              label="Received"
              size="small"
              variant="outlined"
              color="info"
              data-testid="activity-direction"
            />
          ) : captured ? (
            <Chip
              label="Sent"
              size="small"
              variant="outlined"
              data-testid="activity-direction"
            />
          ) : null}
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
          {captured ? null : subject}
          {detail.length ? (
            <Typography variant="caption" color="text.secondary">
              {detail.join(' · ')}
            </Typography>
          ) : null}
        </>
      }
      // With no subject the heading IS the body's first line, so an open
      // row shows the body alone rather than its first line twice.
      title={hasSubject || !opens || !expanded ? heading : null}
      titleVariant={hasSubject ? 'subtitle2' : 'body2'}
      meta={
        <Tooltip title={when.toLocaleString()}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ alignSelf: 'flex-start' }}
          >
            {[
              received ? null : authorName(activity),
              received && activity.from ? `from ${activity.from}` : null,
              sent && activity.to ? `to ${activity.to}` : null,
              Aglyn.activityTimeLabel(activity.atMs, nowMs ?? Date.now()),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Tooltip>
      }
      body={
        opens ? (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {activity.body}
          </Typography>
        ) : undefined
      }
      actions={
        editable ? (
          <>
            {onEdit && !sent && !received ? (
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
          </>
        ) : null
      }
    />
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
  /** The listener holds less than exists; `onShowMore` widens it. */
  hasMore?: boolean
  onShowMore?: () => void
  /** The listener is reading, so an empty window is not yet an empty log. */
  loading?: boolean
  /** The record each row is about, for a list that spans records. */
  subjectFor?: (activity: CrmActivityRow) => ReactNode
  /**
   * No controls on any row, whoever is reading — and no member read to
   * decide them. A feed that spans records is a place to see what happened,
   * not to rewrite it; the record's own page is where an activity is
   * corrected, beside everything else about it.
   */
  readOnly?: boolean
  /**
   * Which rows are open, held by the card so its header's "Expand all"
   * reaches them. A list with no header control holds its own.
   */
  expansion?: TimelineExpansion
}

/**
 * A newest-first list of logged activities, collapsed to one entry each and
 * paged by the console's shared footer (AGL-2600).
 *
 * The rows arrive ordered — the query is `orderBy('atMs', 'desc')` — and the
 * list does not sort them again; a second sort here is a second place for
 * the order to be defined. The footer pages the window the listener holds,
 * and a page turned past it widens the listener while the probe row says
 * more exists (`useTimelinePages`).
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
    loading,
    subjectFor,
    readOnly,
  } = props
  const canEdit = useCanEditActivity(scope.orgId, !readOnly)
  const ownExpansion = useTimelineExpansion()
  const expansion = props.expansion ?? ownExpansion
  const pages = useTimelinePages(rows.length, { hasMore, showMore: onShowMore, loading })
  // One clock for every row of one paint.
  const nowMs = Date.now()
  if (!rows.length) {
    return loading ? (
      <Typography variant="body2" color="text.secondary">
        {'Loading…'}
      </Typography>
    ) : (
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
      {pages.slice(rows).map((activity) => (
        <ActivityRow
          key={activity.$id}
          activity={activity}
          scope={scope}
          onEdit={onEdit}
          subject={subjectFor?.(activity)}
          nowMs={nowMs}
          editable={canEdit(activity)}
          expanded={expansion.isExpanded(activity.$id)}
          onToggle={() => expansion.toggle(activity.$id)}
        />
      ))}
      <ListPagination {...pages.footer} />
    </Stack>
  )
}
ActivityList.displayName = 'ActivityList'

export default ActivityList
