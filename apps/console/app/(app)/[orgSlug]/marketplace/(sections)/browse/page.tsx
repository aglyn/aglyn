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

import PluginWidgetSlot from '../../../../../../components/plugin-widget-slot.component'
import { useMarketplaceScope } from '../layout'

/**
 * Marketplace › Browse All (AGL-693).
 *
 * The grid is the marketplace plugin's own widget — the app renders a slot and
 * never imports the plugin.
 */
export default function MarketplaceBrowseSection() {
  const { actingHost, permissions, orgSlug } = useMarketplaceScope()
  return (
    <PluginWidgetSlot
      slot="orgMarketplace"
      hostId={actingHost}
      permissions={permissions}
      orgScoped
      // The URL already knows the org (AGL-867): pass it so listing links
      // resolve synchronously instead of via an async hostIndex→org lookup
      // that can come back empty and leave the detail page unreachable from
      // browse.
      orgSlug={orgSlug}
    />
  )
}
