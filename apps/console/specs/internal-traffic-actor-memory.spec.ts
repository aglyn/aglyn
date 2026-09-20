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
 * The remembered internal actor (AGL-3007) — the half of the console stamp that
 * answers before the token does.
 *
 * The claims stamp lands after the boot burst, so a staff browser that was never
 * opted in reported one user and one session on every load; a phone always is
 * that browser. The memory closes it, and the two ways it could go wrong are
 * both silent and both permanent under an Active GA4 filter:
 *
 * 1. **It becomes sticky.** If only `true` were ever written, a customer signing
 *    in on a browser staff once used would be stamped for good — the exact
 *    failure `docs/ANALYTICS.md` §8 forbids for the override.
 * 2. **It leaks into the override.** The `?aglyn_internal` key is a deliberate
 *    declaration the release drills depend on; the memory must never write it.
 *
 * `internal-traffic-override.spec.ts` pins how the override composes with the
 * claims. This file pins the memory and where the layout consults it.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  INTERNAL_ACTOR_STORAGE_KEY,
  INTERNAL_TRAFFIC_STORAGE_KEY,
  INTERNAL_TRAFFIC_VALUE,
  readRememberedInternalActor,
  rememberInternalActor,
} from '../utils/internal-traffic'

/** A `localStorage` real enough for the memory. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key: string): string | null =>
      map.has(key) ? map.get(key)! : null,
    setItem: (key: string, value: string): void =>
      void map.set(key, String(value)),
    removeItem: (key: string): void => void map.delete(key),
    _map: map,
  }
}

describe('the remembered internal actor (AGL-3007)', () => {
  it('is not ours for a browser that has never read a staff token', () => {
    expect(readRememberedInternalActor(fakeStorage())).toBe(false)
  })

  it('remembers a staff token across loads', () => {
    const storage = fakeStorage()
    rememberInternalActor(true, storage)
    expect(readRememberedInternalActor(storage)).toBe(true)
  })

  it('is cleared by the next customer token, so it cannot become sticky', () => {
    // Failure mode 1. A memory that only ever wrote `true` would stamp every
    // later customer on this browser, and an Active filter deletes them.
    const storage = fakeStorage()
    rememberInternalActor(true, storage)
    rememberInternalActor(false, storage)
    expect(readRememberedInternalActor(storage)).toBe(false)
  })

  it('never writes or clears the ?aglyn_internal override', () => {
    // Failure mode 2. The drill opt-in has to survive a customer token.
    expect(INTERNAL_ACTOR_STORAGE_KEY).not.toBe(INTERNAL_TRAFFIC_STORAGE_KEY)
    const storage = fakeStorage({
      [INTERNAL_TRAFFIC_STORAGE_KEY]: INTERNAL_TRAFFIC_VALUE,
    })
    rememberInternalActor(true, storage)
    rememberInternalActor(false, storage)
    expect(storage.getItem(INTERNAL_TRAFFIC_STORAGE_KEY)).toBe(
      INTERNAL_TRAFFIC_VALUE,
    )
    expect(readRememberedInternalActor(storage)).toBe(false)
  })

  it('ignores a stored value that is not ours', () => {
    expect(
      readRememberedInternalActor(
        fakeStorage({ [INTERNAL_ACTOR_STORAGE_KEY]: 'external' }),
      ),
    ).toBe(false)
  })

  it('reads refused storage as not ours, and never throws', () => {
    const hostile = {
      getItem: (): string | null => {
        throw new Error('SecurityError')
      },
      setItem: (): void => {
        throw new Error('SecurityError')
      },
      removeItem: (): void => {
        throw new Error('SecurityError')
      },
    }
    expect(readRememberedInternalActor(hostile)).toBe(false)
    expect(() => rememberInternalActor(true, hostile)).not.toThrow()
    expect(readRememberedInternalActor(null)).toBe(false)
    expect(() => rememberInternalActor(true, null)).not.toThrow()
  })
})

const LAYOUT = resolve(
  __dirname,
  '../components/layouts/firebase-app.layout.tsx',
)

/** The layout explains all of this in prose; only CODE may be asserted on. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const source = stripComments(readFileSync(LAYOUT, 'utf8'))

/** The body of the effect that owns `traffic_type`, comments removed. */
function trafficEffect(): string {
  // Domain-wide since AGL-3175; this file cares where the read is, not how
  // it is spelled.
  const start = source.indexOf('readInternalTrafficOverrideForDomain(')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('}, [user])', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(source.lastIndexOf('useEffect', start), end)
}

describe('the layout consults the memory before the token (AGL-3007)', () => {
  it('reads the memory synchronously, at the top of the effect', () => {
    const body = trafficEffect()
    const read = body.search(
      /const\s+rememberedActor\s*=\s*readRememberedInternalActor\(\)/,
    )
    expect(read).toBeGreaterThan(-1)
    expect(read).toBeLessThan(body.indexOf('getIdTokenResult'))
  })

  it('stamps from the override OR the memory before the token is read', () => {
    // The whole fix: without the memory here, the boot burst — and the
    // `session_start` riding it — ships unstamped on every un-opted browser.
    const body = trafficEffect()
    const stamp = body.search(/stamp\(\s*override\s*\|\|\s*rememberedActor\s*\)/)
    expect(stamp).toBeGreaterThan(-1)
    expect(stamp).toBeLessThan(body.indexOf('getIdTokenResult'))
  })

  it('rewrites the memory from the claims, on the resolved branch only', () => {
    const body = trafficEffect()
    const writes = body.match(/\brememberInternalActor\(/g) ?? []
    // Exactly one write: a second one on the signed-out or rejected path would
    // clear a staff browser's memory for a reason that says nothing about who
    // is signed in.
    expect(writes).toHaveLength(1)
    const write = body.search(
      /rememberInternalActor\(\s*isInternalTrafficSession\(/,
    )
    expect(write).toBeGreaterThan(body.indexOf('.then('))
    expect(write).toBeLessThan(body.indexOf('.catch('))
  })

  it('never writes the override key from the layout', () => {
    expect(source).not.toMatch(/INTERNAL_TRAFFIC_STORAGE_KEY/)
    expect(source).not.toMatch(/localStorage\.setItem/)
  })
})
