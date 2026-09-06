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
import type { CrmActivityRow } from '@aglyn/aglyn'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { Stack, Typography } from '@mui/material'
import { useCallback, useMemo } from 'react'
import { crmRoutes } from '../model/crm-routes'
import { ActivityList } from './activity-list'
import {
  type CrmOrg,
  useActivityScope,
  useActivityWindow,
} from './activity-queries'

/** How the record an activity is about reads in the feed. */
const RECORD_LABELS = {
  contact: 'Contact',
  deal: 'Deal',
  company: 'Company',
  lead: 'Lead',
} as const

/** The feed's default depth — a glance, not a log. */
export const RECENT_ACTIVITY_LIMIT = 10

/** The empty link: nothing to render, the query returns nothing. */
const NO_RECORD = Object.freeze({})

export interface RecentActivityFeedProps {
  hostId: string
  org: CrmOrg
  /** The newest this many, across every record. */
  limit?: number
  /**
   * The hub's mount path, for the link each row carries to its record. The
   * shell supplies it on every hub page; a mount without one draws the
   * record's label with no link rather than a link into nowhere.
   */
  basePath?: string
}

/**
 * The newest logged activity across the CRM (AGL-2600): the last few calls,
 * emails, meetings and notes anyone on the team filed against any record,
 * each linking to the record it is about.
 *
 * What the contacts landing shows under its list, so that opening the CRM
 * answers "what has the team been doing" before anybody opens a record. One
 * bounded listener on `(visibleTo, atMs DESC)` — the index that exists for
 * exactly this query — filtered to what this reader may see, the same
 * predicate the rules evaluate. Bounded to `limit` and no further: a feed
 * is a glance, and the record's own page is where the whole log lives.
 *
 * A row links to its CONTACT when it has one, else its deal, else its
 * company — `crmActivityRecordLink`'s precedence — through `crmRoutes`, so
 * the address it builds is the one the hub resolves. Nothing is looked up
 * to name the record: a name per row would be a document read per row of a
 * feed drawn on every visit to the list, and the record's page names itself.
 */
export function RecentActivityFeed(props: RecentActivityFeedProps) {
  const { hostId, org, limit = RECENT_ACTIVITY_LIMIT, basePath } = props
  const scope = useActivityScope(hostId, org)
  const activities = useActivityWindow(scope, NO_RECORD, limit)
  const routes = useMemo(
    () => (basePath ? crmRoutes(basePath) : null),
    [basePath],
  )
  const subjectFor = useCallback(
    (activity: CrmActivityRow) => {
      const target = Aglyn.crmActivityRecordLink(activity)
      if (!target) return null
      const label = RECORD_LABELS[target.record]
      const href = routes ? routes[target.record](target.id) : null
      return href ? (
        <Typography variant="caption">
          <AppLink href={href}>{label}</AppLink>
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      )
    },
    [routes],
  )

  // Nothing to show and nothing to say: a landing with no activity yet
  // should not carry an empty heading for a feature the reader has not
  // used, and the record pages are where the "log one" affordance lives.
  if (activities.status !== 'error' && !activities.rows.length) return null

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">{'Recent activity'}</Typography>
      {activities.status === 'error' ? (
        <Typography variant="body2" color="error">
          {'Recent activity could not be loaded.'}
        </Typography>
      ) : (
        <ActivityList
          rows={activities.rows}
          scope={scope}
          subjectFor={subjectFor}
          readOnly
        />
      )}
    </Stack>
  )
}
RecentActivityFeed.displayName = 'RecentActivityFeed'

export default RecentActivityFeed
