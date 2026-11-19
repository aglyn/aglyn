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

import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { pageEditorUrl } from './api-v1-page-links'

describe('pageEditorUrl (AGL-4235)', () => {
  const page = { orgSlug: 'acme', subdomain: 'shop', pageId: 'home', versionId: 'v2', origin: 'https://app.example.com' }

  it('opens the page’s draft in the editor, on the console’s own route', () => {
    expect(pageEditorUrl({ ...page, draft: true })).toBe(
      `https://app.example.com${buildRoute(Route.SCREEN_BESIGNER, { orgSlug: 'acme', host: 'shop', screenId: 'home', versionId: 'v2' })}?draft=open`,
    )
    expect(pageEditorUrl({ ...page, draft: true })).toBe('https://app.example.com/acme/hosts/shop/screens/home/versions/v2/besigner?draft=open')
  })

  it('opens the version itself when there is no draft to open', () => {
    expect(pageEditorUrl({ ...page, draft: false })).toBe('https://app.example.com/acme/hosts/shop/screens/home/versions/v2/besigner')
  })

  it('answers no link without a workspace slug or a site subdomain', () => {
    expect(pageEditorUrl({ ...page, orgSlug: undefined, draft: true })).toBeNull()
    expect(pageEditorUrl({ ...page, subdomain: '', draft: true })).toBeNull()
  })

  it('falls back to the deployment’s console origin', () => {
    expect(pageEditorUrl({ ...page, origin: undefined, draft: true })).toMatch(/^https?:\/\/[^/]+\/acme\/hosts\/shop\/screens\/home\/versions\/v2\/besigner\?draft=open$/)
  })
})
