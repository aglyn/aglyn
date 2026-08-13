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
 * AGL-1479: the spec that watches the watchmen.
 *
 * Every source-guard spec in this app now strips comments through one shared
 * `code()`. That makes this file the single place the stripper itself can be
 * held to account — and it has to be, because the failure it replaced was not a
 * red test. Four sibling specs deleted 16,383 characters of the file they were
 * asserting against, out of the middle, and went green about it. Their
 * assertions are mostly NEGATIVE, so the hole did not weaken them, it
 * STRENGTHENED them: a claim that a shape is absent gets easier to satisfy the
 * more of the subject you delete first.
 *
 * So the last two describes below are the point of the file. It is not enough
 * that the stripper now keeps the right characters; the specs downstream have
 * to be shown FAILING when the shape they forbid is put back where the hole
 * used to be. Otherwise this is a prettier regex and the same blindness.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MAX_STRIPPED_SPAN, MIN_KEPT_FRACTION, code } from './source-text'

const CONSOLE = join(__dirname, '..')
const MEDIA = join(CONSOLE, 'components', 'media')
const API = join(CONSOLE, 'app', 'api')

const LIBRARY_PATH = join(MEDIA, 'media-library.component.tsx')

/**
 * Every source a spec in this app strips. Listed rather than globbed: the bound
 * is only meaningful over the files it was calibrated against, and a new
 * guarded source should arrive here deliberately.
 */
const GUARDED: [string, string][] = [
  ['media-library.component.tsx', LIBRARY_PATH],
  [
    'media-asset-card.component.tsx',
    join(MEDIA, 'media-asset-card.component.tsx'),
  ],
  ['api/media/upload/route.ts', join(API, 'media', 'upload', 'route.ts')],
  ['api/media/restore/route.ts', join(API, 'media', 'restore', 'route.ts')],
  ['api/media/folders/route.ts', join(API, 'media', 'folders', 'route.ts')],
  ['api/media/replace/route.ts', join(API, 'media', 'replace', 'route.ts')],
  ['api/health/route.ts', join(API, 'health', 'route.ts')],
  [
    'logo-card.component.tsx',
    join(CONSOLE, 'components', 'logo-card.component.tsx'),
  ],
  [
    'favicon-card.component.tsx',
    join(CONSOLE, 'components', 'favicon-card.component.tsx'),
  ],
]

const LIBRARY = readFileSync(LIBRARY_PATH, 'utf8')

/** The shape four specs shipped, kept here so its damage stays measurable. */
const naive = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the stripper keeps its input (AGL-1479)', () => {
  it.each(GUARDED)('%s survives within the bound', (label, path) => {
    const source = readFileSync(path, 'utf8')
    const stripped = code(source, label)
    expect(stripped.length).toBeGreaterThanOrEqual(
      source.length * MIN_KEPT_FRACTION,
    )
  })

  /**
   * The decisive one, and the reason the fraction above cannot stand alone: the
   * defect left 62% of the library in place. A hole is invisible to a ratio and
   * obvious to a per-comment bound, so the bound is where the guarantee lives.
   */
  it.each(GUARDED)(
    '%s loses no single run over the span bound',
    (label, path) => {
      const source = readFileSync(path, 'utf8')
      // `code` throws on an over-long match; this is that promise, per file.
      expect(() => code(source, label)).not.toThrow()
    },
  )

  it('refuses a comment longer than the span bound', () => {
    const oversized = `/**\n${'x'.repeat(MAX_STRIPPED_SPAN)}\n*/\nconst a = 1\n`
    expect(() => code(oversized, 'oversized')).toThrow(/one comment/)
  })

  it('refuses a strip that leaves almost nothing behind', () => {
    // Under the bound individually, but nothing survives them.
    const allComments = `${'/* padding */\n'.repeat(400)}const a = 1\n`
    expect(() => code(allComments, 'all-comments')).toThrow(/below the/)
  })
})

describe('the two openers that are not comments (AGL-1479)', () => {
  /**
   * The defect itself. `accept="image/*"` is a MIME type in a file input, and a
   * `/*` that may start a comment anywhere reads it as one — then runs to the
   * next `*` + `/`, which is 442 lines later.
   */
  it('THE DEFECT: a MIME type does not open a comment', () => {
    expect(LIBRARY).toContain('accept="image/*"')
    expect(code(LIBRARY, 'library')).toContain('accept="image/*"')

    const lost = LIBRARY.length - naive(LIBRARY).length
    const keptLoss = LIBRARY.length - code(LIBRARY, 'library').length
    // The gap between them IS the hole, and it is not a rounding error.
    expect(lost - keptLoss).toBeGreaterThan(10_000)
  })

  /**
   * The second trap, which the AGL-1469 helper had already found: a JSX comment
   * pattern whose body may contain `*` + `/` matches from `interface Props {`
   * through the next `*` + `/` + `}`. Measured at four fifths of the library.
   */
  it('a JSDoc field inside a type literal does not open a JSX comment', () => {
    const unsafe = LIBRARY.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    expect(LIBRARY.length - unsafe.length).toBeGreaterThan(100_000)
    // The shared one removes JSX comments and nothing else.
    expect(LIBRARY.length - code(LIBRARY, 'library').length).toBeLessThan(
      LIBRARY.length - unsafe.length,
    )
  })

  it('leaves a `https://` URL alone', () => {
    expect(code('const u = "https://a.example/b" // gone\n')).toContain(
      'https://a.example/b',
    )
  })
})

/**
 * The proof that the specs downstream can now SEE.
 *
 * `media-move-wiring.spec.ts` forbids a picker that renders a bare folder name
 * — `folderList.map(…)` reaching a `<MenuItem>` — because two rows reading
 * "Covers" with no path is the AGL-1470 bug. That picker's markup sits at line
 * 2,900 of the library, inside the region the old stripper deleted.
 *
 * So the assertion passed. It would have passed with the forbidden shape
 * present, which is the only thing it was ever asked to notice.
 */
describe('a restored subject now fails the assertion it should (AGL-1479)', () => {
  /** The forbidden shape, put back exactly where the hole used to swallow it. */
  const RESTORED = (() => {
    const at = LIBRARY.indexOf('accept="image/*"')
    if (at < 0) throw new Error('the MIME type moved — retarget me')
    const after = LIBRARY.indexOf('\n', at) + 1
    return `${LIBRARY.slice(0, after)}
        {folderList.map((folder) => (
          <MenuItem key={folder.id} value={folder.id}>
            {folder.name}
          </MenuItem>
        ))}
${LIBRARY.slice(after)}`
  })()

  /** The assertion, as `media-move-wiring.spec.ts` spells it. */
  const forbidsBareName = (source: string) =>
    !/folderList\.map\([\s\S]{0,200}?<MenuItem/.test(source)

  it('the old stripper could not see it — the assertion passed anyway', () => {
    expect(RESTORED).toContain('<MenuItem key={folder.id}')
    expect(naive(RESTORED)).not.toContain('<MenuItem key={folder.id}')
    // Green, with the forbidden picker sitting in the file.
    expect(forbidsBareName(naive(RESTORED))).toBe(true)
  })

  it('THE PROOF: the shared stripper sees it, and the assertion fails', () => {
    expect(forbidsBareName(code(RESTORED, 'restored'))).toBe(false)
  })

  /** And still passes against the real file, which does not carry the shape. */
  it('and still passes against the library as it stands', () => {
    expect(forbidsBareName(code(LIBRARY, 'library'))).toBe(true)
  })
})
