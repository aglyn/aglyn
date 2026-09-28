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
 *
 * @jest-environment node
 */

/**
 * Every publish door screens what it lists (AGL-3365).
 *
 * The same shape as the install-door sweep beside it: the doors are derived
 * from the directory — a route that asks `publishPreconditionRefusal` is a
 * route that puts something on the marketplace — so a publish door added
 * under any name is in scope the day it lands. The screen's behavior is
 * asserted in `listing-screen.spec.ts`; this notices a door without it.
 */

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const sources = readdirSync(__dirname)
  .filter((name) => name.endsWith('.ts') && !name.includes('.spec.'))
  .map((name) => ({ name, text: readFileSync(join(__dirname, name), 'utf8') }))

const doors = sources.filter(
  (file) =>
    file.name !== 'publish-preconditions.ts' && /publishPreconditionRefusal\(/.test(file.text),
)

describe('every publish door screens its submission (AGL-3365)', () => {
  it('finds every door the repo has', () => {
    expect(doors.map((file) => file.name).sort()).toEqual([
      'publish-dataset-schema.ts',
      'publish-email-starter.ts',
      'publish-email-template.ts',
      'publish-layout.ts',
      'publish-plugin.ts',
      'publish-template.ts',
      'publish-theme.ts',
      'publish.ts',
    ])
  })

  it.each(doors.map((file) => file.name))('%s screens before it writes the listing', (name) => {
    const text = doors.find((file) => file.name === name)!.text
    const screen = text.indexOf('listingSubmissionRefusal({')
    expect(screen).toBeGreaterThan(-1)
    // Before the write, not after: a hold that follows the publish is a
    // takedown, and the point is that nothing is listed.
    expect(screen).toBeLessThan(text.lastIndexOf('await listingRef.set('))
  })

  it('screens a listing edit and a publisher profile too', () => {
    const plugin = sources.find((file) => file.name === 'publish-plugin.ts')!.text
    const edit = plugin.slice(0, plugin.indexOf('const setListingVisibility'))
    expect(edit).toContain('listingSubmissionRefusal({')
    const profile = sources.find((file) => file.name === 'publisher-profile-save.ts')!.text
    expect(profile).toContain('publisherIdentityImpersonation(')
    expect(profile).toContain('listingSubmissionRefusal({')
  })
})
