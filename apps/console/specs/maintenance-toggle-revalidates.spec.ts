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
 * Flipping maintenance mode drops the site's cached HTML (AGL-2690).
 *
 * `maintenance` is a client Firestore write read by the tenant loader, and the
 * pages that loader produces are ISR-cached. Without the drop the toggle
 * changed nothing a visitor could see until the page window expired — so the
 * console announced that visitors see the 503 screen while the site carried on
 * serving.
 *
 * The direction that makes this a bug rather than a delay is turning it OFF:
 * a site kept down after its owner brought it back is an outage they cannot
 * end. That is also why the window this now permits — an hour, raised from ten
 * minutes in the same change — would have made it four times worse.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CARD = join(
  __dirname,
  '..',
  'components',
  'error-screens-card.component.tsx',
)
const ROUTE = join(
  __dirname,
  '..',
  'app',
  'api',
  'screens',
  'revalidate',
  'route.ts',
)

describe('the toggle asks for the drop', () => {
  const source = readFileSync(CARD, 'utf8')
  const handler = source.slice(
    source.indexOf('const handleMaintenance'),
    source.indexOf('const errorScreens'),
  )

  it('reads the handler it means to assert on', () => {
    // A premise guard: a rename would otherwise leave every case below
    // matching an empty string and passing against nothing.
    expect(handler.length).toBeGreaterThan(200)
    expect(handler).toContain('updateDoc')
  })

  it('drops the WHOLE host, not a screen fan-out', () => {
    // Maintenance replaces every path, including addresses no screen document
    // holds — the sitemap, a feed, a collection entry's URL.
    expect(handler).toMatch(/revalidateLivePages\(\{[\s\S]{0,80}entireHost: true/)
  })

  it('AWAITS it, because the snackbar is a claim about what visitors see', () => {
    // The publish call sites fire this and move on; they can, because a
    // publish already succeeded. Here the write and the drop together are the
    // feature.
    expect(handler).toMatch(/await revalidateLivePages\(/)
    expect(handler).not.toMatch(/void revalidateLivePages\(/)
  })

  it('says something weaker when the drop did not land', () => {
    // A snackbar that promises the 503 screen is live when the cache still
    // holds the site is the original defect wearing a success message.
    expect(handler).toMatch(/landed/)
    expect(handler).toMatch(/take a few minutes/)
  })
})

describe('the route accepts it, and only when asked outright', () => {
  const source = readFileSync(ROUTE, 'utf8')

  it('reads entireHost from the payload', () => {
    expect(source).toMatch(/entireHost\?\?: unknown|entireHost\?: unknown/)
    expect(source).toMatch(/\)\?\.entireHost === true/)
  })

  it('calls revalidateEntireHost for it', () => {
    expect(source).toContain('revalidateEntireHost(firestore, hostId)')
  })

  /**
   * The guard that keeps this from becoming the default. A selector-less body
   * already 400s; turning that into a whole-site drop would make every
   * malformed caller pay for every page of a site.
   */
  it('still refuses a body that names nothing at all', () => {
    expect(source).toMatch(/!hostId \|\|\s*\(!entireHost &&/)
  })

  /**
   * Ordering, and it is the whole of the authorization argument: the branch
   * sits AFTER `mayRevalidate` and after the lockdown refusal, so it inherits
   * both rather than opening a path around them.
   */
  it('runs after the membership check and the lockdown refusal', () => {
    const authAt = source.indexOf('await mayRevalidate(decoded, hostSnapshot)')
    const lockAt = source.indexOf('const locked = await lockdownRefusal(')
    const dropAt = source.indexOf('if (entireHost) {')
    expect(authAt).toBeGreaterThan(-1)
    expect(lockAt).toBeGreaterThan(-1)
    expect(dropAt).toBeGreaterThan(lockAt)
    expect(lockAt).toBeGreaterThan(authAt)
  })
})
