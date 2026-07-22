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

import { buildRoute, type ConsolePluginPageProps, Route } from '@aglyn/aglyn'
import { useConsoleHostRoute } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Stack } from '@mui/material'
import HostDatasetsCard from './host-datasets-card.component'

/**
 * Data page (AGL-239 → AGL-395): the host-scoped view of the org's shared
 * datasets, owned by the data plugin and rendered by the shell's generic
 * plugin route. Datasets live at org scope, so the card links out to the
 * org Data page for the org-wide view. The org doc (resolved by the
 * shell) flows into the card for its entitlement/quota checks.
 */
export function DataConsolePage(props: ConsolePluginPageProps) {
  const { hostId, org } = props
  // The org Data page is `/[orgSlug]/data` (AGL-621). This used to hardcode
  // `/org/data`, which stopped being a route at that migration and had been
  // a dead link ever since (AGL-685); the slug is not a prop, so resolve it
  // from the host.
  const { orgSlug } = useConsoleHostRoute(hostId)
  return (
    <Stack spacing={2}>
      <Alert
        severity="info"
        action={
          // Rendered only once the slug resolves — no link beats a dead one.
          orgSlug ? (
            <Button
              color="inherit"
              size="small"
              href={buildRoute(Route.ORG_DATA, { orgSlug })}
            >
              {'Open organization data'}
            </Button>
          ) : undefined
        }
      >
        {'Datasets belong to your organization and are shared across every ' +
          'site — changes here apply to all of them.'}
      </Alert>
      <HostDatasetsCard hostId={hostId} org={org} />
    </Stack>
  )
}
DataConsolePage.displayName = 'DataConsolePage'

export default DataConsolePage
