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

import { Typography } from '@mui/material'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import OrgActivityCard from '../../../../../../components/org-activity-card.component'
import { useOrgScope } from '../../../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'

/**
 * The org audit feed, permission-gated (AGL-243, `org.auditLog`).
 *
 * The gate is HERE and not only on the nav item that leads here. A hidden link
 * is not an access control — the route is reachable by typing it, and this
 * card issues its own Firestore query on mount, so an unentitled member would
 * both see the feed and pull it.
 *
 * `permissionsLoaded &&`, never `!permissionsLoaded ||`: the second spelling
 * renders the feed BECAUSE the permission read has not landed yet, which is an
 * explicit opt-in to failing open on the one section that carries other
 * people's data — actor names, what they did, to what, and when.
 */
const TeamActivity: NextPageWithLayout<Record<string, never>> = () => {
  const { currentOrg } = useOrgScope()
  const { can, loaded: permissionsLoaded } = useOrgPermissions()
  if (!permissionsLoaded) return null
  if (!currentOrg?.$id || !can('org.auditLog')) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'You do not have permission to view this organization’s activity.'}
      </Typography>
    )
  }
  return <OrgActivityCard orgId={currentOrg.$id} />
}
TeamActivity.displayName = 'Page:TeamActivity'

export default TeamActivity
