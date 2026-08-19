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

/**
 * AGL-2249: the Merchant Center feed URL is in the console, and it is the
 * URL the route actually answers on.
 *
 * Two halves, and the second is the one that decays. Showing *a* URL is easy;
 * showing the RIGHT one means the path in the card and the path the handler
 * is registered at have to stay the same string. They live in different files
 * with no type between them, so a rename of the route leaves a card
 * confidently publishing a 404 to Google — and every existing feed test would
 * still pass, because they exercise the handler directly.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hostPublicOrigin } from '@aglyn/aglyn'

const LIB = join(__dirname, '..', '..')

function source(relative: string): string {
  return readFileSync(join(LIB, relative), 'utf8')
}

const CARD = source('components/console/store-settings-card.component.tsx')

describe('AGL-2249 · the product feed has a console surface', () => {
  it('the card renders a feed URL at all', () => {
    expect(CARD).toContain('feedUrl')
    expect(CARD).toContain('Google Merchant Center feed URL')
  })

  it('the path it publishes is the path the route is registered at', () => {
    // The pairing that has no compiler between it. `commerce/feed` in
    // `server.ts`, `/api/commerce/feed` in the card.
    expect(source('server.ts')).toContain(
      `registerPluginApiRoute('commerce/feed', feedHandler)`,
    )
    expect(CARD).toContain(`/api/commerce/feed?hostId=`)
  })

  it('resolves the origin through hostPublicOrigin, not a built string', () => {
    // A site on a custom domain must be told ITS name: `feed.ts` builds every
    // item `<link>` from the REQUEST host, so submitting the .aglyn.app
    // address for a store serving on its own domain puts the wrong domain on
    // every product in Merchant Center.
    expect(CARD).toContain('hostPublicOrigin(host)')
    expect(CARD).not.toMatch(/https:\/\/\$\{[^}]*subdomain/)
  })

  it('offers nothing rather than half a URL when the host has no address', () => {
    // `hostPublicOrigin` answers undefined for a host with neither a cname
    // nor a subdomain, and a copy button that yields `undefined/api/...` is
    // worse than an explanation.
    expect(hostPublicOrigin({})).toBeUndefined()
    expect(hostPublicOrigin({ subdomain: 'shop' })).toMatch(/^https:\/\/shop\./)
    expect(hostPublicOrigin({ cname: 'shop.example.com' })).toBe(
      'https://shop.example.com',
    )
    expect(CARD).toContain('Publish this site to a subdomain or custom domain')
  })

  it('the handler still keys off hostId, which is what the card passes', () => {
    // If the feed ever moved to a path segment the card's query string would
    // silently stop selecting a store, and the feed would 400 for everyone.
    expect(source('server/feed.ts')).toContain(`req.query.hostId`)
  })
})
