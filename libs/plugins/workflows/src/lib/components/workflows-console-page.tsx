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
import { HubTabs } from '@aglyn/shared-ui-next'
import HostActionsCard from './host-actions-card.component'
import HostWebhooksCard from './host-webhooks-card.component'
import HostWorkflowsCard from './host-workflows-card.component'

/**
 * Workflows page (AGL-101/148/149 → AGL-395): the automation surface —
 * workflow builder, event-triggered actions, and webhooks — owned by the
 * workflows plugin and rendered by the shell's generic plugin route with
 * the host-setup vertical-tab pattern. Each card runs its own entitlement
 * check (workflows / actions / webhooks are distinct plan flags), so the
 * shell's resolved `tenant` doc flows into all three.
 */
export function WorkflowsConsolePage(props: ConsolePluginPageProps) {
  const { hostId, tenant } = props
  return (
    <HubTabs
      tabs={[
        {
          id: 'workflows',
          label: 'Workflows',
          content: <HostWorkflowsCard hostId={hostId} tenant={tenant} />,
        },
        {
          id: 'actions',
          label: 'Actions',
          content: <HostActionsCard hostId={hostId} tenant={tenant} />,
        },
        {
          id: 'webhooks',
          label: 'Webhooks',
          content: <HostWebhooksCard hostId={hostId} tenant={tenant} />,
        },
      ]}
    />
  )
}
WorkflowsConsolePage.displayName = 'WorkflowsConsolePage'

export default WorkflowsConsolePage
