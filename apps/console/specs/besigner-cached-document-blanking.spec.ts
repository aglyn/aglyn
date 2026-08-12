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
 * No besigner editor may blank a canvas the cache is still serving
 * (AGL-1066).
 *
 * `useBesignerDocument` decides this — its `hasError` means "the read failed
 * AND there is nothing to show", and that verdict is proven where the hook
 * lives (`use-besigner-document.spec.tsx`). What is asserted here is that all
 * six editors actually ASK it, rather than testing the raw `error` themselves.
 *
 * That distinction is the whole bug. Every one of these pages was a copy of
 * another, each rendering `{error || notFound ? 'Not found' : …}` — so a
 * refused listen reaching `status: 'error'` would replace the document an
 * author is mid-edit on with "Not found", about two seconds into a stale
 * session, while the document itself sat in IndexedDB and rendered fine a
 * moment earlier. AGL-1066 settled that as "keep serving, stop presenting it
 * as live", and the presenting half is the shell's re-auth banner and the
 * refusal on save, not a blank canvas.
 *
 * Six near-identical files is exactly the shape AGL-1358 caught twice — a fix
 * applied to one twin and missed on the other — so they are driven from one
 * table. Source-level, deliberately: rendering a besigner page would drag in
 * the canvas singleton and the whole client Firebase stack to prove something
 * about one conditional.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const APP = join(__dirname, '..', 'app')

const editors: Array<[string, string]> = [
  [
    'screens',
    join(
      APP,
      '(editor)',
      '[orgSlug]',
      'hosts',
      '[host]',
      'screens',
      '[screenId]',
      'versions',
      '[versionId]',
      'besigner',
      'page.tsx',
    ),
  ],
  [
    'layouts',
    join(
      APP,
      '(editor)',
      '[orgSlug]',
      'hosts',
      '[host]',
      'layouts',
      '[layoutId]',
      'versions',
      '[versionId]',
      'besigner',
      'page.tsx',
    ),
  ],
  [
    'components',
    join(
      APP,
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
    ),
  ],
  [
    'templates',
    join(
      APP,
      '(editor)',
      '[orgSlug]',
      'hosts',
      '[host]',
      'templates',
      '[templateId]',
      'besigner',
      'page.tsx',
    ),
  ],
  [
    'host emails',
    join(
      APP,
      '(editor)',
      '[orgSlug]',
      'hosts',
      '[host]',
      'emails',
      '[templateKey]',
      'versions',
      '[versionId]',
      'besigner',
      'page.tsx',
    ),
  ],
  [
    'staff emails',
    join(
      APP,
      '(editor)',
      'admin',
      'emails',
      '[templateKey]',
      'versions',
      '[versionId]',
      'besigner',
      'page.tsx',
    ),
  ],
]

describe.each(editors)('%s besigner (AGL-1066)', (_name, path) => {
  const source = readFileSync(path, 'utf8')

  it('gates the "Not found" branch on hasError, not the raw listener error', () => {
    expect(source).toEqual(expect.stringContaining('hasError || notFound ?'))
  })

  /**
   * The mutation this is here to catch: the old expression, in any of the
   * three arrangements the six pages use. `error ||` on its own is far too
   * broad to assert on — these files carry `error?.message`, `error` in a
   * dependency array and a form's own error state — so it is pinned to the
   * exact conditional.
   */
  it('has no bare "error || notFound" conditional left anywhere in the file', () => {
    // The leading boundary matters: `hasError || notFound ?` CONTAINS the
    // old expression as a substring, so a plain `stringContaining` here
    // would fail on the fixed file and pass on nothing.
    expect(source).not.toMatch(/[^A-Za-z]error \|\| notFound \?/)
  })

  it('takes hasError from useBesignerDocument rather than deriving its own', () => {
    // Destructured from the hook, and used. One occurrence would mean it is
    // pulled out and dropped — which is how a guard becomes decoration.
    const occurrences = source.split('hasError').length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2)
    expect(source).toEqual(expect.stringContaining('useBesignerDocument({'))
  })
})
