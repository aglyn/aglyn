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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { readUsageCandidates } from '../../../../utils/server/read-usage-candidates'
import {
  scanPluginPlacements,
  type PluginPlacement,
} from '../../../../utils/server/scan-artifact-usage'

/** What uninstalling would do to one site. */
export interface PluginImpactSite {
  hostId: string
  label: string
  /**
   * The plugin keeps running here after this uninstall, because an org pin
   * still covers the site. Removing a host pin that shadows an org pin does
   * NOT stop the plugin, and a dialog implying otherwise is worse than none.
   */
  stillCovered: boolean
  placements: PluginPlacement[]
  /** Distinct published screens that would stop rendering it. */
  affectedScreens: number
  /** The scan hit its cap, so these numbers are a floor, not a total. */
  truncated: boolean
}

/**
 * What an uninstall would actually break (AGL-1027).
 *
 * Uninstalling used to be one click with no statement of consequence: the pin
 * went away and every page placing the plugin stopped rendering it, on live
 * sites, with nothing having said so. The blast radius is invisible at the
 * moment of the click — "uninstall org-wide" removes one pointer covering every
 * site in the workspace, including ones the person clicking has never opened.
 *
 * This answers the question the confirmation needs to ask. Three things make
 * the answer non-obvious, and all three are why it is a server scan rather than
 * a count the client could do:
 *
 * * A plugin in LAYOUT chrome is on every page under that layout, at any
 *   nesting depth.
 * * A plugin inside a reusable component is on every page placing it.
 * * A host pin sitting on top of an org pin SHADOWS it, so removing the host
 *   pin changes the version in use and nothing else.
 *
 * Advisory, so the 200-document cap stands — but `truncated` is returned rather
 * than swallowed, because "7 published pages" and "at least 7 published pages"
 * are different promises and only one of them is true when the scan was capped.
 *
 * Reuses `readUsageCandidates` deliberately: screen and layout node trees have
 * two storage forms, and a second reader that handled only one would report
 * "nothing placed" while blind to half the corpus — an uninstall dialog
 * confidently saying nothing breaks is the worst possible version of this bug.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  /** The plugin's MANIFEST id — what its nodes carry, not the listing id. */
  const pluginId = String(body?.pluginId ?? '')
  const hostIds: string[] = Array.isArray(body?.hostIds)
    ? body.hostIds.map((id: unknown) => String(id)).filter(Boolean).slice(0, 25)
    : []
  const stillCoveredIds = new Set(
    Array.isArray(body?.stillCoveredHostIds)
      ? body.stillCoveredHostIds.map((id: unknown) => String(id))
      : [],
  )
  if (!pluginId || !hostIds.length) {
    return Response.json(
      { error: 'Missing pluginId or hostIds' },
      { status: 400 },
    )
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()

    const sites: PluginImpactSite[] = []
    for (const hostId of hostIds) {
      const hostRef = firestore.collection('hosts').doc(hostId)
      const hostSnapshot = await hostRef.get()
      if (!hostSnapshot.exists) continue
      // Per site, not once for the org: an admin of one site must not learn
      // the page names of another through an impact check.
      const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
      if (!memberRole) continue

      const [screens, layouts, components] = await Promise.all([
        readUsageCandidates(hostRef, 'screens', { withNodes: true, limit: 200 }),
        readUsageCandidates(hostRef, 'layouts', { withNodes: true, limit: 200 }),
        readUsageCandidates(hostRef, 'components', {
          withNodes: true,
          limit: 200,
        }),
      ])
      const scan = scanPluginPlacements(pluginId, {
        screens: screens.candidates,
        layouts: layouts.candidates,
        components: components.candidates,
      })
      sites.push({
        hostId,
        label: String(hostSnapshot.get('displayName') ?? hostId),
        stillCovered: stillCoveredIds.has(hostId),
        placements: scan.placements,
        affectedScreens: scan.affectedScreenIds.length,
        truncated: screens.truncated || layouts.truncated || components.truncated,
      })
    }

    const affectedScreens = sites.reduce(
      (total, site) => total + (site.stillCovered ? 0 : site.affectedScreens),
      0,
    )
    const placements = sites.reduce(
      (total, site) => total + (site.stillCovered ? 0 : site.placements.length),
      0,
    )
    return Response.json(
      {
        sites,
        /** Sites that genuinely lose the plugin — shadowed ones do not. */
        losingSites: sites.filter((site) => !site.stillCovered).length,
        placements,
        affectedScreens,
        truncated: sites.some((site) => site.truncated),
        /**
         * Uninstall removes the PIN and nothing else — a plugin's settings and
         * any data it wrote survive, and re-installing restores the pages. Said
         * here so the dialog states it rather than leaving people to guess how
         * much they are about to lose.
         */
        dataSurvives: true,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Impact check failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
