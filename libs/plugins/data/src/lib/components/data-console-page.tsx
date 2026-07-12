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
import { Alert, Button, Stack } from '@mui/material'
import HostDatasetsCard from './host-datasets-card.component'

/**
 * Data page (AGL-239 → AGL-395): the host-scoped view of the org's shared
 * datasets, owned by the data plugin and rendered by the shell's generic
 * plugin route. Datasets live at org scope, so the card links out to the
 * org Data page for the org-wide view. The tenant doc (resolved by the
 * shell) flows into the card for its entitlement/quota checks.
 */
export function DataConsolePage(props: ConsolePluginPageProps) {
  const { hostId, tenant } = props
  return (
    <Stack spacing={2}>
      <Alert
        severity="info"
        action={
          // Org-scoped route owned by the console app (stable path).
          <Button color="inherit" size="small" href="/org/data">
            {'Open organization data'}
          </Button>
        }
      >
        {'Datasets belong to your organization and are shared across every ' +
          'site — changes here apply to all of them.'}
      </Alert>
      <HostDatasetsCard hostId={hostId} tenant={tenant} />
    </Stack>
  )
}
DataConsolePage.displayName = 'DataConsolePage'

export default DataConsolePage
