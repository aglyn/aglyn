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
 * SAVE & PUBLISH ON A PAGE REPORTS ONCE (AGL-3891).
 *
 * The page editor's Save & publish runs a save and then the publish. The save
 * used to speak as if it were alone: "Page saved — your live page is
 * refreshing now", plus its own cache drop and that drop's warning, under the
 * publish's "Saved and published" and the publish's own cache warning. One
 * press stacked four toasts. While the save step runs inside a publish it
 * keeps its refusals and says nothing else; the publish drops the cache and
 * reports.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGE = join(
  __dirname,
  '..',
  'app',
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
)
const source = readFileSync(PAGE, 'utf8')

describe('Save & publish on a page', () => {
  it('runs its save step marked as part of the publish, and clears the mark however the save ends', () => {
    expect(source).toMatch(
      /publishingRef\.current = true\s*try \{\s*await handleSave\(\)\s*\} finally \{\s*publishingRef\.current = false\s*\}/,
    )
  })

  it('drops only the save step success toast, never a refusal', () => {
    expect(source).toMatch(
      /notify: \(message, options\) =>\s*publishingRef\.current && options\?\.variant === 'success'/,
    )
  })

  it('leaves the cache drop to the publish while the save step runs', () => {
    expect(source).toMatch(
      /versionId === screenResult\?\.data\?\.versionId &&\s*!publishingRef\.current/,
    )
  })
})
