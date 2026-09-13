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
 * FILE ▸ SAVE DRAFT IS THE TOOLBAR'S SAVE DRAFT (AGL-2868).
 *
 * In the component editor, on the version the sites serve, the toolbar's
 * Save draft wrote the shared working draft (`versions/{v}/draft/current`)
 * while File ▸ "Save draft" called `handleSave` and wrote the version document
 * itself. Two controls, one name, two documents. Whenever the canvas was clean
 * the File entry read "Up to Date" instead, so an author looking for a way to
 * save found none — and a draft that HAD been saved looked inert, because the
 * document they checked was the one the other control writes.
 *
 * Pinned in source because the wiring is two lines that read plausible either
 * way round, and both editors built on this page shape (components, forms)
 * carry it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const EDITOR = join(__dirname, '..', 'app', '(editor)', '[orgSlug]', 'hosts', '[host]')

const PAGES = {
  component: join(
    EDITOR,
    'components',
    '[componentId]',
    'versions',
    '[versionId]',
    'besigner',
    'page.tsx',
  ),
  form: join(EDITOR, 'forms', '[formId]', 'versions', '[versionId]', 'besigner', 'page.tsx'),
}

/** Comments removed, so prose about a handler is never read as a use of it. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** The File menu's save entry: from its id to the next File entry's id. */
function fileSaveEntry(source: string): string {
  const start = source.indexOf("id: 'center-nav-file-save'")
  expect(start).toBeGreaterThan(-1)
  const next = source.indexOf("id: 'center-nav-file-", start + 1)
  expect(next).toBeGreaterThan(start)
  return source.slice(start, next)
}

describe.each(Object.entries(PAGES))('the %s editor', (_kind, page) => {
  const source = code(page)

  it('saves from File with the handler the toolbar saves with', () => {
    const menuHandler = /onClick:\s*([A-Za-z_$][\w$]*)/.exec(fileSaveEntry(source))?.[1]
    const toolbarHandler = /onSave=\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(source)?.[1]

    expect(menuHandler).toBeDefined()
    expect(menuHandler).toBe(toolbarHandler)
  })

  it('makes that handler the working draft on the live version, the version anywhere else', () => {
    const handler = /onSave=\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(source)?.[1]
    expect(source).toMatch(
      new RegExp(`const ${handler} = editingLiveVersion \\? handleSaveDraft : handleSave\\b`),
    )
  })

  it('names the File entry for the action, not for the state of the canvas', () => {
    const entry = fileSaveEntry(source)

    expect(entry).toContain("children: 'Save draft'")
    expect(entry).not.toMatch(/Up to Date/i)
  })
})
