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
 * EVERY EDITOR ASKS ABOUT AN UNOPENED SAVED DRAFT BEFORE IT ACTS (AGL-2874).
 *
 * The hook owns the verdict (`refuseOverUnopenedDraft`, `sharedDraftUnopened`)
 * and its own spec proves it. What the hook cannot prove is that each editor
 * asks — and the editor's handlers are where the damage was done: Save &
 * publish promoted the stored tree and then cleared a draft nobody had opened,
 * and Save draft overwrote it. Four editors carry a shared working draft, each
 * with its own copy of both handlers, so all four are held to it here.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const EDITOR = join(__dirname, '..', 'app', '(editor)', '[orgSlug]', 'hosts', '[host]')

const PAGES = {
  screen: join(EDITOR, 'screens', '[screenId]', 'versions', '[versionId]', 'besigner', 'page.tsx'),
  layout: join(EDITOR, 'layouts', '[layoutId]', 'versions', '[versionId]', 'besigner', 'page.tsx'),
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

/** Comments removed, so prose about a guard is never read as the guard. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** A `const name = useCallback(...)` handler's source, up to its dependency list. */
function handler(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`)
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('}, [', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe.each(Object.entries(PAGES))('the %s editor', (_kind, page) => {
  const source = code(page)

  it('refuses Save & publish over an unopened draft before it saves anything', () => {
    const body = handler(source, 'handleSaveAndPublish')
    const guard = body.indexOf("refuseOverUnopenedDraft('publish')")
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(body.indexOf('handleSave()'))
  })

  it('refuses Save draft over an unopened draft before it writes one', () => {
    const body = handler(source, 'handleSaveDraft')
    const guard = body.indexOf("refuseOverUnopenedDraft('save')")
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(body.indexOf('saveWorkingDraft('))
  })

  it('clears the working draft only when no unopened draft is outstanding', () => {
    const calls = [...source.matchAll(/clearServerDraft\(/g)].map((match) => match.index ?? 0)
    expect(calls.length).toBeGreaterThan(0)
    for (const at of calls) {
      // The guard is the statement that immediately encloses the call.
      const before = source.slice(Math.max(0, at - 120), at)
      expect(before).toMatch(/if \(!draft\.sharedDraftUnopened\) \{\s*void $/)
    }
  })
})
