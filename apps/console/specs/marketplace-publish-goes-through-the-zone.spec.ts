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
 * THE CONSOLE NEVER POSTS A MARKETPLACE PUBLISH ITSELF (AGL-3407).
 *
 * Every publish carries the Marketplace Publisher Agreement, ticked in the
 * box above Publish (AGL-4105), and the routes refuse one that does not. The
 * box lives in the marketplace plugin's publish widget, drawn through the
 * `hostArtifactPublish` zone — which an app may not import, only draw.
 *
 * So a console file that posted to a publish route itself would be a publish
 * with no box, refused on every attempt. The components card and the site
 * template card each posted their own, until they were moved onto the zone
 * (AGL-3407). This holds the line for the next one.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const CONSOLE = join(__dirname, '..')
const SKIP = new Set(['node_modules', '.next', 'specs', 'public'])

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(entry) && !/\.spec\.tsx?$/.test(entry)) yield path
  }
}

/** Every publish route `publishPreconditionRefusal` gates. */
const PUBLISH_ROUTE =
  /['"`]\/api\/marketplace\/publish(?:-(?:plugin|template|theme|layout|email-template|email-starter|dataset-schema|starter))?['"`?]/

describe('marketplace publishing from the console (AGL-3407)', () => {
  it('goes through the publish zone, never a request of its own', () => {
    const offenders = [...sourceFiles(CONSOLE)]
      .filter((file) => PUBLISH_ROUTE.test(readFileSync(file, 'utf-8')))
      .map((file) => relative(CONSOLE, file))
    expect(offenders).toEqual([])
  })

  it('would notice one', () => {
    // The pattern is the assertion; prove it matches the shape it replaced.
    expect(
      PUBLISH_ROUTE.test("authorizedFetch(user, '/api/marketplace/publish', {"),
    ).toBe(true)
    expect(
      PUBLISH_ROUTE.test("'/api/marketplace/publish-template',"),
    ).toBe(true)
    // A whole site as a site starter (AGL-4049).
    expect(PUBLISH_ROUTE.test("'/api/marketplace/publish-starter',")).toBe(true)
    // Installing is not publishing, and no agreement gates it.
    expect(PUBLISH_ROUTE.test("'/api/marketplace/install-template',")).toBe(false)
  })
})
