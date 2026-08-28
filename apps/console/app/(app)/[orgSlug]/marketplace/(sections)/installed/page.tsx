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

import { AppLink } from '@aglyn/shared-ui-jsx'
import { Alert, Button, Stack } from '@mui/material'
import PluginWidgetSlot from '../../../../../../components/plugin-widget-slot.component'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useMarketplaceScope } from '../layout'

/**
 * Marketplace › Installed (AGL-2501).
 *
 * A convenience, not the inventory (AGL-1011). Administering what you already
 * run belongs in the Plugins section; this stays so that uninstalling
 * something you just installed does not send you somewhere else, and every row
 * links through. The first-party switchboard and the per-plugin config forms
 * live there entirely — they were never marketplace concerns.
 */
export default function MarketplaceInstalledSection() {
  const { actingHost, orgSlug } = useMarketplaceScope()
  return (
    <Stack spacing={2}>
      <Alert
        severity="info"
        action={
          <AppLink href={buildRoute(Route.ORG_PLUGINS, { orgSlug })}>
            <Button size="small" color="inherit" component="span">
              {'Open Plugins'}
            </Button>
          </AppLink>
        }
      >
        {'A quick list of what this organization installed from the ' +
          'marketplace. Settings, per-site scope and built-in plugins live ' +
          'in Plugins.'}
      </Alert>
      <PluginWidgetSlot
        slot="orgAddons"
        hostId={actingHost}
        // Lets each row link to its installation page (AGL-1007).
        orgSlug={orgSlug}
      />
    </Stack>
  )
}
