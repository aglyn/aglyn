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
 * AGL-1896: the DAM's stored alt text reaches the placement.
 *
 * The asset field is NOT new — `AglynHostMedia.alt` has existed since
 * AGL-173, the library drawer has always saved it, and DAM search has always
 * indexed it. What never existed is a READER. Both picker shapes handed back
 * a URL and nothing else, so every placement surface asked the author to type
 * alt again from scratch: the same logo on eight pages needed its alt typed
 * eight times, and a field that must be retyped per placement is a field that
 * ships blank — on the customer's own published site, which is their legal
 * exposure before it is ours.
 *
 * ## Why these are source assertions
 *
 * Each subject is a picker CALLBACK inside a component that mounts a Firestore
 * listener stack and a modal portal — `media-library.component.tsx` is 4,500
 * lines and the spec beside it says outright that rendering it is a test of
 * the mocks. What has to be pinned here is which value goes through which
 * function on the way to the stored document, and that is a property of the
 * declaration. The behaviour those declarations delegate to is tested for
 * real, on real inputs, in `media-metadata.spec.ts` (`inheritedMediaAlt`) and
 * rendered end-to-end in `site-runtime.spec.tsx` (the popup's `alt`
 * attribute); this file is only the wiring between them.
 *
 * Comments are stripped through the shared AGL-1479 stripper, because the
 * comments below every one of these fixes NAME the shape it replaced — a
 * negative assertion over raw source would pass against the explanation of
 * the bug rather than against its absence.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { code } from './source-text'

const REPO = join(__dirname, '..', '..', '..')

function source(...parts: string[]): string {
  const path = join(REPO, ...parts)
  return code(readFileSync(path, 'utf8'), parts[parts.length - 1])
}

/**
 * The same read with the kept-fraction floor lifted, for a file that is
 * legitimately mostly prose.
 *
 * `media-picker-context.ts` is a 50-line contract carrying ~2,400 characters
 * of docblock explaining what each field means and what callers may not do
 * with it — 83% comment, and that ratio is the file being good rather than
 * the stripper misfiring. The floor exists to catch the AGL-1479 shape,
 * where a regex reads `accept="image/*"` as a comment opener and silently
 * eats the subject of the assertion; `MAX_STRIPPED_SPAN` still enforces that
 * here, and it is the bound that actually catches it. The alternative — a
 * positive assertion over unstripped source — would happily match the phrase
 * inside a docblock describing the field rather than the field itself.
 */
function prose(...parts: string[]): string {
  const path = join(REPO, ...parts)
  return code(readFileSync(path, 'utf8'), parts[parts.length - 1], 0)
}

/**
 * The one rule, and the reason there is only one.
 *
 * "Default from the asset, override per placement" has four edge cases —
 * blank-vs-whitespace, an explicit Decorative switch, an asset with no alt,
 * and `undefined`-vs-`''` — and a surface that re-derives them inline gets a
 * different answer to the surface next to it. `inheritedMediaAlt` is the
 * single mechanism; a call site that inlines the rule instead is the
 * regression this describe exists to catch.
 */
const HELPER = 'inheritedMediaAlt'

describe('the media picker carries the asset alt', () => {
  /**
   * The besigner bridge. It had the whole media document in hand and passed
   * only the string, so the designer could not have defaulted an alt even if
   * every surface downstream had wanted to.
   */
  it('the besigner provider hands the asset alt to the requesting surface', () => {
    const text = source(
      'apps',
      'console',
      'components',
      'besigner-media-picker-provider.component.tsx',
    )
    expect(text).toContain('pendingPick.current?.(src, { alt: media.alt })')
  })

  /**
   * The plugin-facing bridge. `PickedMedia` is the whole contract a relocated
   * plugin console page sees, so an omission here is not a missing default —
   * it is a value the plugin is structurally unable to read.
   */
  it('the console provider puts the asset alt on PickedMedia', () => {
    const contract = prose(
      'libs',
      'aglyn',
      'src',
      'lib',
      'app-utils',
      'media-picker-context.ts',
    )
    expect(contract).toMatch(/alt\?: string/)

    const provider = source(
      'apps',
      'console',
      'components',
      'console-media-picker-provider.component.tsx',
    )
    // Both halves: the cast that lets it be READ off the picked document,
    // and the settle payload that carries it out. Either one alone is a
    // value that arrives and is dropped one line later.
    expect(provider).toMatch(/alt\?: string/)
    expect(provider).toContain('alt: picked.alt')
  })
})

describe('a placement defaults its alt through the one shared rule', () => {
  it('the collection entry editor inherits, and no longer fabricates', () => {
    const text = source(
      'apps',
      'console',
      'app',
      '(app)',
      '[orgSlug]',
      'hosts',
      '[host]',
      'content',
      'page.tsx',
    )
    expect(text).toContain(`Aglyn.${HELPER}(`)
    /**
     * The removed fabrication, asserted by absence.
     *
     * This surface used to insert `media.fileName` as the alt when the asset
     * had none, which is the tempting wrong answer to this whole issue: it is
     * always non-empty, so it LOOKS like coverage, and "IMG_4021.jpg"
     * announced by a screen reader is worse than the silence it replaced. It
     * was also the hardest fabrication to undo — a markdown-lite image row's
     * alt is fixed at insert time and the editor offers no way to edit it
     * afterwards.
     */
    expect(text).not.toMatch(/alt\s*\?\?\s*[^\n]*fileName/)
  })

  /**
   * Two console surfaces that offer NO alt prompt at all, and insert into an
   * editor whose image rows cannot have their alt edited afterwards. A
   * hardcoded `''` here was permanent by construction, which is why they are
   * asserted together.
   */
  it.each([
    ['listing-detail-editor.component.tsx'],
    ['publish-plugin-form.component.tsx'],
  ])('the marketplace %s inherits instead of inserting an empty alt', (file) => {
    const text = source('apps', 'console', 'components', 'marketplace', file)
    expect(text).toContain(`${HELPER}(`)
    expect(text).not.toContain(`insertImage('',`)
  })
})

/**
 * A capability is not a feature until the console exposes it — and this field
 * was exposed and yet not a feature, which is the subtler version of the same
 * failure. The input existed; nothing told the author it was worth filling in
 * once rather than eight times, because until now it wasn't.
 */
describe('the DAM drawer says what the field now does', () => {
  it('the alt input carries guidance and the shared length cap', () => {
    const text = source(
      'apps',
      'console',
      'components',
      'media',
      'media-library.component.tsx',
    )
    const field = text.slice(text.indexOf(`label="Alt text"`))
    expect(field.indexOf(`label="Alt text"`)).toBe(0)
    const block = field.slice(0, field.indexOf('/>') + 2)
    expect(block).toContain('helperText')
    // The promise the helper text makes, in the words the author reads.
    expect(block).toMatch(/wherever this file is placed/)
    expect(block).toContain('MEDIA_ALT_MAX_LENGTH')
  })
})
