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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, Typography } from '@mui/material'
import { useCallback, useMemo, useState } from 'react'
import { ActivityList } from './activity-list'
import {
  type ActivityRecordLink,
  type CrmOrg,
  useActivityScope,
  useActivityWindow,
} from './activity-queries'
import { LogActivityDialog } from './log-activity-dialog'

export type RecordActivityCardProps = ActivityRecordLink & {
  hostId: string
  org: CrmOrg
}

/**
 * The activity log of one record — a contact, a company or a deal — with
 * the button that adds to it (AGL-2600).
 *
 * One card for all three record pages, because the log is the same thing on
 * each of them: what people did about this record, newest first, bounded to
 * a page of a hundred with a foot that asks for the next hundred. Which
 * record is decided by whichever of the three ids the page passes, and that
 * id is what the dialog files a new activity against — the page fixes it,
 * the reader does not pick it.
 *
 * The contact's page does NOT use this card. A person has a second history
 * the platform captured on the row itself, and the two belong in one
 * stream; see `contact-timeline-card.tsx`, which is this card's superset.
 */
export function RecordActivityCard(props: RecordActivityCardProps) {
  const { hostId, org, contactId, companyId, dealId } = props
  const scope = useActivityScope(hostId, org)
  /*
   * Memoized because the link is a listener dependency by value inside
   * `useActivityWindow` and the dialog's prop by reference: a fresh object
   * each render would be harmless to the query, which reads the ids, and
   * noisy for anything that compares the object.
   */
  const link = useMemo<ActivityRecordLink>(
    () => ({ contactId, companyId, dealId }),
    [contactId, companyId, dealId],
  )
  const activities = useActivityWindow(scope, link)
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
        actions={
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
            hasMore={activities.hasMore}
            onShowMore={activities.showMore}
            emptyText="Nothing logged yet — a call, an email, a meeting or a note goes here."
          />
        )}
      </CardDisplay>
      <LogActivityDialog
        open={dialogOpen}
        onClose={close}
        scope={scope}
        link={link}
        activity={editing}
      />
    </>
  )
}
RecordActivityCard.displayName = 'RecordActivityCard'

export default RecordActivityCard
