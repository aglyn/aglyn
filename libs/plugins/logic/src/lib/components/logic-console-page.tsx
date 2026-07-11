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
import { GridItems } from '@aglyn/shared-ui-jsx'
import HostFunctionsCard from './host-functions-card.component'
import HostReferenceHealthCard from './host-reference-health-card.component'
import HostVariablesCard from './host-variables-card.component'

/**
 * Logic page (AGL-91/92 → AGL-395): variables + no-code functions and the
 * reference-integrity audit, owned by the logic plugin and rendered by the
 * shell's generic plugin route. The tenant doc (resolved by the shell)
 * flows into the variable/function cards for their per-plan quota checks.
 */
export function LogicConsolePage(props: ConsolePluginPageProps) {
  const { hostId, tenant } = props
  return (
    <GridItems
      spacing={3}
      items={[
        {
          size: { xs: 12, md: 6 },
          children: <HostVariablesCard hostId={hostId} tenant={tenant} />,
        },
        {
          size: { xs: 12, md: 6 },
          children: <HostFunctionsCard hostId={hostId} tenant={tenant} />,
        },
        {
          // Broken-wiring audit (wave v7).
          size: { xs: 12 },
          children: <HostReferenceHealthCard hostId={hostId} />,
        },
      ]}
    />
  )
}
LogicConsolePage.displayName = 'LogicConsolePage'

export default LogicConsolePage
