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

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * The geo header names are configuration, in BOTH deployment shapes
 * (AGL-2436).
 *
 * They were bare `x-vercel-*` literals. A self-host container has no edge
 * setting them and nothing else supplies the signal, so `readRequestGeo`
 * returned `null` for every request and the sanctions gate failed open on all
 * of them — logging that it did, once per instance, which is the only reason
 * this was visible at all.
 *
 * `GEO_COUNTRY_HEADER` is a MODULE-SCOPE constant, so asserting against an
 * already-imported binding only ever re-tests the default. Every case below
 * re-imports under `jest.resetModules()` (AGL-2022/AGL-2037's shape).
 */

const REPO_ROOT = resolve(__dirname, '../../../../..')

async function headersUnder(
  env: Record<string, string | undefined>,
): Promise<{ country: string; region: string }> {
  const saved = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    let mod!: typeof import('./request-geo')
    await jest.isolateModulesAsync(async () => {
      mod = await import('./request-geo')
    })
    return { country: mod.GEO_COUNTRY_HEADER, region: mod.GEO_REGION_HEADER }
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, saved)
  }
}

describe('request geo header names (AGL-2436)', () => {
  it('SELF-HOST: an operator names the headers their proxy sets', async () => {
    const names = await headersUnder({
      AGLYN_GEO_COUNTRY_HEADER: 'CF-IPCountry',
      AGLYN_GEO_REGION_HEADER: 'x-acme-region',
    })
    // Lower-cased: the value is echoed into `Vary`, which is not normalised
    // for us the way `Headers.get` is.
    expect(names.country).toBe('cf-ipcountry')
    expect(names.region).toBe('x-acme-region')
    // And ours is gone, not merely joined by theirs.
    expect(names.country).not.toContain('vercel')
    expect(names.region).not.toContain('vercel')
  })

  it('AGLYN-OPERATED: unset still reads Vercel edge headers', async () => {
    const names = await headersUnder({
      AGLYN_GEO_COUNTRY_HEADER: undefined,
      AGLYN_GEO_REGION_HEADER: undefined,
    })
    expect(names.country).toBe('x-vercel-ip-country')
    expect(names.region).toBe('x-vercel-ip-country-region')
  })

  it('an empty string is not a configured value', async () => {
    const names = await headersUnder({
      AGLYN_GEO_COUNTRY_HEADER: '',
      AGLYN_GEO_REGION_HEADER: '',
    })
    expect(names.country).toBe('x-vercel-ip-country')
    expect(names.region).toBe('x-vercel-ip-country-region')
  })

  it('a configured country header still reads the value off a request', async () => {
    const saved = process.env.AGLYN_GEO_COUNTRY_HEADER
    process.env.AGLYN_GEO_COUNTRY_HEADER = 'cf-ipcountry'
    try {
      let mod!: typeof import('./request-geo')
      await jest.isolateModulesAsync(async () => {
        mod = await import('./request-geo')
      })
      const geo = mod.readRequestGeo(new Headers({ 'cf-ipcountry': 'ir' }))
      // The whole point: a signal under the operator's own header name reaches
      // the sanctions gate, instead of every request looking like "no country".
      expect(geo.country).toBe('IR')
    } finally {
      if (saved === undefined) delete process.env.AGLYN_GEO_COUNTRY_HEADER
      else process.env.AGLYN_GEO_COUNTRY_HEADER = saved
    }
  })

  /**
   * The console's middleware imports the sanctions gate, and through it this
   * module, into the EDGE bundle — where `process.env` is not read at request
   * time and Next substitutes `process.env.NAME` at build. Both `next.config.js`
   * files must map the names, or the operator's configuration is silently
   * `undefined` in the one runtime that gates every console request.
   */
  it.each([
    ['apps/console/next.config.js'],
    ['apps/tenant/next.config.js'],
  ])('%s maps the geo header names into the build', (config) => {
    const source = readFileSync(join(REPO_ROOT, config), 'utf8')
    for (const name of [
      'AGLYN_GEO_COUNTRY_HEADER',
      'AGLYN_GEO_REGION_HEADER',
    ]) {
      if (!new RegExp(`^\\s*${name}: process\\.env\\.${name},`, 'm').test(source)) {
        throw new Error(
          `${config} does not map ${name} through its \`env\` block. ` +
            `apps/console/middleware.ts pulls request-geo into the edge bundle, where nothing reads ` +
            `process.env at request time — unmapped, an operator's configured header name is undefined ` +
            `and the sanctions gate goes back to failing open on every request (AGL-2436).`,
        )
      }
    }
  })

  it('the self-host template offers both names', () => {
    const template = readFileSync(join(REPO_ROOT, '.env.selfhost.example'), 'utf8')
    expect(template).toMatch(/^AGLYN_GEO_COUNTRY_HEADER=/m)
    expect(template).toMatch(/^AGLYN_GEO_REGION_HEADER=/m)
  })
})
