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
 * THE PROBES' FRESH HOST SPELLINGS RESOLVE TO THE SITE (AGL-3571).
 *
 * The production canary (`tools/scripts/lib/prod-canary.mjs`) and the render
 * monitor (`render-monitor.ts`) render a REAL page with no cache entry by
 * naming its site, through `?tenantHost=`, with a spelling no visitor uses:
 * letters recased, trailing dots, the full `{sub}.aglyn.app` name, or
 * `cname--` with the domain recased. The `[host]` route segment is part of
 * the ISR key, and `normalizeHostAlias` resolves every one of those to the
 * same host record. That second half is what this pins.
 *
 * If the resolver ever stops lower-casing or stripping trailing dots, every
 * probe page 404s — and the canary grades a real page that 404s as the
 * DEPLOYMENT failing, which on enough hosts is a rollback. So a change here
 * that reds this spec must change both probes' spellings in the same commit.
 *
 * The literals are the ones both probe specs assert their own encoders
 * produce (the canary's is plain node and cannot be imported here).
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  hostConverter: {},
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
}))
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  tenantHostAliasTag: (alias: string) => `tenant-host-alias:${alias}`,
  withRenderCache: async ({ read }: { read: () => Promise<unknown> }) => read(),
}))

import { freshHostSpelling } from '@aglyn/tenant-data-admin/server/render-monitor'
import { normalizeHostAlias } from '../utils/get-host'

describe('the probes’ fresh host spellings (AGL-3571)', () => {
  it.each([
    // What both encoders produce for these numbers (pinned in their specs).
    ['ReAdy-to-roll.aglyn.app', 'ready-to-roll'],
    ['Ready-to-roll.aglyn.app.', 'ready-to-roll'],
    ['cname--AGlyn.com', 'cname--aglyn.com'],
    // Spellings measured rendering the real page on a production deployment
    // URL as a cache MISS, 2026-10-05.
    ['rEaDy-To-ROLL.AgLYN.aPp', 'ready-to-roll'],
    ['EdR-coNstruCTiON.AgLyn.app.', 'edr-construction'],
    ['cname--aglyN.Com', 'cname--aglyn.com'],
  ])('%s resolves to %s', (spelling, site) => {
    expect(normalizeHostAlias(spelling)).toBe(site)
  })

  it('every spelling the monitor makes of a site resolves to that site', () => {
    for (const [host, site] of [
      ['ready-to-roll.aglyn.app', 'ready-to-roll'],
      ['edr-construction.aglyn.app', 'edr-construction'],
      ['demo.aglyn.app', 'demo'],
      ['aglyn.com', 'cname--aglyn.com'],
    ] as const) {
      for (const n of [1, 2, 3, 1_000, 4_095, 4_096, 70_000, 1_048_577]) {
        expect([host, n, normalizeHostAlias(freshHostSpelling(host, n, 'aglyn.app'))]).toEqual([host, n, site])
      }
    }
  })

  it('keeps the custom-domain prefix lower-case, which the canonical redirect tests raw', () => {
    for (const n of [1, 77, 255]) {
      expect(freshHostSpelling('aglyn.com', n, 'aglyn.app').startsWith('cname--')).toBe(true)
    }
  })

  it('a port suffix is NOT a spelling: the route segment keeps it encoded and 404s', () => {
    // Measured, not resolved here: `?tenantHost=ready-to-roll%3A5` answered 404
    // on the deployment URL, so neither encoder may ever produce a colon.
    for (const n of [1, 99, 100_000]) {
      expect(freshHostSpelling('ready-to-roll.aglyn.app', n, 'aglyn.app')).not.toContain(':')
    }
  })
})
