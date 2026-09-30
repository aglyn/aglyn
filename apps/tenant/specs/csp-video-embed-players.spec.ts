/**
 * @jest-environment node
 *
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

/**
 * The published page's `frame-src` admits every declared video host's
 * player (AGL-3080).
 *
 * `security-origins.js` names no video host whose player the Video element
 * frames; the middleware hands it `videoEmbedPlayerOrigins()`, compiled from
 * the plugins' declarations. A middleware that stopped passing them would
 * refuse the frame on every site, and a visitor pressing play would get an
 * empty box with nothing red anywhere — so this reads the header the real
 * middleware sends.
 */

import { videoEmbedPlayerOrigins } from '@aglyn/aglyn/plugin-manager/video-embed-provider'
import { NextRequest } from 'next/server'

/** See `csp-no-script-src.spec.ts` — a `.aglyn.app` host redirects under jest. */
const HOST = 'demo.localhost:4500'

async function frameSrc(): Promise<string[]> {
  const { middleware } = await import('../middleware')
  const response = await middleware(
    new NextRequest(new URL('/', `https://${HOST}`), {
      headers: { host: HOST },
    }),
    {} as never,
  )
  if (!response || !('headers' in response)) {
    throw new Error('middleware returned no response — it redirected or fell through')
  }
  const policy = response.headers.get('Content-Security-Policy') ?? ''
  const directive = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('frame-src '))
  if (!directive) throw new Error(`no frame-src in the policy: ${policy}`)
  return directive.split(' ').slice(1)
}

describe('the tenant frame-src and the declared video hosts', () => {
  it('admits every declared player origin', async () => {
    const origins = videoEmbedPlayerOrigins()
    expect(origins.length).toBeGreaterThan(0)
    const sources = await frameSrc()
    for (const origin of origins) expect(sources).toContain(origin)
  })
})
