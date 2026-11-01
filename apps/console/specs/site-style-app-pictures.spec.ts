/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file: Jest reads the pragma only
 * from the opening docblock.
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
 * The site style pictures reach the native apps (AGL-4049).
 *
 * Measured on 2026-11-01 from production: a client that cannot solve a bot
 * challenge is answered `429` with `x-vercel-mitigated: challenge` on
 * `/_static/starter/styles/*`, and reaches the app on `/api/media/cdn/*`. So
 * Create site's cards would have shown placeholders in every store build while
 * every seeded-stack drive showed them fine: the local console has no firewall.
 *
 * The config is read from what Vercel builds, as `static-security-headers.spec`
 * does.
 */

// The console config vendors Monaco into `public/` at load (AGL-1779). That
// is a build step, not a test fixture.
jest.mock('../../../tools/scripts/lib/sync-monaco-assets', () => ({
  syncMonacoAssets: jest.fn(),
}))

import { SITE_STYLE_APP_PREVIEW_DIR, SITE_STYLE_PREVIEW_DIR } from '@aglyn/aglyn/app-utils/site-styles'

/** The console's own config, i.e. the one Vercel builds. */
const nextConfigPhase = require('../next.config.js')

type Rewrite = { source: string; destination: string }

const shippedRewrites = async (): Promise<Rewrite[]> => {
  const config = await nextConfigPhase('phase-production-build', { defaultConfig: {} })
  return (await config.rewrites()) as Rewrite[]
}

describe('the site style pictures as an app reads them', () => {
  const projectId = process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID']

  afterEach(() => {
    if (projectId === undefined) delete process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID']
    else process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID'] = projectId
  })

  it('rewrites the public media path onto the directory the pictures are in, file for file', async () => {
    process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID'] = 'demo-aglyn'
    expect(await shippedRewrites()).toContainEqual({
      source: `${SITE_STYLE_APP_PREVIEW_DIR}/:file`,
      destination: `${SITE_STYLE_PREVIEW_DIR}/:file`,
    })
  })

  it('keeps it without a Firebase project, and keeps the auth helpers beside it', async () => {
    delete process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID']
    expect((await shippedRewrites()).map((rule) => rule.source)).toEqual([`${SITE_STYLE_APP_PREVIEW_DIR}/:file`])

    process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID'] = 'demo-aglyn'
    expect((await shippedRewrites()).map((rule) => rule.source)).toContain('/__/:path*')
  })

  it('takes one file name, so nothing else under `/_static` is reachable from it', async () => {
    const [rule] = (await shippedRewrites()).filter((entry) => entry.source.startsWith(SITE_STYLE_APP_PREVIEW_DIR))
    expect(rule?.source).toMatch(/\/:file$/)
    expect(rule?.destination).toMatch(/\/styles\/:file$/)
  })
})
