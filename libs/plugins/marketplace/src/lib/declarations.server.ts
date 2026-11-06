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

// The registry from its own module, not the plugin-manager barrel: boot needs
// the registry and nothing else.
import {
  getRegisteringPluginId,
  setRegisteringPluginId,
} from '@aglyn/aglyn/app-utils/registering-plugin'
import { registerVariableComputer } from '@aglyn/aglyn/plugin-manager/computed-variables'
import { registerCustomFieldType } from '@aglyn/aglyn/plugin-manager/custom-fields'
import {
  listPluginOrgErasers,
  registerPluginOrgEraser,
} from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import { registerPluginRevocationReader } from '@aglyn/aglyn/plugin-manager/plugin-revocations'
import { registerPluginSiteResourceEraser } from '@aglyn/aglyn/plugin-manager/plugin-site-resources'
import { registerPluginSiteCspSource } from '@aglyn/aglyn/plugin-manager/plugin-site-csp'
import { registerPluginSiteStarterSource } from '@aglyn/aglyn/plugin-manager/plugin-site-starters'
import { registerSitePageEnricher } from '@aglyn/aglyn/plugin-manager/site-page-hooks'
import { BUNDLE_ID } from './constants/bundle-common'
import { RATING_FIELD } from './model/rating-field'

/**
 * The marketplace plugin's server declarations: the light registrations core
 * reads at boot, before any surface loads.
 *
 * The `rating` field type's validator (AGL-434), the marketplace's share of
 * a workspace erasure, its kill switch as another plugin reads it, and the
 * site starters "Create site" offers (AGL-4049).
 *
 * The validator: A dataset field of this type
 * can be written by a path that never loads the marketplace — a visitor's
 * form submission and an automation step, both in the tenant (AGL-2773) — so
 * the validator registers from here, which every app runs at boot, rather
 * than only from the console API surface. Pure data: no React, no Admin SDK.
 */
export function registerMarketplaceServerDeclarations(): void {
  registerCustomFieldType(RATING_FIELD)
  /*
   * The organization's public marketplace identity, erased with it (AGL-1970).
   * Declared REQUIRED in `plugins.config.json`: the profile carries a payout
   * identifier on a world-readable document, so an erasure refuses to run
   * without this eraser rather than report a workspace erased with it
   * standing. From here, which every app and the erasure script run at boot;
   * the Admin SDK arrives with the first erasure, not with the boot.
   */
  if (!listPluginOrgErasers().includes(BUNDLE_ID)) {
    registerPluginOrgEraser(
      async (request) => {
        const { createPublisherIdentityEraser } = await import('./server/publisher-erasure')
        const identity = await createPublisherIdentityEraser()(request)
        /*
         * The OAuth app credentials the workspace's listings hold for their
         * declared connections (AGL-4193). The erasure also sweeps them by
         * `orgId`; deleting them here as well counts them on the audit
         * record. Isolated from the REQUIRED identity share above: a failure
         * here is reported as an unmeasured figure, never as that share
         * failing.
         */
        let connectionCredentials: number | null = null
        try {
          const { erasePluginConnectionCredentials } = await import('./server/connections/erasure')
          connectionCredentials = Number((await erasePluginConnectionCredentials(request))['connectionCredentials'])
        } catch (error) {
          console.error('[marketplace] erasing plugin connection credentials failed', error)
        }
        return { ...identity, connectionCredentials }
      },
      { pluginId: BUNDLE_ID },
    )
  }
  /*
   * A site's declared connections (AGL-4193): its grants revoked at each
   * provider before the site's tree is deleted. Nothing is listed on the
   * Delete site card. The Admin SDK arrives with the first delete.
   */
  registerPluginSiteResourceEraser(
    {
      preview: async () => (await import('./server/connections/erasure')).pluginConnectionsSiteEraser.preview(),
      erase: async (request) => (await import('./server/connections/erasure')).pluginConnectionsSiteEraser.erase(request),
    },
    { pluginId: BUNDLE_ID },
  )
  /*
   * The kill switch (`plugin-revocations`, AGL-3080): the send path asks it
   * before mailing a design installed from a listing, in whichever process
   * sends. The Admin SDK arrives with the first read.
   */
  registerPluginRevocationReader(
    {
      async revocation(listingId) {
        const { marketplaceRevocationReader } = await import('./server/revocation-reader')
        return marketplaceRevocationReader.revocation(listingId)
      },
    },
    { pluginId: BUNDLE_ID },
  )
  /*
   * Site starters (AGL-4049): "Create site" searches the marketplace's
   * `siteStarter` listings and creates a site from the one picked, through
   * core's `core.site-starters` seam. Registering reads nothing; the Admin SDK
   * arrives with the first search, not with the boot. The same plugin
   * registering again replaces itself, so a re-run of these declarations is
   * safe.
   */
  const starters = () => import('./server/site-starter-source').then((m) => m.marketplaceSiteStarterSource)
  registerPluginSiteStarterSource(
    {
      search: async (input, viewer) => (await starters()).search(input, viewer),
      resolve: async (choice, viewer) => (await starters()).resolve(choice, viewer),
      installed: async (choice, viewer, site) => (await starters()).installed(choice, viewer, site),
      describe: async (choice, viewer) => (await starters()).describe(choice, viewer),
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginConnectionsSite()
}

/** The site's readers of a site's declared connections (AGL-4195), loaded with their first use. */
const siteRecords = () => import('./server/connections/site-records-platform')

let siteEnricherRegistered = false

/**
 * What a published site shows of its plugins' declared connections
 * (AGL-4195), registered wherever these declarations run and used by the
 * tenant's page render and policy verdict:
 *
 *   - the page enricher hands each signed element on the page its own
 *     listing's connection records, server-rendered; it reads nothing on a
 *     page without a marketplace element;
 *   - the variable computer gives each record's declared summary fields to
 *     the page as `{{var:…}}` values;
 *   - the CSP source admits the image hosts the site's signed plugins
 *     declare, on those sites only.
 *
 * The enricher is attributed to this plugin, as the loader's marker would
 * attribute it, so the page's "who contributed" narrowing still holds; an
 * unattributed contribution would make every page carrying one wait for
 * every enabled plugin. It is pushed onto a list, so it registers once.
 */
function registerPluginConnectionsSite(): void {
  if (!siteEnricherRegistered) {
    siteEnricherRegistered = true
    const previous = getRegisteringPluginId()
    setRegisteringPluginId(BUNDLE_ID)
    try {
      registerSitePageEnricher(async (context) => (await siteRecords()).connectionRecordsEnricher(context))
    } finally {
      setRegisteringPluginId(previous)
    }
  }
  registerVariableComputer(
    { prepare: async (hostId) => (await siteRecords()).connectionVariableComputer.prepare(hostId) },
    { pluginId: BUNDLE_ID },
  )
  registerPluginSiteCspSource(
    { hosts: async (input) => (await siteRecords()).pluginImageHostsSource.hosts(input) },
    { pluginId: BUNDLE_ID },
  )
}
