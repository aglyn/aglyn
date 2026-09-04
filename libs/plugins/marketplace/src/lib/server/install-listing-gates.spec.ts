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
 * Every install door refuses a taken-down and a private listing (AGL-2290).
 *
 * The behaviour itself is asserted on a LIVE route in
 * `install-purchase-gate.spec.ts` (components) and, for plugins, by the
 * AGL-948/968 cases that shipped with those issues. What no test could see was
 * the *shape* of the defect: the gate existed on one of seven doors, and the
 * other six were only ever protected by the browse UI, which is not a control.
 *
 * So this guard derives the door list from the directory rather than restating
 * it. An install door is identified by what it does — it resolves a
 * marketplace listing and then gates content on `requirePurchase` — so a route
 * added under any name is in scope the day it lands.
 *
 * A substring guard proves presence, not correctness, and is worth exactly the
 * live tests standing beside it. Its job is different: to notice the SEVENTH
 * copy of a check going missing, which is the failure mode that put six of
 * them in this state.
 */

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const dir = __dirname
const sources = readdirSync(dir)
  .filter((name) => name.endsWith('.ts') && !name.includes('.spec.'))
  .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))

/**
 * The doors: every route that gates marketplace content on a purchase.
 * `purchase-entitlement.ts` defines the predicate rather than using it.
 */
const doors = sources.filter(
  (file) =>
    file.name !== 'purchase-entitlement.ts' &&
    /requirePurchase\s*\(\{/.test(file.text),
)

describe('every install door checks the listing, not just the buyer (AGL-2290)', () => {
  it('finds every door the repo has', () => {
    // Not vacuous. Nine exist today — the eight install routes plus
    // `update-artifact`, which hands over a NEW version of already-installed
    // content and is a content door by every property that matters here.
    expect(doors.map((file) => file.name).sort()).toEqual([
      'install-dataset-schema.ts',
      'install-email-starter.ts',
      'install-email-template.ts',
      'install-layout.ts',
      'install-plugin.ts',
      'install-template.ts',
      'install-theme.ts',
      'install.ts',
      'update-artifact.ts',
    ])
  })

  it.each(doors.length ? doors.map((file) => file.name) : ['<no doors found>'])(
    '%s refuses a taken-down listing',
    (name) => {
      const file = doors.find((entry) => entry.name === name)
      expect(file).toBeDefined()
      expect(file!.text).toContain('listing.hiddenAt')
    },
  )

  it.each(
    // `update-artifact` is deliberately absent: it only ever updates content
    // that is ALREADY installed on the site, so a private listing reaching it
    // was installed through a door that checked. Adding the test there would
    // assert a check the route does not need and should not grow.
    doors
      .filter((file) => file.name !== 'update-artifact.ts')
      .map((file) => file.name),
  )('%s refuses a private listing to a non-owner', (name) => {
    const file = doors.find((entry) => entry.name === name)
    expect(file).toBeDefined()
    expect(file!.text).toMatch(/isPrivateListing\(listing\) && !ownsListing/)
  })
})
