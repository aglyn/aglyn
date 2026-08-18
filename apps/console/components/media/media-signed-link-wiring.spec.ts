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
 * AGL-2055: `POST /api/media/sign` reaches the console.
 *
 * The route has minted a fifteen-minute URL for a private asset since
 * AGL-1051, and until this issue NOTHING in `apps/console` called it. The
 * capability existed, the docs described it, the "Make private" confirmation
 * promised it, and the only menu item that could have produced a link —
 * `Copy URL` — deliberately hides itself for a private asset. So a file
 * marked private could not be fetched from the console at all.
 *
 * This asserts the WIRE, not the route: a route with no caller is exactly
 * the defect, so a test that exercises the endpoint would have passed
 * throughout the period the feature was unreachable.
 *
 * Asserted over stripped source for the reason its siblings do: the
 * additions carry comments that NAME `/api/media/sign`, so a raw-text
 * assertion would be satisfied by the sentence explaining the call.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { code } from '../../specs/source-text'

const LIBRARY = code(
  readFileSync(join(__dirname, 'media-library.component.tsx'), 'utf8'),
  'media-library.component.tsx',
)

const CARD = code(
  readFileSync(join(__dirname, 'media-asset-card.component.tsx'), 'utf8'),
  'media-asset-card.component.tsx',
)

describe('the private-asset link is reachable from the DAM', () => {
  it('the library actually calls POST /api/media/sign', () => {
    expect(LIBRARY).toContain(`'/api/media/sign'`)
  })

  it('it sends the orgId and mediaId the route requires', () => {
    const start = LIBRARY.indexOf('const handleCopySignedLink = useCallback(')
    expect(start).toBeGreaterThan(-1)
    const body = LIBRARY.slice(start, LIBRARY.indexOf('\n  )', start))
    expect(body).toContain('/api/media/sign')
    expect(body).toContain('JSON.stringify({ orgId, mediaId })')
    // Bearer, not a cookie: the route verifies an ID token and returns 401
    // without one.
    expect(body).toContain('Authorization: `Bearer ${idToken}`')
  })

  it('the handler is wired onto the grid card, not merely declared', () => {
    // The bug class this issue sweeps is a capability that exists and is
    // never invoked. A declared-but-unwired handler is the same defect one
    // layer in, so the wire is asserted separately from the declaration.
    expect(LIBRARY).toContain('onCopySignedLink={')
    expect(LIBRARY).toContain('handleCopySignedLink(media)')
  })

  it('the card renders the item only for a private asset', () => {
    expect(CARD).toContain('onCopySignedLink && media.private')
    // And the permanent-URL item stays hidden for one — a private asset has
    // no permanent URL, which is why this item had to exist.
    expect(CARD).toContain('onCopyUrl && !media.private')
  })
})
