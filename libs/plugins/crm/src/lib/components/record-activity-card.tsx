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

import type { CrmActivityRow } from '@aglyn/aglyn'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, Stack, Typography } from '@mui/material'
import { Fragment, useCallback, useMemo, useState } from 'react'
import { type CrmRecordKind, useCrmRecordNames } from '../hooks/use-crm-record-names'
import { crmRoutes } from '../model/crm-routes'
import { ActivityList } from './activity-list'
import {
  type ActivityRecordLink,
  type CrmOrg,
  useActivityScope,
  useActivityWindow,
} from './activity-queries'
import { TimelineExpandAllButton, useTimelineExpansion } from './activity-timeline'
import { LogActivityDialog } from './log-activity-dialog'

export type RecordActivityCardProps = ActivityRecordLink & {
  /** The site the record is read under, or `null` at the organization level. */
  hostId: string | null
  org: CrmOrg
  /** The deal's page's own document, so **Log activity** opens on its Primary. */
  deal?: { contactId?: unknown; contactRoles?: unknown } | null
  /** The hub's mount path, for the links a company's entries carry. */
  basePath?: string
}

/** A rolled-up entry's person, then its deal, and the word for one nobody can name. */
const ABOUT_KINDS = [
  { kind: 'contact', field: 'contactId', label: 'Contact' },
  { kind: 'deal', field: 'dealId', label: 'Deal' },
] as const satisfies ReadonlyArray<{
  kind: CrmRecordKind
  field: 'contactId' | 'dealId'
  label: string
}>

/**
 * The contact and the deal a company's entry is about (AGL-4123), each a link
 * to its record. A record this reader cannot name, or one since deleted, reads
 * as its kind: the id means nothing to anybody.
 */
function ActivityAbout(props: {
  activity: CrmActivityRow
  nameOf: (kind: CrmRecordKind, id: string) => string | undefined
  hrefOf: ((kind: CrmRecordKind, id: string) => string) | null
}) {
  const { activity, nameOf, hrefOf } = props
  const about = ABOUT_KINDS.flatMap(({ kind, field, label }) => {
    const id = activity[field]
    return id ? [{ kind, id, label: nameOf(kind, id) || label }] : []
  })
  if (!about.length) return null
  return (
    <Typography variant="caption" color="text.secondary" data-testid="activity-about">
      {about.map(({ kind, id, label }, index) => (
        <Fragment key={kind}>
          {index ? ' · ' : null}
          {hrefOf ? <AppLink href={hrefOf(kind, id)}>{label}</AppLink> : label}
        </Fragment>
      ))}
    </Typography>
  )
}

/**
 * The activity log of one record — a contact, a company, a deal or a lead
 * (AGL-2615) — with the button that adds to it (AGL-2600).
 *
 * One card for all four record pages, because the log is the same thing on
 * each of them: what people did about this record, newest first, one
 * collapsed entry each and paged by the console's footer over a listener
 * bounded to a hundred, which a page turned past it widens by the next
 * hundred. **Log activity** and **Expand all** sit in the card header. Which
 * record is decided by whichever of the four ids the page passes, and that
 * id is what the dialog's **Name** and **Related To** open on.
 *
 * A company's log is every entry that rolled up to it (AGL-4123), its people's
 * and its deals' as well as its own, so each row says who or what it is about.
 *
 * The contact's page does NOT use this card. A person has a second history
 * the platform captured on the row itself, and the two belong in one
 * stream; see `contact-timeline-card.tsx`, which is this card's superset.
 */
export function RecordActivityCard(props: RecordActivityCardProps) {
  const { hostId, org, contactId, companyId, dealId, leadId, deal, basePath } = props
  const scope = useActivityScope(hostId, org)
  /*
   * Memoized because the link is a listener dependency by value inside
   * `useActivityWindow` and the dialog's prop by reference: a fresh object
   * each render would be harmless to the query, which reads the ids, and
   * noisy for anything that compares the object.
   */
  const link = useMemo<ActivityRecordLink>(
    () => ({ contactId, companyId, dealId, leadId }),
    [contactId, companyId, dealId, leadId],
  )
  const activities = useActivityWindow(scope, link)
  /*
   * One read per person and deal the shown rows name, cached for the page and
   * asked only on a company's log: the bounded audience of one account, which
   * the org-wide feed is not, and the reason it names no records.
   */
  const aboutRecords = useMemo(
    () =>
      companyId
        ? activities.rows.flatMap((row) =>
            ABOUT_KINDS.flatMap(({ kind, field }) => {
              const id = row[field]
              return id ? [{ kind, id }] : []
            }),
          )
        : [],
    [companyId, activities.rows],
  )
  const nameOf = useCrmRecordNames({
    orgId: scope.orgId,
    groupId: scope.consentGroup?.groupId ?? null,
    org: scope.org,
    records: aboutRecords,
  })
  const routes = useMemo(() => (basePath ? crmRoutes(basePath) : null), [basePath])
  const aboutFor = useCallback(
    (activity: CrmActivityRow) => (
      <ActivityAbout
        activity={activity}
        nameOf={nameOf}
        hrefOf={routes ? (kind, id) => routes[kind](id) : null}
      />
    ),
    [nameOf, routes],
  )
  const expansion = useTimelineExpansion()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CrmActivityRow | null>(null)
  const openNew = useCallback(() => {
    setEditing(null)
    setDialogOpen(true)
  }, [])
  const openEdit = useCallback((activity: CrmActivityRow) => {
    setEditing(activity)
    setDialogOpen(true)
  }, [])
  const close = useCallback(() => setDialogOpen(false), [])

  return (
    <>
      <CardDisplay
        header={'Activity'}
        help={pluginDocsHelp('contactActivities', { anchor: '#logging-an-activity' })}
        HeaderProps={{
          action: (
            <Stack direction="row" spacing={1}>
              <TimelineExpandAllButton
                expansion={expansion}
                disabled={!activities.rows.length}
              />
              <Button
                size="small"
                variant="contained"
                color="primary"
                onClick={openNew}
                disabled={!activities.ready}
              >
                {'Log activity'}
              </Button>
            </Stack>
          ),
        }}
        contentGutterX
        contentGutterY
      >
        {activities.status === 'error' ? (
          <Typography variant="body2" color="error">
            {'The activity log could not be loaded.'}
          </Typography>
        ) : (
          <ActivityList
            rows={activities.rows}
            scope={scope}
            onEdit={openEdit}
            aboutFor={companyId ? aboutFor : undefined}
            hasMore={activities.hasMore}
            onShowMore={activities.showMore}
            loading={activities.status === 'loading'}
            expansion={expansion}
            emptyText="A call, an email, a meeting or a note about this record goes here."
            emptyAction={
              <Button
                size="small"
                variant="contained"
                color="primary"
                onClick={openNew}
                disabled={!activities.ready}
              >
                {'Log activity'}
              </Button>
            }
          />
        )}
      </CardDisplay>
      <LogActivityDialog
        open={dialogOpen}
        onClose={close}
        scope={scope}
        link={link}
        deal={deal}
        activity={editing}
      />
    </>
  )
}
RecordActivityCard.displayName = 'RecordActivityCard'

export default RecordActivityCard
