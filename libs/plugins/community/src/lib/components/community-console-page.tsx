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

import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import { Stack } from '@mui/material'
import CommunityBrowse from './community-browse.component'
import HostPluginsCard from './host-plugins-card.component'

/**
 * Community hub (AGL-44 → AGL-395): installed plugins + the community
 * marketplace browse/install, owned by the community plugin and rendered by
 * the shell's generic plugin route. Listing and publisher detail pages stay
 * as app file-routes under `/[hostId]/community/…` (nested dynamic segments
 * the single-segment plugin route can't serve) and import the shared
 * `useCommunityActions` from this plugin. The install action is gated by the
 * `installPlugins` permission the shell resolves and passes in.
 */
export function CommunityConsolePage(props: ConsolePluginPageProps) {
  const { hostId, permissions } = props
  return (
    <Stack spacing={3}>
      <HostPluginsCard hostId={hostId} />
      <CommunityBrowse hostId={hostId} permissions={permissions} />
    </Stack>
  )
}
CommunityConsolePage.displayName = 'CommunityConsolePage'

export default CommunityConsolePage
