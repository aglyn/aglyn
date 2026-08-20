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
 * EVERY SURFACE THAT TAKES A SLUG ASKS THE SAME QUESTION (AGL-2076).
 *
 * `reservedScreenRouteSegment` names the handful of addresses the published
 * site cannot answer — `404` and `500` are static files in Vercel's own
 * filesystem, `search` is `app/[host]/search`, and `api`/`_next`/`_static` are
 * the tenant middleware's exclusions. The rule and its measurements live in
 * `libs/aglyn/src/lib/app-utils/screen-route.ts`, and the tenant side is
 * proven in `apps/tenant/specs/reserved-screen-slugs.spec.ts`.
 *
 * A rule nobody calls refuses nothing, and this one has THREE call sites
 * because there are three ways to give a screen an address: create it with a
 * slug on the Screens page, publish a saved version from the version view, or
 * type into the besigner's Slug field. AGL-2093 is the precedent for asserting
 * this rather than trusting it — the console's screen-count precheck was a
 * restatement of the API's rule that quietly drifted out of step, and a
 * refusal one surface enforces and another does not is the same defect: the
 * author simply publishes from the surface that still lets them, and the page
 * is dead again with nothing said.
 *
 * Source text rather than a rendered click, because what is being held down is
 * COVERAGE — that no fourth publish surface can be added without this failing
 * — and because two of the three are 1,000-line client pages whose publish
 * handlers need a Firestore, a snackbar provider and a canvas to reach.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONSOLE_ROOT = join(__dirname, '..')

/** The three surfaces that can put a screen at an address. */
const PUBLISH_SURFACES: Record<string, string> = {
  'the Screens page create form':
    'app/(app)/[orgSlug]/hosts/[host]/screens/page.tsx',
  'the version view publish button':
    'app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page.tsx',
  'the besigner slug field':
    'app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page.tsx',
}

const read = (relative: string) =>
  readFileSync(join(CONSOLE_ROOT, relative), 'utf8')

describe('a reserved slug is refused everywhere a slug can be set', () => {
  it.each(Object.entries(PUBLISH_SURFACES))(
    '%s consults reservedScreenRouteSegment',
    (_label, relative) => {
      expect(read(relative)).toContain('reservedScreenRouteSegment')
    },
  )

  it.each(Object.entries(PUBLISH_SURFACES))(
    '%s tells the author WHY, in the shared wording',
    (_label, relative) => {
      expect(read(relative)).toContain('reservedScreenRouteMessage')
    },
  )

  /**
   * The besigner is the one surface where the refusal has to be visible
   * BEFORE the click: it publishes from a canvas the author is already
   * looking at, and its Slug field already reports a conflicting path and an
   * unpublished ancestor inline. A reserved segment that only surfaced as a
   * snackbar after pressing Publish would be the same silent surprise this
   * issue is about, one step later.
   */
  it('disables the besigner Publish button on a reserved slug', () => {
    const source = read(PUBLISH_SURFACES['the besigner slug field'])
    const disabled =
      /disabled=\{Boolean\(\s*slugConflict \|\|[\s\S]{0,200}?\)\}/.exec(source)
    expect(disabled).not.toBeNull()
    expect(disabled?.[0]).toContain('reservedSegment')
  })
})
