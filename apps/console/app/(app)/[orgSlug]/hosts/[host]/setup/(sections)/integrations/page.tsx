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

import PluginZoneSection from '../../../../../../../../components/plugin-zone-section.component'
import { useHostSettingsScope } from '../../../host-settings-scope'

/**
 * Integrations — the `hostSettings` plugin zone, in the content column
 * (AGL-3711).
 *
 * The connections a plugin keeps for this site: the merchant's email
 * platforms, Zapier, and whatever a plugin adds to the zone next, which lands
 * here with no change to this page. The rail offers the section only while
 * the zone has a card for this reader.
 */
export default function HostSetupIntegrationsSection() {
  const { hostId } = useHostSettingsScope()
  return (
    <PluginZoneSection
      slot="hostSettings"
      hostId={hostId}
      emptyLabel="Nothing to connect for this site yet"
      emptyDescription="Integrations appear here when a plugin that offers one is turned on."
    />
  )
}
