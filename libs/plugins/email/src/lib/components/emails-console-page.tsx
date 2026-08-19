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
import CampaignsCard from './campaigns-card'
import EmailScreensCard from './email-screens-card'
import ListsCard from './lists-card'
import SuppressionsCard from './suppressions-card'

/**
 * Emails page (AGL-395): the console surface owned by the email plugin,
 * rendered by the shell's generic plugin route. Uses the host-setup
 * vertical-tab pattern (shared `HubTabs`) — Campaigns composer/history,
 * the designed-email list (which no longer clutters the main Screens
 * list), audience lists — the marketing "Email" section, relocated — and,
 * since AGL-2410, the suppression list, which had been written by two paths
 * and displayed by none.
 */
export function EmailsConsolePage(props: ConsolePluginPageProps) {
  const { hostId } = props
  return (
    <HubTabs
      tabs={[
        {
          id: 'campaigns',
          label: 'Campaigns',
          content: <CampaignsCard hostId={hostId} />,
        },
        {
          id: 'designs',
          label: 'Designs',
          content: <EmailScreensCard hostId={hostId} />,
        },
        {
          id: 'audiences',
          label: 'Audiences',
          content: <ListsCard hostId={hostId} />,
        },
        {
          // Beside the audiences rather than inside them (AGL-2410): a
          // suppression is not a list you build, it is the reason a list you
          // built did not all get mailed.
          id: 'suppressions',
          label: 'Suppressions',
          content: <SuppressionsCard hostId={hostId} />,
        },
      ]}
    />
  )
}
EmailsConsolePage.displayName = 'EmailsConsolePage'

export default EmailsConsolePage
