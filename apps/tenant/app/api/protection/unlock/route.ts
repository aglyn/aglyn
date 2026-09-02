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

import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'
import { enrichGatedScreenPage } from '@aglyn/tenant-runtime/enrich-gated-page'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import { serverPluginLoader } from '../../../../utils/server-plugin-loader'
import {
  consumeRateLimit,
  visitorContentRefusal,
} from '@aglyn/tenant-data-admin'
import { createHash, timingSafeEqual } from 'crypto'
import {
  NO_CLIENT_ADDRESS_BUCKET,
  readClientIp,
} from '@aglyn/aglyn/app-utils/request-ip'

export const dynamic = 'force-dynamic'

// Brute-force limits (AGL-794). This was a per-instance Map, which on
// serverless resets every cold start and is kept per concurrent instance —
// so the real cap was roughly 10 × instances, and an attacker widened it just
// by going wider. A password guess is exactly the case worth paying a
// transaction for, so the counter is durable and global.
//
// Keyed per (screen, IP): a shared NAT shouldn't lock a whole office out of
// one site, and one IP shouldn't get a fresh budget per screen it attacks.
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 10

const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * Password unlock for protected screens (AGL-87): verifies the sha256 of
 * the supplied password against the screen doc and only then returns the
 * composed node tree — protected content never ships in static HTML.
 */
export async function POST(request: Request): Promise<Response> {
  const { hostId, screenId, password } = (await request
    .json()
    .catch(() => ({}))) as Record<string, unknown>
  if (
    typeof hostId !== 'string' ||
    typeof screenId !== 'string' ||
    typeof password !== 'string' ||
    !hostId ||
    !screenId
  ) {
    return json({ error: 'Invalid request' }, 400)
  }
  // This one guards a SECRET, so it keeps counting under the no-address bucket
  // rather than being skipped — a screen password with no attempt cap is a
  // password anyone can grind. The key already carries the site and the
  // screen, so an unreadable address shares one attempt budget per protected
  // screen and not one across the deployment.
  const ip = readClientIp(request.headers) ?? NO_CLIENT_ADDRESS_BUCKET
  const rate = await consumeRateLimit(`unlock:${hostId}:${screenId}:${ip}`, {
    limit: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,
  })
  if (!rate.allowed) {
    return Response.json(
      { error: 'Too many attempts' },
      {
        status: 429,
        headers: {
          'Retry-After': String(
            Math.max(1, Math.ceil((rate.resetMs - Date.now()) / 1000)),
          ),
        },
      },
    )
  }

  // A FULL takedown stops this route serving the site (AGL-2495). The
  // middleware's matcher excludes `/api`, so before this line a locked host
  // 503'd every page while this route still composed and returned the
  // protected screen's node tree to anyone holding the password — which is
  // the site continuing to publish through its own takedown. Placed AFTER
  // the brute-force counter so a lock cannot be used to mine free guesses,
  // and BEFORE the screen read so a locked host pays nothing.
  //
  // Read-only locks are untouched: `lockdownBlocks(state, 'read')` is true
  // only for `full`, so a site that is still serving still unlocks.
  const down = await visitorContentRefusal({ hostId })
  if (down) return down

  try {
    const screenRes = await getScreen({ hostId, screenId })
    const stored = (screenRes.screen as any)?.protection?.passwordHash
    if (!screenRes.screen || typeof stored !== 'string' || !stored) {
      return json({ error: 'Not protected' }, 404)
    }
    const supplied = createHash('sha256').update(password).digest('hex')
    const match =
      stored.length === supplied.length &&
      timingSafeEqual(
        Buffer.from(stored, 'utf8') as any,
        Buffer.from(supplied, 'utf8') as any,
      )
    if (!match) {
      return json({ error: 'Wrong password' }, 401)
    }
    const nodes = await composeScreenNodes({
      hostId,
      screenId,
      screen: screenRes.screen,
    })
    if (!nodes) return json({ error: 'Compose failed' }, 500)
    // The page's behavior travels with its nodes (AGL-2510). The loader ships
    // `nodes: null` for a protected screen, so its enricher slice — the
    // interactions the shared layout's nav opens on, above all — has nowhere
    // else to arrive from, and the unlocked page rendered the site's nav
    // without any of it. Withheld until the password verifies for the same
    // reason the nodes are: the slice describes the tree it was derived from.
    //
    // `ensureAll` is not decoration. Enrichers register when a plugin's
    // server surface loads, and this route is not the plugin dispatcher — no
    // plugin has loaded by this line, so without it `runSitePageEnrichers`
    // finds an empty registry and answers `{}` with no error at all.
    await serverPluginLoader.ensureAll(['tenantApi'])
    const enriched = await enrichGatedScreenPage({
      hostId,
      screenId,
      screen: screenRes.screen,
      nodes,
    })
    return json({ nodes, ...enriched })
  } catch (error) {
    console.error(error)
    return json({ error: 'Unlock failed' }, 500)
  }
}
