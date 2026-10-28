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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import {
  HostScreenVisibility,
  NODE_ROOT_ID,
  type AglynNodeSchema,
  type HostTokenSource,
  type SitePageResolver,
} from '@aglyn/aglyn/server'
import { resolveBuiltInPageLayoutId } from '@aglyn/tenant-runtime/built-in-page-layout'
import { composeNodesWithChrome } from '@aglyn/tenant-runtime/compose-screen-nodes'
import {
  WAIVERS_ENTITLEMENT,
  WAIVERS_PLUGIN_ID,
  WAIVERS_SIGN_COMPONENT_ID,
  WAIVERS_SITE_SIGN_PATH,
} from '../constants/bundle-common'

/*==========================================
 * THE STORE'S OWN SIGNING PAGE (AGL-4042), at `/sign-waiver` on the store's
 * site, where a waiver's share link and QR code open: the site's own header
 * and footer around the Sign waiver element, the way commerce serves its
 * order-status page. Served only where the site has no page of its own at
 * that address (page resolvers run for paths no published page claims), and
 * only while Waivers is on for the site and the plan includes the store.
 *
 * The page holds no waiver: the element reads `?waiver=` and the waiver
 * itself after hydration, from the site's own public door, so one cached
 * page serves every waiver and nobody's signature. UNLISTED, so the head
 * says noindex: a signing page is reached by its link, not by search.
 *=========================================*/

const CONTAINER_NODE = 'waivers-sign__container'
const SIGN_NODE = 'waivers-sign__element'

/** The signing page's node tree, root first, for the layout's slot. */
export function buildWaiverSignPageNodes(): Record<string, AglynNodeSchema> {
  return {
    [NODE_ROOT_ID]: { $id: NODE_ROOT_ID, componentId: 'div', nodes: [CONTAINER_NODE] } as AglynNodeSchema,
    [CONTAINER_NODE]: {
      $id: CONTAINER_NODE,
      parentId: NODE_ROOT_ID,
      componentId: 'muiContainer',
      pluginId: 'mui',
      // Theme spacing multiples, never lengths.
      props: { maxWidth: 'sm', sx: { paddingTop: 6, paddingBottom: 8 } },
      nodes: [SIGN_NODE],
    } as AglynNodeSchema,
    [SIGN_NODE]: {
      $id: SIGN_NODE,
      parentId: CONTAINER_NODE,
      componentId: WAIVERS_SIGN_COMPONENT_ID,
      pluginId: WAIVERS_PLUGIN_ID,
      props: {},
    } as AglynNodeSchema,
  }
}

export const waiversSitePageResolver: SitePageResolver = async ({ hostId, host, org, path }) => {
  const segments = String(path ?? '').split('/').filter(Boolean)
  if (segments.length !== 1 || segments[0] !== WAIVERS_SITE_SIGN_PATH) return undefined
  if (!isHostPluginEnabled(org ?? null, host ?? null, WAIVERS_PLUGIN_ID)) return undefined
  if (!checkEntitlement(org as never, WAIVERS_ENTITLEMENT as never)) return undefined
  try {
    const layoutId = await resolveBuiltInPageLayoutId({ hostId, host })
    const nodes = await composeNodesWithChrome({
      hostId,
      layoutId,
      screenNodes: buildWaiverSignPageNodes(),
      host: host as HostTokenSource,
    })
    if (!nodes) return undefined
    return {
      props: JSON.parse(
        JSON.stringify({
          data: {
            host,
            screen: { data: { displayName: 'Sign a waiver', visibility: HostScreenVisibility.UNLISTED } },
          },
          nodes,
        }),
      ),
      revalidate: 3600,
    }
  } catch (error) {
    console.error('waiver signing page composition failed', error)
    return undefined
  }
}
