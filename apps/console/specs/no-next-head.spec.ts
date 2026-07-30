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

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * `next/head` renders NOTHING in the App Router (AGL-1138).
 *
 * This has now cost us twice. AGL-1059 found it for page titles — every route
 * in the console rendered the default title because `NextPageTitle` went
 * through `next/head` — and fixed it with the Metadata API. The font
 * stylesheet links in the five editor pages stayed on the dead mechanism, so
 * every Besigner canvas and the Preview rendered in a fallback face while the
 * code that requested the webfont looked entirely correct.
 *
 * That is the trap worth guarding: this failure is INVISIBLE. Nothing throws,
 * nothing warns, the href is computed correctly, and the only symptom is that
 * a document silently lacks something. A test is the only thing that notices.
 */
describe('next/head is never imported under app/', () => {
  it('has no `from \'next/head\'` import in the App Router tree', () => {
    const appDir = join(__dirname, '..', 'app')
    let matches = ''
    try {
      // grep exits 1 with no matches, which is the passing case.
      matches = execFileSync(
        'grep',
        ['-rn', "from 'next/head'", appDir],
        { encoding: 'utf8' },
      )
    } catch {
      matches = ''
    }
    // Note the trailing quote in the pattern: `next/headers` is a real and
    // entirely legitimate App Router import, and matching it would make this
    // test fail on correct code. That exact false positive cost a wrong file
    // count in the issue this test comes from.
    expect(matches.trim()).toBe('')
  })
})
