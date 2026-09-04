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
 * A rule nobody calls refuses nothing, and this one has a call site on every
 * surface that can give a screen an address: create it with a slug on the
 * Screens page, publish a saved version from the version view, type into the
 * besigner's Slug field, or fill in the Use template dialog. AGL-2093 is the
 * precedent for asserting this rather than trusting it — the console's
 * screen-count precheck was a restatement of the API's rule that quietly
 * drifted out of step, and a refusal one surface enforces and another does not
 * is the same defect: the author simply publishes from the surface that still
 * lets them, and the page is dead again with nothing said. That is how the Use
 * template dialog held this hole open: it reaches `createPageFromTemplate`
 * rather than any of the three publish handlers, so "the three publish
 * surfaces" was never the right frame (AGL-2579). The question is everything
 * that can WRITE an address.
 *
 * ONE list for both rules below, so a fifth surface cannot be added under
 * either of them without failing here — two lists is how this dialog stayed
 * outside the reserved rule while sitting inside the separator rule.
 *
 * "Surface" outgrew "field" at AGL-2588: the last two writers take no typed
 * input at all. A template BUNDLE applier copies a slug out of a template
 * document, and a drag-to-reparent recomposes a live path out of a hierarchy
 * nobody typed into. Both are covered below, the first through the shared
 * refusal helper both appliers call, the second scoped to the drop handler —
 * because its file already consults the rules for its create form, and a
 * whole-file assertion there would pass while the drop stayed unguarded.
 *
 * Source text rather than a rendered click, because what is being held down is
 * COVERAGE, and because two of the four are 1,000-line client pages whose
 * publish handlers need a Firestore, a snackbar provider and a canvas to
 * reach.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONSOLE_ROOT = join(__dirname, '..')

/** Every surface that can put a screen at an address. */
const SLUG_ENTRY_SURFACES: Record<string, string> = {
  'the Screens page create form':
    'app/(app)/[orgSlug]/hosts/[host]/screens/page.tsx',
  'the version view publish button':
    'app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page.tsx',
  'the besigner slug field':
    'app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page.tsx',
  'the Use template dialog':
    'components/templates/use-template-dialog.component.tsx',
  'the template bundle refusal helper':
    'components/templates/create-page-from-template.ts',
}

/** Bundle appliers, which delegate to the helper rather than ask directly. */
const BUNDLE_APPLIERS: Record<string, string> = {
  'the template gallery':
    'components/templates/template-gallery-dialog.component.tsx',
  'the host templates card':
    'components/templates/host-templates-card.component.tsx',
}

const read = (relative: string) =>
  readFileSync(join(CONSOLE_ROOT, relative), 'utf8')

/**
 * The Screens page's drop handler on its own.
 *
 * Its file holds the create form too, which has consulted both rules since
 * AGL-2076/AGL-2572 — so `read(file)` says nothing about the drop handler,
 * and would have passed for every day this hole was open.
 */
