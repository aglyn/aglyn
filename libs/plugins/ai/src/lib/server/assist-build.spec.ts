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
 *
 * @jest-environment node
 */

/**
 * The chat's build rung (AGL-3616) as the chat is told it: what a build can
 * make on this site, and what it says when asked for a theme change it
 * cannot make here (AGL-4077).
 */

jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: async (ids: readonly string[]) => [...ids],
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => null,
}))

import { AI_OWNED_CAPABILITIES, aiBuildOps } from '../jobs/ai-build-capabilities'
import { assistBuildBlock, assistBuildIntents, assistBuildIntentsBlock } from './assist-build'

const THEME_INTENT = AI_OWNED_CAPABILITIES.find((one) => one.op === 'theme')?.intents[0] as string

const firestore = {
  collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({ orgId: 'org-1' }) }) }) }),
} as unknown as FirebaseFirestore.Firestore

const intentsFor = (org: Record<string, unknown>) =>
  assistBuildIntents(firestore, { orgId: 'org-1', hostId: 'host-1', org }, {
    hasBuildRunner: () => true,
    ops: (context) =>
      aiBuildOps(context, {
        capabilities: () => AI_OWNED_CAPABILITIES.map((capability) => ({ pluginId: 'ai', capability })),
        hasRunner: () => true,
        releasedPlugins: async (ids) => ids,
        writerOwner: () => null,
      }),
  })

describe('a theme change asked of a build from the chat', () => {
  it('is offered on a paid plan, as a proposal applied in Setup → Theme', async () => {
    const intents = await intentsFor({ plan: 'pro', billingStatus: 'active' })
    expect(intents).toContain(THEME_INTENT)
    expect(assistBuildIntentsBlock(intents ?? [])).toContain(`- ${THEME_INTENT}`)
  })

  it('is not offered on the Free plan', async () => {
    const intents = await intentsFor({ plan: 'free' })
    expect(intents).not.toContain(THEME_INTENT)
    expect(intents?.length).toBeGreaterThan(0)
  })

  it('is answered, where it is not offered, with why and where to change the theme instead', () => {
    expect(assistBuildBlock().split('\n')).toContain(
      '- A change to the site’s theme or look (its colors, fonts or corners) is offered only where the "A build here can make" block lists it, which it does on paid plans. When it is asked for and not listed, say a build cannot change the theme on this workspace’s plan and that they can change it in Setup → Theme, where the Theme assistant can propose one; then build the rest.',
    )
  })
})
