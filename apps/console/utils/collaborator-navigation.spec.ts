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
  collaboratorLanding,
  collaboratorRedirect,
  isSitePath,
} from './collaborator-navigation'

const ORG = 'acme'
const ONE = [{ $id: 'h1', subdomain: 'northwind' }]
const TWO = [
  { $id: 'h1', subdomain: 'northwind' },
  { $id: 'h2', subdomain: 'contoso' },
]

describe('isSitePath', () => {
  it('is a site only below the third segment', () => {
    // `/acme/hosts` is the org's Sites TAB; `/acme/hosts/x` is a site.
    expect(isSitePath('/acme/hosts', ORG)).toBe(false)
    expect(isSitePath('/acme/hosts/northwind', ORG)).toBe(true)
    expect(isSitePath('/acme/hosts/northwind/screens/list', ORG)).toBe(true)
  })

  it('ignores another org and the non-org sections', () => {
    expect(isSitePath('/other/hosts/northwind', ORG)).toBe(false)
    expect(isSitePath('/manage/user', ORG)).toBe(false)
  })
})

describe('collaboratorLanding', () => {
  it('goes straight into the site when there is exactly one', () => {
    expect(collaboratorLanding(ORG, ONE)).toBe('/acme/hosts/northwind')
  })

  it('offers the list for several sites, or none', () => {
    expect(collaboratorLanding(ORG, TWO)).toBe('/acme/hosts')
    expect(collaboratorLanding(ORG, [])).toBe('/acme/hosts')
  })

  it('falls back to the list when the one site has no subdomain', () => {
    // The `[host]` segment is the subdomain; a projection row without one
    // would build `/acme/hosts/undefined`.
    expect(collaboratorLanding(ORG, [{ $id: 'h1' }])).toBe('/acme/hosts')
  })
})

describe('collaboratorRedirect', () => {
  it('moves a collaborator off every org page', () => {
    for (const page of [
      '/acme',
      '/acme/team',
      '/acme/billing',
      '/acme/media',
      '/acme/data',
      '/acme/settings',
      '/acme/marketplace/listing-1',
    ]) {
      expect(collaboratorRedirect(page, ORG, TWO)).toBe('/acme/hosts')
    }
  })

  it('leaves them alone inside a site', () => {
    expect(
      collaboratorRedirect('/acme/hosts/northwind/screens/list', ORG, ONE),
    ).toBeNull()
  })

  it('skips a list of one', () => {
    expect(collaboratorRedirect('/acme/hosts', ORG, ONE)).toBe(
      '/acme/hosts/northwind',
    )
  })

  it('keeps the list when there are several sites', () => {
    // The load-bearing case: returning the list URL *from* the list URL is an
    // infinite replace() loop.
    expect(collaboratorRedirect('/acme/hosts', ORG, TWO)).toBeNull()
  })

  it('keeps the list — and its empty state — for a collaborator with none', () => {
    // A revoked grant, or a projection that has not caught up. "Into their
    // site" has no answer here, and inventing one loops.
    expect(collaboratorRedirect('/acme/hosts', ORG, [])).toBeNull()
  })

  it('never moves a path outside this org', () => {
    expect(collaboratorRedirect('/manage/user', ORG, ONE)).toBeNull()
    expect(collaboratorRedirect('/admin/overview', ORG, ONE)).toBeNull()
    expect(collaboratorRedirect(null, ORG, ONE)).toBeNull()
  })
})
