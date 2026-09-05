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

export interface DealActivityCardProps {
  hostId: string
  dealId: string
}

/**
 * What has happened on one deal — `orgs/{orgId}/crmActivities` where
 * `dealId ==` this one: the calls made, meetings held and notes logged by a
 * person, as distinct from the stage moves the deal records itself.
 *
 * A placeholder that keeps its place on the deal's page until the activity
 * log lands its timeline here.
 */
export function DealActivityCard(props: DealActivityCardProps) {
  const { dealId } = props
  return (
    <CardDisplay
      header={'Activity'}
      help={pluginDocsHelp('deals', { anchor: '#a-deals-page' })}
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary" data-deal-id={dealId}>
        {'Calls, meetings and notes logged on this deal will appear here.'}
      </Typography>
    </CardDisplay>
  )
}
DealActivityCard.displayName = 'DealActivityCard'

export default DealActivityCard
