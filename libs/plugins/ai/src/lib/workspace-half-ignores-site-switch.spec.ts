/**
 * @jest-environment node
 */
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
 * The workspace half of AI never asks a site's switch (AGL-3028).
 *
 * A site can switch AI off for itself; the workspace's AI add-on, its credits
 * and usage, its allotments, overage charging and close-out, the billing
 * events the webhook raises and the staff doors carry no site, and must keep
 * running whatever any one site decided. They are reached from places the
 * per-site gates are not — the billing webhook, the monthly usage sweep, the
 * staff area — so what keeps them running is that nothing on their paths
 * reads the switch. This holds that: a module on one of those paths that
 * starts consulting a site's plugin set fails here, where the reason is
 * written down, rather than as a workspace whose invoice stopped closing.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const LIB = __dirname

/** Every non-spec source file under a directory of this plugin. */
function sources(dir: string): string[] {
  return readdirSync(join(LIB, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** The paths of AI's workspace half. */
const WORKSPACE_HALF = [
  ...sources('billing'),
  ...sources('usage'),
  'declarations.server.ts',
  'server/billing-credits.ts',
  'server/billing-overage.ts',
  'server/ai-admin-org.ts',
  'server/ai-admin-orgs-spend.ts',
  'server/ai-admin-user.ts',
  'server/ai-admin-signals.ts',
  'server/ai-admin-overage.ts',
]

/** What reading a site's switch looks like, by any of its doors. */
const SITE_SWITCH = /ai-site-switch|isAiOffForSite|aiJobSiteRefusal|disabledPlugins|resolveHostEnabledPlugins|isHostPluginEnabled|getHostDisabledPlugins/

describe('the workspace half of AI never reads a site’s AI switch', () => {
  it('finds the files it names', () => {
    expect(sources('billing').length).toBeGreaterThan(3)
    expect(sources('usage').length).toBeGreaterThan(3)
  })

  it.each(WORKSPACE_HALF)('%s', (path) => {
    const text = readFileSync(join(LIB, path), 'utf8')
    expect({ path: relative(LIB, join(LIB, path)), reads: SITE_SWITCH.test(text) }).toEqual({
      path: relative(LIB, join(LIB, path)),
      reads: false,
    })
  })
})
