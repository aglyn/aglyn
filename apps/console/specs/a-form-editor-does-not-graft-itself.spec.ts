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
 * A FORM EDITOR NEVER RENDERS THE FORM'S PUBLISHED COPY OVER ITS DRAFT.
 *
 * The hazard is created by two correct rules meeting. `checkFormContract`
 * requires a form design's `form` node to name the form it is the design OF —
 * so the document open in a form editor always places ITSELF. And a placed
 * form now renders its entity's published design. Put together, without the
 * exclusions asserted here, opening a form in the besigner would paint the
 * last published version over the fields the author is editing, and the same
 * would happen to the Preview of a form's draft.
 *
 * Both are wiring, not logic: the graft is right, and each surface simply has
 * to withhold ONE id from it. A wiring failure of this kind renders perfectly
 * — an author sees a form, just not theirs — so it is asserted against the
 * source, the way the promote route's check-before-write ordering is.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Jest's cwd is the repo root here, not apps/console.
const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

const FORM_BESIGNER =
  'apps/console/app/(editor)/[orgSlug]/hosts/[host]/forms/[formId]/versions/[versionId]/besigner/page.tsx'
const PROVIDER = 'apps/console/components/reusable-components-provider.component.tsx'
const PREVIEW = 'apps/console/components/document-preview.component.tsx'

describe("a form's own editor withholds itself from the graft", () => {
  it('passes the edited form id to the provider that carries the designs', () => {
    const source = readRepo(FORM_BESIGNER)
    expect(source).toMatch(/editingFormId=\{formId as string\}/)
  })

  it('drops that id from the map the canvas resolves against', () => {
    const source = readRepo(PROVIDER)
    // The map handed to the context is derived, never the raw hook result —
    // that derivation IS the exclusion.
    expect(source).toMatch(/delete next\[editingFormId\]/)
    expect(source).toMatch(/formDesigns,?\s*$/m)
  })

  it('never hands the RAW host map straight to the context', () => {
    // The failure this catches is a later edit "simplifying" the memo away:
    // `formDesigns: hostFormDesigns` reads as harmless and reintroduces the
    // whole bug.
    expect(readRepo(PROVIDER)).not.toMatch(/formDesigns:\s*hostFormDesigns/)
  })
})

describe('previewing a form draft withholds the same id', () => {
  it('filters the previewed form out before composing', () => {
    const source = readRepo(PREVIEW)
    expect(source).toMatch(/kind === 'form' && docId/)
    expect(source).toMatch(/previewableFormDesigns/)
  })

  it('composes with the FILTERED map, not the read result', () => {
    const source = readRepo(PREVIEW)
    // The placement must be built from the filtered map. Passing `formDesigns`
    // here would leave the filter computed and unused — green code that does
    // nothing, which is exactly how this bug would come back.
    expect(source).toMatch(
      /placedFormPlacement\(previewableFormDesigns as any\)/,
    )
  })
})
