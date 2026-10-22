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

import { stripWorkspaceOrgPrefix } from './workspace-href'

const on = { orgSlug: 'acme', onWorkspaceSubdomain: true }

describe('stripWorkspaceOrgPrefix', () => {
  it('drops the org segment on that org’s own subdomain', () => {
    expect(stripWorkspaceOrgPrefix('/acme/hosts/shop', on)).toBe('/hosts/shop')
    expect(stripWorkspaceOrgPrefix('/acme/billing', on)).toBe('/billing')
    expect(stripWorkspaceOrgPrefix('/acme/hosts/shop/screens/list', on)).toBe(
      '/hosts/shop/screens/list',
    )
  })

  it('returns / for the org root rather than an empty href', () => {
    expect(stripWorkspaceOrgPrefix('/acme', on)).toBe('/')
  })

  it('never strips another org’s slug', () => {
    // The dangerous case: stripping here would silently retarget a
    // cross-org link at the current workspace.
    expect(stripWorkspaceOrgPrefix('/other-org/hosts/shop', on)).toBe(
      '/other-org/hosts/shop',
    )
  })

  it('only matches whole segments', () => {
    expect(stripWorkspaceOrgPrefix('/acme-labs/hosts/shop', on)).toBe(
      '/acme-labs/hosts/shop',
    )
  })

  it('leaves apex routes alone — they are not org-scoped', () => {
    expect(stripWorkspaceOrgPrefix('/manage/user', on)).toBe('/manage/user')
    expect(stripWorkspaceOrgPrefix('/admin/overview', on)).toBe(
      '/admin/overview',
    )
    expect(stripWorkspaceOrgPrefix('/signin', on)).toBe('/signin')
  })

  it('is inert on the apex host and without a slug', () => {
    expect(
      stripWorkspaceOrgPrefix('/acme/hosts/shop', {
        orgSlug: 'acme',
        onWorkspaceSubdomain: false,
      }),
    ).toBe('/acme/hosts/shop')
    expect(
      stripWorkspaceOrgPrefix('/acme/hosts/shop', {
        onWorkspaceSubdomain: true,
      }),
    ).toBe('/acme/hosts/shop')
  })

  it('leaves absolute URLs untouched', () => {
    expect(stripWorkspaceOrgPrefix('https://x.test/acme/a', on)).toBe(
      'https://x.test/acme/a',
    )
  })
})
