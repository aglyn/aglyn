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
 * SAVE & PUBLISH STOPS WHEN ITS SAVE WAS REFUSED — IN EVERY EDITOR (AGL-2877).
 *
 * `handleSave` resolves the same way whether it wrote, had nothing to write,
 * or refused, and `onSaveRefused` is the one signal that tells a refusal
 * apart. The screen editor wired it; the component, form and layout editors
 * did not, and stopped only on `remoteChanged` — React state that is still
 * false in the tick a save discovers a conflict. So a stale-baseline refusal
 * reported "Someone else saved…" and then wrote this canvas onto the
 * component or form every page renders, or moved a layout's pointer to a
 * version that never received the edit.
 *
 * The hook's half — `onSaveRefused` fires on every refusal path — is proven
 * in `use-besigner-document.spec.tsx`. What is pinned here is that each
 * editor listens, and listens BEFORE it promotes.
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

describe.each(Object.entries(PAGES))('the %s editor', (_kind, page) => {
  const source = code(page)

  it('records a refused save', () => {
    expect(source).toMatch(
      /onSaveRefused: \(\) => \{\s*saveRefusedRef\.current = true\s*\}/,
    )
  })

  it('stops Save & publish on it before promoting, revalidating or clearing anything', () => {
    const start = source.indexOf('const handleSaveAndPublish = useCallback(')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('}, [', start))

    const reset = body.indexOf('saveRefusedRef.current = false')
    const save = body.indexOf('await handleSave()')
    const stop = body.indexOf('if (saveRefusedRef.current) return')
    expect(reset).toBeGreaterThan(-1)
    expect(reset).toBeLessThan(save)
    expect(stop).toBeGreaterThan(save)

    // Everything that acts on the save comes after the stop.
    for (const act of [
      'promoteToSites()',
      'revalidateLivePages(',
      'clearServerDraft(',
      'updateScreenDoc(',
      'updateLayoutDoc(',
    ]) {
      const at = body.indexOf(act)
      if (at === -1) continue
      expect(at).toBeGreaterThan(stop)
    }
  })
})
