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

/*==========================================
 * A PLUGIN THAT REGISTERS AFTER THE MEMBER DOCUMENT ARRIVED (AGL-3228 #5).
 *
 * The owner opened a Sequences deep link on a cold load and was told they
 * had no permission to open it, with the tab gone from the nav; a reload
 * showed the page. The order that produces it: the member read settles
 * first, the provider resolves its permission map against the registries
 * as they stand, and the plugin's chunk registers `outreach.use` a moment
 * later. Nothing re-rendered the provider, so every reader kept a map
 * without the key, and an absent key is a refusal.
 *
 * The provider now subscribes to both registries. These specs drive the
 * real provider through the real resolvers, register the key AFTER the
 * read settled, and require the verdict to follow.
 *==========================================*/

import { act, render, screen, waitFor } from '@testing-library/react'

let mockMemberDoc: Record<string, unknown>

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: async (ref: { path: string }) => {
    if (ref.path.includes('/roles/')) {
      return { exists: () => false, data: () => undefined, get: () => undefined }
    }
    return {
      exists: () => true,
      data: () => mockMemberDoc,
      get: (key: string) => (mockMemberDoc as never)?.[key],
    }
  },
}))

const FIRESTORE = {}
const USER = { uid: 'u1' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: USER }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => ({ currentOrg: { $id: 'org-1' }, loading: false }),
  useOrgSlug: () => 'acme',
}))

import { registerPluginPermissions } from '@aglyn/aglyn'
import useOrgPermissions, { OrgPermissionsProvider } from '../hooks/use-org-permissions'
import { resolveExtensionPermission } from '../utils/extension-permission'

/** A reader gated the way the plugin route gates a surface. */
function Surface(props: { requires: string }) {
  const { can, permissions, loaded } = useOrgPermissions()
  const verdict = resolveExtensionPermission([props.requires], { can, permissions, loaded })
  return <span>{`verdict:${verdict}`}</span>
}

beforeEach(() => {
  mockMemberDoc = { role: 'owner' }
})

describe('a plugin permission registered after the member read settled', () => {
  it('is granted to the owner without a reload', async () => {
    render(
      <OrgPermissionsProvider>
        <Surface requires="lateplugin.use" />
      </OrgPermissionsProvider>,
    )
    // The read settles first. The key is not registered, so it is refused —
    // the same answer a typo gets, and the right one for a key nobody owns.
    await waitFor(() => expect(screen.getByText('verdict:refused')).toBeTruthy())

    // Then the plugin's chunk lands and registers, as on a cold deep link.
    act(() => {
      registerPluginPermissions([
        {
          key: 'lateplugin.use',
          pluginId: 'lateplugin',
          label: 'Use late plugin',
          defaults: { admin: true, editor: false, viewer: false },
        },
      ])
    })
    await waitFor(() => expect(screen.getByText('verdict:granted')).toBeTruthy())
  })

  it('still refuses a member whose tier does not hold the late key', async () => {
    mockMemberDoc = { role: 'viewer' }
    render(
      <OrgPermissionsProvider>
        <Surface requires="lateplugin.viewer-gate" />
      </OrgPermissionsProvider>,
    )
    await waitFor(() => expect(screen.getByText('verdict:refused')).toBeTruthy())
    act(() => {
      registerPluginPermissions([
        {
          key: 'lateplugin.viewer-gate',
          pluginId: 'lateplugin',
          label: 'Viewer-gated',
          defaults: { admin: true, editor: false, viewer: false },
        },
      ])
    })
    // A re-render on registration must not turn into a grant by itself.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('verdict:refused')).toBeTruthy()
  })
})
