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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Typography } from '@mui/material'

export interface DealTasksCardProps {
  hostId: string
  dealId: string
}

/**
 * The tasks filed against one deal — `orgs/{orgId}/crmTasks` where
 * `dealId ==` this one, on the `(visibleTo, dealId, dueAtMs)` index.
 *
 * The card holds its place on the deal's page so the layout is settled
 * before the tasks section lands its list here; until then it says so
 * rather than drawing an empty table that reads as "no tasks".
 */
export function DealTasksCard(props: DealTasksCardProps) {
  const { dealId } = props
  return (
    <CardDisplay
      header={'Tasks'}
      help={pluginDocsHelp('deals', { anchor: '#a-deals-page' })}
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary" data-deal-id={dealId}>
        {'Calls, emails, meetings and to-dos for this deal will be listed here.'}
      </Typography>
    </CardDisplay>
  )
}
DealTasksCard.displayName = 'DealTasksCard'

export default DealTasksCard
