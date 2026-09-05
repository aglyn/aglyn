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

import { crmTaskReadTokens } from './task-scope'

/**
 * The tokens every task listener filters on (AGL-2599). A listener without
 * this clause is refused by the rules outright, and one with the wrong set
 * either misses a sibling site's tasks or is refused for asking too widely —
 * so the set is pinned for the three shapes an org comes in.
 */
describe('crmTaskReadTokens', () => {
  it('is the org token plus the site itself when the site is in no group', () => {
    expect(crmTaskReadTokens(null, 'site-1')).toEqual(['org', 'host:site-1'])
    expect(crmTaskReadTokens({}, 'site-1')).toEqual(['org', 'host:site-1'])
  })

  it('carries every sibling in a declared consent group', () => {
    const org = {
      consentGroups: {
        brand: { name: 'Brand', hostIds: ['site-1', 'site-2', 'site-3'] },
      },
    }
    expect(crmTaskReadTokens(org, 'site-2')).toEqual([
      'org',
      'host:site-1',
      'host:site-2',
      'host:site-3',
    ])
    // A site outside the group is still the group of one.
    expect(crmTaskReadTokens(org, 'site-9')).toEqual(['org', 'host:site-9'])
  })

  it('reads the same set whatever the org chose as its creation default', () => {
    // `defaultResourceScope: 'org'` changes what a CREATE stamps, not what a
    // read asks for: the org token is in every read set already.
    expect(crmTaskReadTokens({ defaultResourceScope: 'org' }, 'site-1')).toEqual([
      'org',
      'host:site-1',
    ])
  })
})
