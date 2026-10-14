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

import { CONSOLE_WIDGET_SLOTS } from '@aglyn/aglyn'
import PluginZoneSection from '../../../../../../components/plugin-zone-section.component'
import { useOrgScope } from '../../../../../../hooks/use-org-scope'

/**
 * Integrations — the organization's `orgSettings` plugin zone, in the content
 * column (AGL-3711), with the props the zone documents (AGL-2943).
 *
 * The layout drew the zone below the rail, where a card would have run full
 * width under every section. The rail offers this section only while the
 * zone has a card for this reader.
 */
export default function SettingsIntegrations() {
  const { currentOrg } = useOrgScope()
  return (
    <PluginZoneSection
      slot={CONSOLE_WIDGET_SLOTS.orgSettings}
      orgId={currentOrg?.$id}
      org={currentOrg}
      emptyLabel="Nothing to connect for this organization yet"
      emptyDescription="Integrations appear here when a plugin that offers one is turned on."
    />
  )
}
