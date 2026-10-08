/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A host artifact the rules let only staff create is created through
 * `/api/hosts/resources` (AGL-3668).
 *
 * `hosts/{hostId}/templates` allows `create` to staff alone, and the host
 * catch-all excludes `templates`, so the Templates page's direct `setDoc`
 * was refused for every member who is not staff. Components already went
 * through the route for the same reason; this holds all three create pages
 * to it, and to the resource the route expects.
 */
const PAGES: Array<[string, string]> = [
  ['templates', 'template'],
  ['components', 'reusableComponent'],
  ['layouts', 'layout'],
]

describe('host artifact creates go through the resources route', () => {
  it.each(PAGES)('%s page creates with resource %s and no direct setDoc', (dir, resource) => {
    const source = readFileSync(
      join(__dirname, '..', 'app', '(app)', '[orgSlug]', 'hosts', '[host]', dir, 'page.tsx'),
      'utf8',
    )
    expect(source).toContain(`resource: '${resource}'`)
    expect(source).not.toMatch(/\bsetDoc\s*\(/)
  })

  it('the rules still keep template creates to staff', () => {
    const rules = readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.rules'), 'utf8')
    const block = rules.slice(rules.indexOf('match /templates/{templateId} {'))
    expect(block.slice(0, block.indexOf('\n      }'))).toMatch(/allow create: if isStaff\(\);/)
  })
})
