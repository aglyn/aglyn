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

import { holdsSiteKey, siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import { checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { SiteStarterChoice, SiteStarterPayload } from '@aglyn/aglyn/app-utils/site-starter'
import { isSiteStyleId, readHostStarterChoice } from '@aglyn/aglyn/app-utils/site-styles'
import {
  describeSiteStarter,
  resolveSiteStarterSource,
} from '@aglyn/aglyn/plugin-manager/plugin-site-starters'
import { resolveSiteStyleLooks } from '@aglyn/aglyn/plugin-manager/plugin-site-style-looks'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  logHostActivity,
} from '@aglyn/tenant-data-admin'
import type { SiteStarterInstall } from '@aglyn/tenant-data-admin/server/provision-starter'
import { registerPluginServerDeclarations } from '../../../../constants/plugins.declarations.server.generated'
import { provisionStarterSite } from '../../../../utils/server/provision-host'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * Gives a site born for the guided AI start its starter (AGL-3594): the
 * published Home page at `/` and the header and footer layout around it.
 *
 * Called when a person leaves the guided start for a blank site — its skip,
 * its close control and Escape, through the `hostFirstRun` zone's
 * `startBlank` — and when a guided start that did not work out is traded for
 * the starter. `provisionStarterSite` does the work and is a no-op on a site
 * that already has a page or a layout, so a second call, a second tab or a
 * site born with the starter answers `provisioned: false` and changes
 * nothing.
 *
 * A `style` (AGL-4049) is the style the person chose, a `SITE_STYLES` id:
 * the starter wears that style's look and the site records it. Without one
 * the site keeps the theme it was born with.
 *
 * A site created for an AI starter (AGL-4049 phase 4; `starterChoice.mode`
 * `ai` with a listing) gets THAT starter's own pages, layout and theme, as
 * {@link aiStarterOf} resolves it for the site's workspace, which owns it if
 * it was bought. One that is gone, no longer paid for, larger than the plan
 * holds, or served by no plugin gives the default starter in the chosen
 * style instead, so no site is left empty either way.
 *
 * The same gate as the site's other setup writes: a site admin or editor, or
 * staff, and the lockdown verdict.
 */
/** A pinned version as the site recorded it: a version number, never `latest`. */
const PINNED_VERSION = /^[1-9][0-9]{0,8}$/

/**
 * The AI starter a site was created for, resolved for its own pages, or
 * `null` when it was not created for one or that starter cannot give it
 * pages now. Best-effort: never throws, because the default starter is the
 * answer to every failure.
 */
async function aiStarterOf(input: {
  host: { get(field: string): unknown }
  uid: string
  pagesAllowed: number
}): Promise<SiteStarterInstall | null> {
  const recorded = readHostStarterChoice(input.host.get('starterChoice'))
  if (!recorded || recorded.mode !== 'ai' || !recorded.listingId) return null
  try {
    await registerPluginServerDeclarations().catch((error: unknown) => {
      console.error('[hosts/starter] plugin declarations failed', error)
    })
    const source = resolveSiteStarterSource()
    if (!source) return null
    const choice: SiteStarterChoice = {
      listingId: recorded.listingId,
      ...(recorded.version && PINNED_VERSION.test(recorded.version) ? { version: recorded.version } : {}),
    }
    const orgId = input.host.get('orgId')
    const viewer = { orgId: typeof orgId === 'string' && orgId ? orgId : null, uid: input.uid }
    const resolved = await source.resolve(choice, viewer)
    if (!resolved || typeof resolved !== 'object' || 'error' in resolved) return null
    const payload = resolved as SiteStarterPayload
    if ((Array.isArray(payload.screens) ? payload.screens.length : 0) > input.pagesAllowed) return null
    const described = await describeSiteStarter(source, choice, viewer)
    return {
      payload,
      listing: {
        listingId: recorded.listingId,
        version: choice.version ?? recorded.version ?? 'latest',
        displayName: described?.displayName?.trim() || 'Starter',
        kind: described?.facets?.kind ?? payload.facets?.kind ?? null,
      },
    }
  } catch (error) {
    console.error('[hosts/starter] AI starter could not be resolved', { listingId: recorded.listingId, error })
    return null
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '').trim()
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  const styleId = body?.style == null ? null : String(body.style)
  if (styleId !== null && !isSiteStyleId(styleId)) {
    return Response.json({ error: 'Unknown style' }, { status: 400 })
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
    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const staff = decoded['staff'] === true
    // "Publish site content" (`site.publish`, AGL-4047): a starter site is
    // published as it is laid down, which is why this asked Admin or Editor.
    if (!staff && !holdsSiteKey(hostSnapshot, decoded.uid, 'site.publish')) {
      return Response.json({ error: siteKeyRefusal('site.publish') }, { status: 403 })
    }
    const org = (await getOrgForHost(hostId))?.org
    const locked = await lockdownRefusal({
      request,
      staff,
      uid: decoded.uid,
      org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    // The AI starter the site was created for, when it was (AGL-4049
    // phase 4): its own pages, held to the plan's page count.
    const starter = await aiStarterOf({
      host: hostSnapshot,
      uid: decoded.uid,
      pagesAllowed: checkQuota((org ?? {}) as never, 'screensPerHost', 0).limit,
    })

    // The chosen style's look, from the plugin that designed the looks; no
    // plugin, and the starter keeps the site's theme with the style recorded.
    // An AI starter brings its own look, so none is read for it.
    let theme = null
    if (styleId !== null && !starter) {
      await registerPluginServerDeclarations().catch((error: unknown) => {
        console.error('[hosts/starter] plugin declarations failed', error)
      })
      theme = await (resolveSiteStyleLooks()?.look(styleId) ?? Promise.resolve(null)).catch(
        (error: unknown) => {
          console.error('[hosts/starter] style look failed', error)
          return null
        },
      )
    }
    const result = await provisionStarterSite(firestore, hostId, {
      ...(styleId === null ? {} : { style: { id: styleId, theme } }),
      ...(starter ? { starter } : {}),
    })
    if (result.missing) return Response.json({ error: 'Unknown site' }, { status: 404 })
    if (result.provisioned) {
      // The holding page `/` answered until now is cached; the Home page is
      // live the moment it is written.
      await dropPluginSiteCache({ hostIds: [hostId], reason: 'starter site provisioned' })
      await logHostActivity(
        hostId,
        { uid: decoded.uid, email: decoded.email ?? null },
        'Started from the starter site',
        { type: 'screen', id: result.screenId ?? '', name: 'Home' },
      ).catch(() => undefined)
    }
    return Response.json(
      { provisioned: result.provisioned, screenId: result.screenId ?? null },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'The starter site could not be added' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
