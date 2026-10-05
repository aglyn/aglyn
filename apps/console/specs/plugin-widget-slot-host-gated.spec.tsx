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
 * A ZONE ITS HOST GATES (AGL-3554).
 *
 * The Email plugin's console extension is gated on "Manage data", for the
 * audiences its page lists. Its site email preview in a site package
 * import's side-by-side diff draws only the item the import hands it, on a
 * card already gated on what the import itself requires — so in the
 * `sitePackageItemPreview` zone the extension's permission is not asked,
 * and the person importing the package sees the email they are importing.
 * Everywhere else the extension's permission still closes its widgets.
 */

import { renderHook } from '@testing-library/react'

function mockPreview() {
  return null
}

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  listConsoleWidgets: (slot: string) => [
    {
      extension: { pluginId: 'email', permission: 'data.manage' },
      widget: { slot, widgetId: `email-${slot}`, itemKinds: ['siteEmail'], Component: mockPreview },
    },
  ],
}))
jest.mock('../hooks/use-console-plugins', () => ({ useConsoleSlotPlugins: () => true }))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['email'],
  usePluginLoadScope: () => ({ orgId: null, user: undefined }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: 'org-1', plan: 'pro' }, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  // A site editor importing a package: no "Manage data".
  default: () => ({ permissions: {}, can: () => false, loaded: true }),
}))

import { useSlotWidgets } from '../components/plugin-widget-slot.component'

describe('a zone its host gates (AGL-3554)', () => {
  it('draws a widget whose extension’s permission the reader lacks', () => {
    const { result } = renderHook(() => useSlotWidgets(['sitePackageItemPreview']))
    expect(result.current.widgets.map((widget) => widget.widgetId)).toEqual(['email-sitePackageItemPreview'])
  })

  it('CONTROL: keeps the extension’s permission in every other zone', () => {
    const { result } = renderHook(() => useSlotWidgets(['campaignDesignPreview']))
    expect(result.current.widgets).toEqual([])
  })
})
