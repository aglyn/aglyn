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
 * A job whose drafts another plugin writes is admitted on the OWNER the
 * draft-writer registry names (AGL-3080) — whichever plugin registered the
 * writer — never on a plugin id this plugin spells. So a writer registered by
 * a plugin with any id is honored exactly as the first-party one is, and a
 * resource nobody writes is refused without a lookup by name.
 */

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => 'org-1',
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: async (ids: readonly string[]) => [...ids],
}))

import {
  registerPluginResourceDraftWriter,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { aiPluginDraftAdmissionRefusal, aiPluginDraftOwner } from './ai-job-plugin-drafts'

const writer: PluginResourceDraftWriter = {
  refusal: async () => null,
  read: async () => null,
  write: async () => ({ id: 'x' }),
} as unknown as PluginResourceDraftWriter

const context = (enabledPlugins: string[]) =>
  ({
    orgId: 'org-1',
    hostId: 'host-1',
    uid: 'u-1',
    org: { enabledPlugins },
    firestore: {
      collection: () => ({ doc: () => ({ get: async () => ({ data: () => ({}) }) }) }),
    },
  }) as never

afterEach(() => unregisterPluginServices('acme-lists'))

describe('whose draft it is', () => {
  it('names the plugin that registered the writer, and nobody where none did', () => {
    registerPluginResourceDraftWriter('acmeList', writer, { pluginId: 'acme-lists' })
    expect(aiPluginDraftOwner('acmeList')).toBe('acme-lists')
    expect(aiPluginDraftOwner('nobodyWritesThis')).toBeNull()
  })

  it('admits the job when the registered owner runs on the site, whatever its id', async () => {
    registerPluginResourceDraftWriter('acmeList', writer, { pluginId: 'acme-lists' })
    await expect(
      aiPluginDraftAdmissionRefusal(context(['acme-lists']), {
        kind: 'campaign',
        drafts: [{ resource: 'acmeList', label: 'Lists' }],
      }),
    ).resolves.toBeNull()
  })

  it('refuses when the registered owner is switched off for the workspace', async () => {
    registerPluginResourceDraftWriter('acmeList', writer, { pluginId: 'acme-lists' })
    await expect(
      aiPluginDraftAdmissionRefusal(context(['email']), {
        kind: 'campaign',
        drafts: [{ resource: 'acmeList', label: 'Lists' }],
      }),
    ).resolves.toMatchObject({ status: 403, error: 'Turn on Lists for this site before starting the job.' })
  })

  it('refuses a resource no plugin writes here', async () => {
    await expect(
      aiPluginDraftAdmissionRefusal(context(['acme-lists']), {
        kind: 'campaign',
        drafts: [{ resource: 'acmeList', label: 'Lists' }],
      }),
    ).resolves.toMatchObject({ status: 403 })
  })
})
