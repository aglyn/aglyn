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

import { permissionRefusalText } from '@aglyn/aglyn/app-utils/org-permissions'
import { planLabelGrantingFeature } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { SITE_STARTER_MAX_SCREENS } from '@aglyn/aglyn/app-utils/site-starter'
import { siteStarterBuiltinThemeOf } from '@aglyn/aglyn/app-utils/site-starter-theme'
import { checkEntitlement, type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost, isServerReleaseFlagOnForOrg } from '@aglyn/tenant-data-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { paymentProvider } from '@aglyn/tenant-data-admin/server/payment-provider'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import type { DecodedIdToken } from 'firebase-admin/auth'
import { starterPublishFactsAnswer, starterPublishPages } from '../model/starter-publish'
import { PUBLISHER_PROFILES, resolvePublisherProfile } from './publisher-profile'
import { SITE_STARTERS_UNRELEASED } from './starters'

/**
 * WHAT "PUBLISH AS A STARTER" READS BEFORE THE CLICK, ASKED OF THE SERVER
 * (AGL-4049).
 *
 * `GET /api/marketplace/starter-publish-facts?hostId=` answers
 * `StarterPublishFactsAnswer`: what the publish would capture, the built-in
 * theme the site wears as the publish body carries it, and each setup step
 * still in the way.
 *
 * The console's form works these out in the browser; the native apps ask
 * here, so what a site's built-in theme is stays one function in core
 * (`siteStarterBuiltinThemeOf`) rather than a port on each platform. It reads
 * for the same person the door would take: the workspace's "Publish to the
 * marketplace" (`marketplace.publish`), and the release flag, which staff
 * pass. A refusal is also how an app knows to offer nothing. The door still
 * decides: these are what it would say, read early.
 */
export const starterPublishFactsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.query?.['hostId'] ?? '').trim()
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  let decoded: DecodedIdToken
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  } catch (error) {
    // Only a refused credential is the caller's 401; failing to check it is
    // ours and keeps the dispatcher's 5xx.
    if (!isRefusedIdToken(error)) throw error
    return res.status(401).json({ error: 'Unauthenticated' })
  }
  try {
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!membership.orgId || !membership.permissions.publishToMarketplace) {
      return res.status(403).json({ error: permissionRefusalText('marketplace.publish') })
    }
    const orgId = membership.orgId
    if (
      decoded['staff'] !== true &&
      !(await isServerReleaseFlagOnForOrg('release_site_starters', orgId))
    ) {
      return res.status(403).json({ error: SITE_STARTERS_UNRELEASED })
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) return res.status(404).json({ error: 'Unknown site' })
    const host = hostSnapshot.data() as Record<string, unknown>

    // The routed pages, at most one past the most a starter may have: the
    // window the door walks, enough to say a site is past the limit.
    const routing = host['screens']
    const routedIds =
      routing && typeof routing === 'object' && !Array.isArray(routing)
        ? Object.keys(routing).slice(0, SITE_STARTER_MAX_SCREENS + 1)
        : []
    const screens = routedIds.length
      ? await firestore.getAll(...routedIds.map((id) => hostRef.collection('screens').doc(id)))
      : []
    const pages = starterPublishPages(
      routing,
      screens
        .filter((screen) => screen.exists)
        .map((screen) => ({ ...(screen.data() as Record<string, unknown>), $id: screen.id })),
    )

    const [orgForHost, profile, publisher] = await Promise.all([
      getOrgForHost(hostId),
      firestore.collection(PUBLISHER_PROFILES).doc(orgId).get(),
      resolvePublisherProfile(firestore, orgId),
    ])
    const answer = starterPublishFactsAnswer({
      facts: {
        plan: {
          ready: true,
          locked: !checkEntitlement((orgForHost?.org ?? {}) as any, 'marketplaceSelling'),
          ...(planLabelGrantingFeature('marketplaceSelling')
            ? { planLabel: planLabelGrantingFeature('marketplaceSelling') }
            : {}),
        },
        profile: profile.exists ? (profile.data() as Record<string, unknown>) : null,
        pages,
        sellsAsPlatform: publisher?.sellsAsPlatform === true,
        // The door's own mode, so a payout account in the other Stripe mode
        // is named as the step in the way (AGL-2471).
        platformMode: paymentProvider().platformMode(),
        // The apps fix each step on a screen of their own.
        marketplacePath: null,
        pagesPath: null,
      },
      builtin: siteStarterBuiltinThemeOf(host),
    })
    return res.status(200).json(answer)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Could not read this site' })
  }
}

export default starterPublishFactsHandler
