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

import { checkEntitlement } from '../app-utils/plan-entitlements'
import { isHostPluginEnabled } from './enabled-plugins'
import { SITE_INTEGRATIONS_DECLARED } from './first-party-plugins.generated'

/**
 * A THIRD-PARTY SCRIPT A SITE OWNER CHOSE, and the hosts it reaches (AGL-3700).
 *
 * Some plugins put a vendor's script on a merchant's published pages with the
 * merchant's own account — a translation layer, a chat widget. The page's
 * Content Security Policy is enforcing for `connect-src` and `img-src`
 * (AGL-1152), so the vendor's requests are refused unless the policy names
 * its hosts, and naming them for every site would let every site's injected
 * script talk to them. So a plugin DECLARES, in `plugins.config.json` under
 * `siteIntegration`:
 *
 * - `connectHosts` / `imageHosts` — the exact hostnames its script reaches;
 * - `configSwitch` — the boolean in the plugin's settings that turns it on;
 * - `entitlement` — the plan feature it needs, when it needs one.
 *
 * The generator validates and compiles those, and the tenant's verdict route
 * asks {@link siteIntegrationHosts} which hosts THIS site needs. Core names no
 * vendor.
 *
 * ## Why compiled, not registered
 *
 * The reader is the verdict route behind the tenant middleware, which sets a
 * security header and loads no plugin's site code; a registry it had not
 * filled would answer "no hosts" and the vendor's script would fail on the
 * merchant's live site with nothing going red. A declaration also widens a
 * published page's policy, which is a platform decision — the reason the
 * video embed providers are compiled too (`video-embed-provider.ts`).
 *
 * ## What "enabled" means
 *
 * All three, matching what the plugin's own page enricher checks before it
 * puts the script on the page, so the policy never admits a host for a
 * script that is not there:
 *
 * 1. the site has the plugin switched on (`isHostPluginEnabled`);
 * 2. the workspace's plan has the declared entitlement, if one is declared;
 * 3. the site's resolved plugin settings hold `configSwitch: true`.
 *
 * Settings are read only for a site that passed 1 and 2, so a site that never
 * switched an integration on costs no read.
 */
export interface SiteIntegrationDeclaration {
  /** The plugin that loads the script. */
  pluginId: string
  /** The boolean setting that turns the integration on. */
  configSwitch: string
  /** The plan feature the integration needs, if any. */
  entitlement?: string
  /** Bare hostnames the script fetches from. */
  connectHosts: readonly string[]
  /** Bare hostnames the script loads images from. */
  imageHosts: readonly string[]
}

/** The hosts a site's policy admits for its integrations. */
export interface SiteIntegrationHosts {
  connectHosts: string[]
  imageHosts: string[]
}

/** Reads one plugin's resolved settings for one site. */
export type SiteIntegrationConfigReader = (
  pluginId: string,
) => Promise<Record<string, unknown> | null | undefined>

/**
 * The integration hosts this site needs, in declaration order, without
 * repeats. A settings read that fails leaves that integration's hosts out —
 * the same outcome as the script not being on the page, which is what the
 * page enricher does on the same failure.
 */
export async function siteIntegrationHosts(
  input: {
    org: Parameters<typeof checkEntitlement>[0] & Parameters<typeof isHostPluginEnabled>[0]
    host: Parameters<typeof isHostPluginEnabled>[1]
    readConfig: SiteIntegrationConfigReader
  },
  declared: readonly SiteIntegrationDeclaration[] = SITE_INTEGRATIONS_DECLARED,
): Promise<SiteIntegrationHosts> {
  const live = declared.filter(
    (integration) =>
      isHostPluginEnabled(input.org, input.host, integration.pluginId) &&
      (!integration.entitlement ||
        checkEntitlement(input.org, integration.entitlement)),
  )
  const switched = await Promise.all(
    live.map(async (integration) => {
      try {
        const config = await input.readConfig(integration.pluginId)
        return config?.[integration.configSwitch] === true ? integration : null
      } catch {
        return null
      }
    }),
  )
  const connectHosts: string[] = []
  const imageHosts: string[] = []
  for (const integration of switched) {
    if (!integration) continue
    for (const host of integration.connectHosts) {
      if (!connectHosts.includes(host)) connectHosts.push(host)
    }
    for (const host of integration.imageHosts) {
      if (!imageHosts.includes(host)) imageHosts.push(host)
    }
  }
  return { connectHosts, imageHosts }
}
