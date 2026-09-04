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
 * THE CACHE DROP HANGS OFF THE WRITE THAT MOVES THE BYTES (AGL-2486).
 *
 * A component edited and saved in the besigner did not appear on the live
 * site, and would not have appeared however long anyone waited — while the
 * editor said the live pages were refreshing. The wiring was exactly
 * inverted:
 *
 *   - SAVE (writes `components/{id}/versions/{versionId}`, a document no
 *     renderer opens) dropped the cached HTML of every screen using the
 *     component. Correct id, correct dependent scan, and no effect: the pages
 *     regenerated from a parent doc the save had not touched.
 *   - PUBLISH (writes `components/{id}`, the document `getComponents`
 *     renders) dropped nothing, and waited out the full ISR window.
 *
 * `component-publish-propagation.emulator.spec.ts` proves the underlying
 * fact against a real Firestore with every cache cold. This pins the wiring
 * that follows from it, because the wiring is a two-line thing that reads
 * plausible either way round.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(__dirname, '..', '..', '..')

const COMPONENT_BESIGNER = join(
  __dirname,
  '..',
  'app',
  '(editor)',
  '[orgSlug]',
  'hosts',
  '[host]',
  'components',
  '[componentId]',
  'versions',
  '[versionId]',
  'besigner',
  'page.tsx',
)

/** The one call, wherever it sits. */
const REVALIDATE_CALL = 'revalidateLivePages({ user, hostId, componentId })'
/** The parent-doc write — the published copy of the component. */
const PUBLISH_WRITE = "'hosts', hostId, 'components', componentId)"

describe('a component publish drops caches; a component save does not (AGL-2486)', () => {
  const source = readFileSync(COMPONENT_BESIGNER, 'utf8')

  it('revalidates only from a PUBLISH handler, never from the save path', () => {
    // Counting the call was the original assertion, and it was a proxy: the
    // thing that must never come back is a cache drop hanging off the SAVE,
    // which cannot change live bytes and so pays for a full-site scan for
    // nothing. Counting stopped being able to say that when AGL-2540 added a
    // second legitimate call — on the branch where the pointer already names
    // this version, so there is no promotion to carry one.
    //
    // So assert the rule itself: name the handler each call sits in.
    const owners: string[] = []
    let at = source.indexOf(REVALIDATE_CALL)
    while (at !== -1) {
      const declared = source.lastIndexOf('= useCallback', at)
      const nameAt = source.lastIndexOf('const ', declared)
      owners.push(source.slice(nameAt + 'const '.length, declared).trim())
      at = source.indexOf(REVALIDATE_CALL, at + 1)
    }
    expect(owners).toEqual(['promoteToSites', 'handleSaveAndPublish'])
  })

  it('drops the cache even when there is nothing to promote (AGL-2540)', () => {
    // `livePublished` says the POINTER already names this version. It says
    // nothing about the CACHE, and the toast claims the live sites match — so
    // a version document edited outside the canvas used to leave the tenant
    // serving old HTML for the rest of its window under a success message.
    // The early return is the regression to guard.
    const branchAt = source.indexOf('if (livePublished) {')
    expect(branchAt).toBeGreaterThan(-1)
    const branch = source.slice(branchAt, source.indexOf('}', source.indexOf('persist: false', branchAt)))
    expect(branch).toContain(REVALIDATE_CALL)
    expect(branch).not.toMatch(/the live sites match this version/)
  })

  it('puts that call AFTER the write to the published component doc', () => {
    // Position is the whole assertion. `handlePublish` is the only place the
    // parent doc is written, and it is below `onSaved` in the file, so a
    // revalidate that precedes the parent write is one hanging off the save.
    const publishWriteAt = source.indexOf(PUBLISH_WRITE)
    const revalidateAt = source.indexOf(REVALIDATE_CALL)
    expect(publishWriteAt).toBeGreaterThan(-1)
    expect(revalidateAt).toBeGreaterThan(publishWriteAt)
  })

  it('no longer gates a cache drop on editing the published version', () => {
    // The pre-fix condition. A component save cannot change live bytes on
    // ANY version, so the published-version special case has no work left to
    // do — and while it existed it was the thing firing the scan.
    const gated = /versionId === publishedVersionId\)?\s*\{?\s*[\s\S]{0,120}revalidateLivePages/
    expect(source).not.toMatch(gated)
  })

  it('does not tell the author a save is refreshing live pages', () => {
    // The message that made the bug cost ten minutes instead of one click.
    const savedMessageAt = source.indexOf('savedMessage:')
    expect(savedMessageAt).toBeGreaterThan(-1)
    const message = source.slice(savedMessageAt, savedMessageAt + 200)
    expect(message).not.toMatch(/refreshing/)
    expect(message).toMatch(/Publish/)
  })

  it('surfaces a drop that did not cover the whole site', () => {
    // Both caps (the console scan limit and the tenant path cap) can bite on
    // a site-wide component. Reporting an unqualified success over pages that
    // did not change is the same failure in a smaller costume (AGL-1239).
    expect(source).toEqual(expect.stringContaining('describeRevalidateShortfall'))
  })
})

describe('why the drop belongs on publish, not on save (AGL-2486)', () => {
  const getComponents = readFileSync(
    join(REPO, 'libs', 'tenant', 'runtime', 'src', 'lib', 'get-components.ts'),
    'utf8',
  )

  it('the tenant renders the component PARENT doc and never a version of it', () => {
    // The fact the wiring above rests on. If component nodes ever move into
    // version docs, this fails — and the save/publish wiring has to be
    // rethought rather than silently becoming wrong again.
    expect(getComponents).toEqual(expect.stringContaining(".collection('components')"))
    expect(getComponents).not.toMatch(/\.collection\('versions'\)/)
  })
})
