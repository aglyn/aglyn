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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * NOTHING MAY PASS A JSX PROP NAMED `displayName` (AGL-2486).
 *
 * ## The measurement
 *
 * This app's browser build STRIPS it. Proven by passing the identical value
 * under two names on one element and reading the result out of the running
 * page:
 *
 *   name: entry.displayName || 'Someone'   <- emitted into the chunk
 *   displayName={...}                      <- absent from the chunk AND from
 *                                             the component's received props
 *
 * `RoomAvatars.toString()` in the browser contained no occurrence of the
 * string `displayName` at all, while the source passed it as the FIRST prop.
 * The same thing happened to the user menu, which is how it was confirmed to
 * be a property of the prop NAME rather than of one component.
 *
 * ## What it cost
 *
 * `MemberAvatar` took `displayName` from the day it was written (AGL-1126).
 * Every call site — the user menu, the account page, the team page, both
 * member cards, and the presence stack — had been handing it a prop that
 * never arrived. Where an `email` was also passed the component quietly fell
 * back to the address, so `zach@aglyn.com` rendered as a plain `Z`; where one
 * was not, it rendered `?`. Zach reported that as "still getting the question
 * marks" after two rounds of fixes that were looking in the wrong place: the
 * RTDB rows were perfect, and every row said `displayName: "Zach Gover"`.
 *
 * ## Why a source guard rather than a runtime one
 *
 * The unit suite could not see this and cannot be made to: jest compiles with
 * a different transform, which KEEPS the prop. `member-avatar.component.spec`
 * rendered `<MemberAvatar displayName="Ada Lovelace" />`, asserted the
 * initials were `AL`, and passed — against a browser build in which that prop
 * does not exist. A green component test proved only that jest's compiler
 * disagrees with the browser's. So the assertion has to be made about the
 * SOURCE, which is the one artifact both compilers share.
 */

const ROOT = resolve(__dirname, '..', '..', '..')
const ROOTS = [join(ROOT, 'apps'), join(ROOT, 'libs')]
const SKIP = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.nx',
  '.turbo',
])

/**
 * A JSX ATTRIBUTE only: `displayName={` or `displayName="`.
 *
 * Deliberately does not match `Foo.displayName = 'Foo'` (spaces around the
 * `=`) or `{ displayName: value }` in an object literal. Those are the
 * legitimate uses and they are unaffected — React reads the component's own
 * `displayName` off the function, and the compiler never touches an object
 * key. It is exclusively the JSX attribute position that is unsafe.
 */
const JSX_ATTRIBUTE = /(?<![.\w])displayName=[{"']/

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (path.endsWith('.tsx')) yield path
  }
}

describe('a JSX prop named `displayName` (AGL-2486)', () => {
  it('appears nowhere, because this build silently deletes it', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, 'utf8')
        source.split('\n').forEach((line, index) => {
          if (JSX_ATTRIBUTE.test(line)) {
            offenders.push(`${relative(ROOT, file)}:${index + 1}`)
          }
        })
      }
    }
    // Every entry here is a prop the browser will drop on the floor. Rename
    // it — `name` is measured to survive — rather than adding it to a list.
    expect(offenders).toEqual([])
  })
})
