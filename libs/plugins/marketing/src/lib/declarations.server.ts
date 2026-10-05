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

// The seam from its own module, not the plugin-manager barrel: boot needs the
// registry and nothing else, and the barrel reaches the client contexts.
import { registerOperatorAlerts } from '@aglyn/aglyn/plugin-manager/operator-alerts'
import {
  registerPluginConversionCreditor,
  type PluginConversionCreditor,
} from '@aglyn/aglyn/plugin-manager/plugin-conversion-credit'
import { registerPluginSendTally } from '@aglyn/aglyn/plugin-manager/plugin-send-tallies'
import { registerPluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { registerPluginSiteBeacon } from '@aglyn/aglyn/plugin-manager/plugin-site-beacons'
import { registerPluginTransferResource } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { BUNDLE_ID } from './constants/bundle-common'
import {
  CAMPAIGN_PACKAGE_RULES,
  CAMPAIGNS_TRANSFER_KEY,
  campaignDependencies,
  campaignPackageContent,
  remapCampaignIds,
} from './transfer/campaigns-package'

/** The campaigns package's server half (AGL-3535), loaded when an import or export first asks. */
const campaignsPackage = async () => (await import('./transfer/campaigns-package.server')).createCampaignsPackage()
import { MARKETING_OPERATOR_ALERTS } from './constants/operator-alerts'

/**
 * The marketing plugin's server declarations: the light registrations core
 * reads at boot, before any surface loads — its operator alerts (AGL-3377),
 * so Staff → Operator alerts lists them before the first one is raised, and
 * its overlay beacons, which the site collector hands it on any published
 * page. The counting code and the Admin SDK load with the first beacon.
 *
 * And the conversion creditor (`plugin-conversion-credit`): every door that
 * produces an outcome — a form, a booking, a sign-up, an order, a sequence's
 * mail — asks it which campaign to credit, in any process, before any of
 * this plugin's surfaces has loaded. The joins load with the first credit.
 * Beside it, the tally the site's unsubscribe page tells when a recipient
 * leaves from a campaign send's mail (`plugin-send-tallies`), and the
 * `emailSend` record index another plugin names a send by — a person's
 * timeline listing the campaign mail they were sent (`plugin-record-index`).
 */
export function registerMarketingServerDeclarations(): void {
  // Campaigns in a workspace package (AGL-3535).
  registerPluginTransferResource(
    CAMPAIGNS_TRANSFER_KEY,
    {
      items: async (ctx) => (await campaignsPackage()).items(ctx),
      dependencies: (item) => campaignDependencies(campaignPackageContent(item)),
      remapIds: (item, idMap) => remapCampaignIds(campaignPackageContent(item), idMap),
      readItems: async (ctx, ids) => (await campaignsPackage()).readItems(ctx, ids),
      writeItems: async (ctx, items, writer) => (await campaignsPackage()).writeItems(ctx, items as never, writer),
      revertItems: async (ctx, steps) => (await campaignsPackage()).revertItems(ctx, steps as never),
      problems: async (ctx, write) => (await campaignsPackage()).problems(ctx, write as never),
      referenceTargets: async (ctx, kinds) => (await campaignsPackage()).referenceTargets(ctx, kinds),
      rules: CAMPAIGN_PACKAGE_RULES,
    },
    { pluginId: BUNDLE_ID },
  )
  registerOperatorAlerts(MARKETING_OPERATOR_ALERTS, { pluginId: BUNDLE_ID })
  registerPluginSiteBeacon(
    {
      field: 'overlay',
      // The plugin's own module, which brings the Admin SDK with it: a lazy
      // import of the data layer from here would make every static import of
      // it in this plugin, and in each app that loads these declarations, a
      // static import of a library loaded lazily.
      async count(request) {
        const { countOverlayBeaconOnPlatform } = await import('./server/overlay-beacon')
        await countOverlayBeaconOnPlatform(request)
      },
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginConversionCreditor(lazyConversionCreditor(), { pluginId: BUNDLE_ID })
  registerPluginSendTally(
    {
      async unsubscribed(request) {
        const { countCampaignSendUnsubscribe } = await import('./server/send-tally')
        return countCampaignSendUnsubscribe(request)
      },
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginRecordIndex(
    'emailSend',
    {
      list: async (request) => (await import('./server/email-send-record-index')).emailSendRecordIndex.list(request),
      get: async (request) => (await import('./server/email-send-record-index')).emailSendRecordIndex.get(request),
    },
    { pluginId: BUNDLE_ID },
  )
}

/**
 * The creditor, its module loaded on the first call: the plugin's own module,
 * which brings the data layer with it, for the reason the beacon's counter
 * is loaded that way.
 */
function lazyConversionCreditor(): PluginConversionCreditor {
  const load = async () => (await import('./server/conversion-creditor')).marketingConversionCreditor
  return {
    resolveTouch: async (request) => (await load()).resolveTouch(request),
    creditConversion: async (request) => (await load()).creditConversion(request),
    creditOrder: async (request) => (await load()).creditOrder(request),
    reverseOrder: async (request) => (await load()).reverseOrder(request),
    recordClick: async (click) => (await load()).recordClick(click),
    creditOutcome: async (request) => (await load()).creditOutcome(request),
    erasePerson: async (key) => (await load()).erasePerson(key),
  }
}
