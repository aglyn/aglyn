/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://acme.example.com/hosts"}
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
 * A workspace subdomain on a SELF-HOSTED install names its workspace, and the
 * path the switcher reads says so (AGL-3314).
 *
 * `acme.example.com/hosts` is served from `/acme/hosts`. The switcher read the
 * address bar's `/hosts` and looked for a workspace called "hosts". The
 * workspace domain and the console's own address are the install's
 * configuration, read when the modules load, so this file boots jsdom on the
 * subdomain and loads them fresh under that configuration — nothing here
 * knows Aglyn's domain.
 *
 * The docblock order is load-bearing: the environment pragma has to be in the
 * FIRST docblock, or the license header shadows it and the file silently runs
 * on `localhost`.
 */

type WorkspaceDomain = typeof import('../constants/workspace-domain')
type NavSection = typeof import('../hooks/nav-section')

let domain: WorkspaceDomain
let nav: NavSection

beforeAll(() => {
  jest.resetModules()
  process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN = 'example.com'
  process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://studio.example.com'
  domain = require('../constants/workspace-domain')
  nav = require('../hooks/nav-section')
})

afterAll(() => {
  delete process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN
  delete process.env.NEXT_PUBLIC_CONSOLE_URL
})

describe('on a self-hosted workspace subdomain', () => {
  it('boots jsdom on the subdomain — the premise of every case below', () => {
    expect(window.location.host).toBe('acme.example.com')
  })

  it('names the workspace from the host, by the install’s own domain', () => {
    expect(domain.currentWorkspaceSlug()).toBe('acme')
  })

  it('puts the workspace back in front of the path the switcher reads', () => {
    const host = nav.hostOrgSlugFor({
      subdomainSlug: domain.currentWorkspaceSlug(),
      paramOrgSlug: null,
      pathname: window.location.pathname,
    })
    expect(host).toBe('acme')
    const section = nav.resolveNavSection(nav.consolePathFor(window.location.pathname, host))
    expect(section).toEqual({ kind: 'org', base: '/acme', orgSlug: 'acme' })
  })

  it('names it on the not-found boundary too, where the route has no params', () => {
    // A path that matches no route still belongs to the workspace the host
    // names; it used to be read as a workspace called `no-such-page`.
    const host = nav.hostOrgSlugFor({
      subdomainSlug: domain.currentWorkspaceSlug(),
      paramOrgSlug: null,
      pathname: '/no-such-page',
    })
    expect(nav.resolveNavSection(nav.consolePathFor('/no-such-page', host)).orgSlug).toBe('acme')
  })

  it('leaves the console’s own label and the apex routes alone', () => {
    expect(domain.workspaceSlugFromHost('studio.example.com')).toBeNull()
    expect(nav.consolePathFor('/manage/user', 'acme')).toBe('/manage/user')
    expect(nav.consolePathFor('/signin', 'acme')).toBe('/signin')
  })
})
