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

import {
  getMobileDeepLinks,
  getMobileQuickActions,
  getMobileScreens,
  getMobileTabs,
  resetMobileRegistry,
  resolveMobileLink,
} from '@aglyn/mobile-plugin-host'
import { registerWorkspaceMobile } from '../index'

describe('the workspace registration', () => {
  beforeEach(() => {
    resetMobileRegistry()
    registerWorkspaceMobile()
  })

  it('registers its screens, the Sites tab and two quick actions, all as `workspace`', () => {
    expect(getMobileScreens().map((screen) => screen.id).sort()).toEqual([
      'workspace.media',
      'workspace.mediaItem',
      'workspace.member',
      'workspace.site',
      'workspace.sites',
      'workspace.team',
    ])
    expect(getMobileTabs()).toEqual([
      expect.objectContaining({ id: 'workspace.sites-tab', screen: 'workspace.sites', order: 10, icon: 'globe-outline' }),
    ])
    expect(getMobileQuickActions().map((action) => [action.id, action.screen])).toEqual([
      ['workspace.media-open', 'workspace.media'],
      ['workspace.team-open', 'workspace.team'],
    ])
    for (const screen of getMobileScreens()) expect(screen.pluginId).toBe('workspace')
  })

  it('is a no-op the second time (fast refresh)', () => {
    const before = getMobileScreens().length + getMobileDeepLinks().length
    expect(() => registerWorkspaceMobile()).not.toThrow()
    expect(getMobileScreens().length + getMobileDeepLinks().length).toBe(before)
  })

  it.each([
    ['https://app.aglyn.com/acme/hosts', 'workspace.sites', { orgSlug: 'acme' }],
    ['/acme/media', 'workspace.media', { orgSlug: 'acme' }],
    ['/acme/hosts/shop/media', 'workspace.media', { orgSlug: 'acme', hostSlug: 'shop' }],
    ['/acme/team', 'workspace.team', { orgSlug: 'acme' }],
    ['/acme/team/members', 'workspace.team', { orgSlug: 'acme' }],
    ['/acme/team/u-42', 'workspace.member', { orgSlug: 'acme', uid: 'u-42' }],
  ])('opens %s natively', (link, screen, params) => {
    expect(resolveMobileLink(link, getMobileDeepLinks())).toEqual({ kind: 'screen', screen, params })
  })

  it("leaves a site's dashboard and the bare root to the console", () => {
    expect(resolveMobileLink('/acme/hosts/shop', getMobileDeepLinks())).toEqual({
      kind: 'console',
      path: '/acme/hosts/shop',
    })
    expect(resolveMobileLink('/', getMobileDeepLinks())).toEqual({ kind: 'console', path: '/' })
  })
})
