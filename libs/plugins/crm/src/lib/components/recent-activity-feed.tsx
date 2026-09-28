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
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { crmRoutes } from '../model/crm-routes'
import { ActivityList } from './activity-list'
import {
  type CrmOrg,
  useActivityScope,
  useActivityWindow,
} from './activity-queries'
import { TimelineExpandAllButton, useTimelineExpansion } from './activity-timeline'

/** How the record an activity is about reads in the feed. */
const RECORD_LABELS = {
  contact: 'Contact',
  deal: 'Deal',
  company: 'Company',
  lead: 'Lead',
} as const

/** One page of the feed, and the step its listener widens by — a glance, not a log. */
export const RECENT_ACTIVITY_LIMIT = 10

/** The empty link: nothing to render, the query returns nothing. */
const NO_RECORD = Object.freeze({})

export interface RecentActivityFeedProps {
  /** The site the record is read under, or `null` at the organization level. */
  hostId: string | null
  org: CrmOrg
  /** A page of the feed, and how far its listener widens when a page is turned past it. */
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
 * The contacts landing shows it as a card of its own under the list card,
 * so that opening the CRM answers "what has the team been doing" before
 * anybody opens a record, without the list running on into it. One bounded
 * listener on `(visibleTo, atMs DESC)` — the index that exists for exactly
 * this query — filtered to what this reader may see, the same predicate the
 * rules evaluate. It reads one page, `limit`, and widens by a page only
 * when the reader turns to the next one.
 *
 * Every row is collapsed to its kind, its heading, who and when, and opens
 * in place to the body; **Expand all** in the card header opens them all.
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
  const expansion = useTimelineExpansion()
  /*
   * Whether the feed has ever had a row. A page turned past the window
   * re-reads it, and the listener holds nothing while it does; the card has
   * to stay through that rather than vanish with its page.
   */
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (activities.rows.length) setSeen(true)
  }, [activities.rows.length])
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
  if (activities.status !== 'error' && !activities.rows.length && !seen) return null

  return (
    <CardDisplay
      header={'Recent activity'}
      help={Aglyn.pluginDocsHelp('contactActivities', { anchor: '#the-recent-activity-feed' })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <TimelineExpandAllButton
            expansion={expansion}
            disabled={!activities.rows.length}
          />
        ),
      }}
    >
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
          hasMore={activities.hasMore}
          onShowMore={activities.showMore}
          loading={activities.status === 'loading'}
          expansion={expansion}
        />
      )}
    </CardDisplay>
  )
}
RecentActivityFeed.displayName = 'RecentActivityFeed'

export default RecentActivityFeed
