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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every emulator connection a page makes reads the host its server was given
 * (AGL-2834).
 *
 * A page cannot see `FIRESTORE_EMULATOR_HOST` and its siblings. It sees the
 * `NEXT_PUBLIC_` twins the `serve:*:emulated` scripts set, through the readers
 * in `firebase-emulator-hosts.ts`. One connection left on a literal is enough
 * to split a stack: an Auth instance on 9099 signs a person in to whichever
 * emulator holds 9099, while every read follows the private ports with the
 * token that emulator minted. So this sweeps every `connect*Emulator` call in
 * app and library source, rather than the call sites someone remembered.
 */
const repoRoot = join(__dirname, '..', '..', '..')

const CONNECT = /connect(?:Auth|Firestore|Database|Storage|Functions)Emulator\(/g

/** A quoted loopback address, or a bare port passed as an argument. */
const LITERAL_ADDRESS =
  /['"`](?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])|[,(]\s*\d{2,5}\s*[,)]/

/** Each call's text, from its name to the parenthesis that closes it. */
function connectCalls(source: string): Array<{ call: string; line: number }> {
  const calls: Array<{ call: string; line: number }> = []
  for (const match of source.matchAll(CONNECT)) {
    const start = match.index ?? 0
    let end = start + match[0].length
    let depth = 1
    while (end < source.length && depth > 0) {
      if (source[end] === '(') depth += 1
      else if (source[end] === ')') depth -= 1
      end += 1
    }
    calls.push({
      call: source.slice(start, end).replace(/\s+/g, ' '),
      line: source.slice(0, start).split('\n').length,
    })
  }
  return calls
}

const sourceFiles = execFileSync(
  'git',
  [
    'grep',
    '-lE',
    'connect(Auth|Firestore|Database|Storage|Functions)Emulator\\(',
    '--',
    'apps',
    'libs',
  ],
  { cwd: repoRoot, encoding: 'utf8' },
)
  .split('\n')
  .filter(
    (path) =>
      /\.[cm]?[jt]sx?$/.test(path) &&
      !/\.(spec|test)\.[cm]?[jt]sx?$/.test(path) &&
      !/(^|\/)specs\//.test(path),
  )

const calls = sourceFiles.flatMap((path) =>
  connectCalls(readFileSync(join(repoRoot, path), 'utf8')).map((found) => ({
    path,
    ...found,
  })),
)

describe('browser emulator connections (AGL-2834)', () => {
  it('finds the connections it guards', () => {
    // Firestore and Auth in the Firebase services provider, and Auth and the
    // Realtime Database in the presence session. Fewer means the sweep stopped
    // reaching them, and a sweep that reaches nothing passes.
    expect(calls.length).toBeGreaterThanOrEqual(4)
  })

  it('connects each one to a host read from the environment, never a literal', () => {
    const literal = calls
      .filter(({ call }) => LITERAL_ADDRESS.test(call))
      .map(({ path, line, call }) => `${path}:${line} ${call}`)
    expect(literal).toEqual([])
  })
})
