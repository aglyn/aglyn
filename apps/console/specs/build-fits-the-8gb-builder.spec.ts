/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
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
 * The console's production build keeps Turbopack's build cache off
 * (AGL-3570).
 *
 * Vercel builds the console on an 8 GB machine. With Next 16.3's default
 * build cache on, the `next-build` process peaked at 8.3 GB on a cold
 * console build. Vercel also restored the cache into the next build. The
 * build then stalled with no error, at "Collecting page data" in one deploy
 * and in the compile in the next, until the 45-minute limit. With the cache
 * off, the same build peaked at 6.3 GB.
 *
 * The flag lives in the shared `with-aglyn.nextjs.config.js`. This reads it
 * from the config the console actually ships, so a console `next.config.js`
 * that overrides `experimental` or stops wrapping with `withAglyn` fails
 * here too.
 */

// The console config vendors Monaco into `public/` at load (AGL-1779). That
// is a build step, not a test fixture.
jest.mock('../../../tools/scripts/lib/sync-monaco-assets', () => ({
  syncMonacoAssets: jest.fn(),
}))

import { readFileSync } from 'fs'
import { dirname, join } from 'path'

/** The console's own config, i.e. the one Vercel builds. */
const nextConfigPhase = require('../next.config.js')

/** The installed Next's compiled sources, read as text. */
const nextDist = (relative: string): string =>
  readFileSync(
    join(dirname(require.resolve('next/package.json')), 'dist', relative),
    'utf8',
  )

describe('the console build fits the 8 GB builder (AGL-3570)', () => {
  it('PREMISE — the installed Next turns the build cache on unless told not to', () => {
    // If Next stops defaulting this to true, the setting below is no longer
    // load-bearing. If the build stops reading the flag, it no longer does
    // anything. Either way this spec needs another look.
    expect(nextDist('server/config-shared.js')).toMatch(
      /turbopackFileSystemCacheForBuild:\s*true/,
    )
    expect(nextDist('build/turbopack-build/impl.js')).toContain(
      'turbopackFileSystemCacheForBuild',
    )
  })

  it('ships with the Turbopack build cache turned off', async () => {
    const config = await nextConfigPhase('phase-production-build', {
      defaultConfig: {},
    })

    expect(config.experimental?.turbopackFileSystemCacheForBuild).toBe(false)
  })
})
