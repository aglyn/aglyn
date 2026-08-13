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

/**
 * AGL-1466: the two halves of this bug, pinned where they happened.
 *
 * `media-folder-create-scope.emulator.spec.ts` proves what a folder document
 * looks like once written and what the site-scoped query then returns. It
 * cannot prove that THIS COMPONENT is what writes it — the creates are two
 * `writeBatch` calls inside a component that mounts the org context, four
 * Firestore listener stacks, the DAM counters and a dnd-kit surface, so
 * rendering it would be a test of the mocks (the same call the AGL-1413 /
 * AGL-1461 / AGL-1467 specs in this folder make).
 *
 * So: behaviour lives in the emulator spec, and the wiring that connects the
 * component to it lives here. A break in either one leaves folders unscoped,
 * which is invisible from the org page and total from every host.
 *
 * The second half is the sharing editor. It displayed `[ORG_SCOPE_TOKEN]`
 * whenever the stored value was absent, so a folder that was shared with
 * nothing read as "All sites" — that substitution is why nobody caught the
 * missing writes for three weeks, and re-introducing it would re-blind the
 * next occurrence of this class.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { code } from '../../specs/source-text'

const LIBRARY = readFileSync(
  join(__dirname, 'media-library.component.tsx'),
  'utf8',
)

/**
 * Comments removed. Required, not tidy: the comments below the fixes NAME the
 * shape they replaced, which is the right thing for a reader and would make
 * every negative assertion here pass against prose.
 *
 * Through the shared, bounded stripper since AGL-1479 — the copy this file
 * carried read `accept="image/*"` as a comment opener and deleted 16,383
 * characters out of the middle of the library, which is 442 lines of markup
 * that every negative assertion below was silently excused from.
 */
const CODE = code(LIBRARY, 'media-library.component.tsx')

/**
 * The body of a `const <name> = useCallback(` declaration — up to whichever
 * closer comes first, since the inline form ends `}, [deps])` on one line
 * and the multi-line form ends with the dependency array on its own.
 */
function callbackBody(name: string): string {
  const start = CODE.indexOf(`const ${name} = useCallback(`)
  expect(start).toBeGreaterThan(-1)
  const ends = ['\n  }, [', '\n  )']
    .map((closer) => CODE.indexOf(closer, start))
    .filter((at) => at > start)
  expect(ends.length).toBeGreaterThan(0)
  return CODE.slice(start, Math.min(...ends))
}

describe('AGL-1466 · a folder create carries its scope', () => {
  /**
   * Every `mediaFolders` document this component writes is shaped by the one
   * function that requires a scope. Counted rather than merely searched for:
   * the bug was TWO creation paths and only fixing the loud one leaves the
   * legacy migration reproducing it on any org that still has AGL-124
   * folder strings.
   */
  it('routes both creation paths through newMediaFolderDoc', () => {
    const creates = CODE.match(/batch\.set\(\s*ref,/g) ?? []
    expect(creates.length).toBeGreaterThanOrEqual(2)

    const shaped = CODE.match(/batch\.set\(\s*ref,\s*Aglyn\.newMediaFolderDoc\(/g) ?? []
    expect(shaped).toHaveLength(creates.length)
  })

  /**
   * The exact literal that shipped the bug — `{ name, parentId, createdAt }`
   * with no scope — may not come back in any spelling.
   */
  it('never writes a bare folder literal again', () => {
    // Matched to a boolean, not to the source: a failure here should print
    // the verdict, not 3,700 lines of component.
    expect(/batch\.set\(\s*ref,\s*\{\s*name/.test(CODE)).toBe(false)
  })

  /**
   * A SITE library has no org to scope to, so it stores no field; the org
   * library takes the same AGL-1048 default as the datasets and uploads
   * created next to it. Both facts are one expression, so the null branch
   * cannot drift away from the `orgId` test that selects the collection.
   */
  it('picks the org default only for an org library', () => {
    const declaration = CODE.slice(
      CODE.indexOf('const newFolderScope'),
      CODE.indexOf('const newFolderScope') + 500,
    )
    expect(declaration).toMatch(/orgId/)
    expect(declaration).toMatch(/defaultScopeForNewResource/)
    expect(declaration).toMatch(/:\s*null/)
  })
})

describe('AGL-1466 · the sharing editor shows what is stored', () => {
  const openFolderScope = () => callbackBody('openFolderScope')

  /**
   * The substitution itself. Opening the editor on a folder with no
   * `visibleTo` must not seed the control with `['org']`, because Apply then
   * writes a value the user never chose and, far worse, Cancel leaves a
   * dialog that said "All sites" about a folder no site can see.
   */
  it('does not seed an absent folder scope with the org token', () => {
    expect(openFolderScope()).not.toMatch(
      /visibleTo:\s*stored\?\.length\s*\?\s*stored\s*:\s*\[Aglyn\.ORG_SCOPE_TOKEN\]/,
    )
  })

  /** It says so instead, on a flag the dialog can render. */
  it('marks the dialog as unset when nothing is stored', () => {
    expect(openFolderScope()).toMatch(/unset:/)
    expect(/scopeDialog\?\.unset/.test(CODE)).toBe(true)
  })

  /**
   * The same substitution existed for a selection of files, through
   * `scopeOfMedia`. A dialog that lies about one resource type and not the
   * other is a dialog that will lie again.
   */
  it('does not seed an absent file scope with the org token', () => {
    expect(callbackBody('scopeOfMedia')).not.toMatch(/\[Aglyn\.ORG_SCOPE_TOKEN\]/)
  })

  /**
   * The same claim, over the WHOLE component rather than two callbacks named
   * by hand — and it does not hold (AGL-1480).
   *
   * Both assertions above were written against a `CODE` with 16,383 characters
   * missing from the middle of it (AGL-1479), so "no picker substitutes" was
   * only ever checked at the two sites someone thought to name. Restoring the
   * hole turned up a third: the grid card's `onDetails` seeds the detail
   * drawer with `[Aglyn.ORG_SCOPE_TOKEN]` when the field is absent, so the
   * most-travelled of the three surfaces still reads "All sites" about a file
   * that has never been shared with anything.
   *
   * `failing` rather than deleted or softened: this is the guarantee the repo
   * believed it had, stated where it belongs. It turns RED the moment AGL-1480
   * lands, which is the signal to drop the marker.
   */
  it.failing('never seeds an absent scope with the org token, anywhere', () => {
    const seeds =
      CODE.match(/visibleTo:[\s\S]{0,140}?\[Aglyn\.ORG_SCOPE_TOKEN\]/g) ?? []
    // The legitimate ones: a NEW resource's default, the normalizer's floor,
    // the preview call that needs a usable scope to get a count, and the
    // radio whose 'org' option IS the org token. What may not appear is a
    // fallback for a resource that already exists and stored nothing.
    expect(seeds.filter((seed) => /Array\.isArray/.test(seed))).toHaveLength(0)
  })

  /**
   * And the user is told, in words, what an unset scope means — which is
   * "hidden", the opposite of what the dialog used to imply.
   */
  it('names the consequence of an unset scope', () => {
    expect(
      /never been (shared|saved)|not shared with any site/i.test(LIBRARY),
    ).toBe(true)
  })
})