const readMoveScreenHandler = () => {
  const source = read(SLUG_ENTRY_SURFACES['the Screens page create form'])
  const start = source.indexOf('const handleMoveScreen = useCallback(')
  expect(start).toBeGreaterThan(-1)
  // The next declaration at component scope ends the callback.
  const end = source.indexOf('\n  const ', start + 1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('a reserved slug is refused everywhere a slug can be set', () => {
  it.each(Object.entries(SLUG_ENTRY_SURFACES))(
    '%s consults reservedScreenRouteSegment',
    (_label, relative) => {
      expect(read(relative)).toContain('reservedScreenRouteSegment')
    },
  )

  it.each(Object.entries(SLUG_ENTRY_SURFACES))(
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
    const source = read(SLUG_ENTRY_SURFACES['the besigner slug field'])
    const disabled =
      /disabled=\{Boolean\(\s*slugConflict \|\|[\s\S]{0,260}?\)\}/.exec(source)
    expect(disabled).not.toBeNull()
    expect(disabled?.[0]).toContain('reservedSegment')
  })
})

/**
 * A `/` INSIDE a slug is refused everywhere a slug can be set (AGL-2572).
 *
 * The same coverage argument as the reserved list above, over a different
 * rule. `normalizeScreenSlug` promises one lowercase url-safe segment and
 * reaches it by deleting the disallowed characters, so an interior `/` is not
 * rejected — it is erased, and `alternatives/webflow` becomes
 * `alternativeswebflow`. Two screens on `aglyn-marketing` carry a slug of that
 * shape. A field that enforces this while another still glues would leave the
 * author publishing from whichever surface stays quiet.
 *
 * A slug is ONE path segment, on every surface. The Screens page create form
 * and the Use template dialog both use the value as the stored slug AND the
 * whole routing-map path, so a `/` there could have been read as a deliberate
 * nested address; the decision is that it is not, because two fields where a
 * separator nests and two where it is refused is worse than one rule. Nesting
 * is expressed by choosing a parent.
 *
 * Asserted over the SAME list as the reserved rule above, which is the whole
 * point of there being one list.
 */
describe('a path-shaped slug is refused everywhere a slug can be set', () => {
  it.each(Object.entries(SLUG_ENTRY_SURFACES))(
    '%s consults screenSlugHasPathSeparator',
    (_label, relative) => {
      expect(read(relative)).toContain('screenSlugHasPathSeparator')
    },
  )

  it.each(Object.entries(SLUG_ENTRY_SURFACES))(
    '%s tells the author WHY, in the shared wording',
    (_label, relative) => {
      expect(read(relative)).toContain('SCREEN_SLUG_PATH_SEPARATOR_MESSAGE')
    },
  )

  /** Visible before the click, for the reason given above. */
  it('disables the besigner Publish button on a path-shaped slug', () => {
    const source = read(SLUG_ENTRY_SURFACES['the besigner slug field'])
    const disabled =
      /disabled=\{Boolean\(\s*slugConflict \|\|[\s\S]{0,260}?\)\}/.exec(source)
    expect(disabled).not.toBeNull()
    expect(disabled?.[0]).toContain('slugPathSeparator')
  })
})

/**
 * THE LAST TWO WRITERS TAKE NO TYPED INPUT (AGL-2588).
 *
 * Both rules above are asked by a field, and both of these write an address
 * without one — which is why they survived AGL-2572 and AGL-2579 with the
 * lists above already green.
 *
 * A BUNDLE APPLIER copies `slug` off a template document. The set was closed
 * only by the PROVENANCE of that document (code-defined starters, library
 * slugs captured off already-guarded screens), and provenance is not a guard.
 * The decision is to skip the offending screen and apply the rest: an abort
 * part-way leaves a half-applied bundle, and a substituted slug puts a screen
 * at an address nobody chose, which is the thing this whole arc is about.
 * Both appliers ask `templateScreenAddressRefusal`, which is the one place
 * that holds both rules — that is why the helper, not the appliers, is in the
 * surface list above.
 *
 * DRAG-TO-REPARENT recomposes a live path. `reservedScreenRouteSegment` reads
 * the first segment only, deliberately, so a screen published at
 * `docs/search` is legal; dragging it to the top level makes that same
 * screen's live path `search`. The refusal has to read the RECOMPOSED paths
 * the drop would write, which is the whole case — asking about the slug would
 * answer about a value the move never changed.
 */
describe('an address written with no field behind it is refused too', () => {
  it.each(Object.entries(BUNDLE_APPLIERS))(
    '%s asks the shared refusal before creating each screen',
    (_label, relative) => {
      expect(read(relative)).toContain('templateScreenAddressRefusal')
    },
  )

  it.each(Object.entries(BUNDLE_APPLIERS))(
    '%s tells the author which screens it skipped',
    (_label, relative) => {
      const source = read(relative)
      expect(source).toContain('could not be added')
      // The list of skips must outlive a glance, or skipping is just a
      // quieter substitution.
      expect(source).toMatch(/skipped\.length[\s\S]{0,400}?persist: true/)
    },
  )

  it('the Screens page drop handler consults the reserved rule', () => {
    const handler = readMoveScreenHandler()
    expect(handler).toContain('reservedScreenRouteSegment')
    expect(handler).toContain('reservedScreenRouteMessage')
  })

  it('asks it of the paths the move would WRITE, not of the slug', () => {
    const handler = readMoveScreenHandler()
    expect(handler.indexOf('buildScreenRouteEntries')).toBeGreaterThan(-1)
    expect(handler.indexOf('buildScreenRouteEntries')).toBeLessThan(
      handler.indexOf('reservedScreenRouteSegment'),
    )
  })

  it('refuses the drop before any of its writes', () => {
    const handler = readMoveScreenHandler()
    expect(handler.indexOf('reservedScreenRouteMessage')).toBeLessThan(
      handler.indexOf('batch.commit'),
    )
  })
})
