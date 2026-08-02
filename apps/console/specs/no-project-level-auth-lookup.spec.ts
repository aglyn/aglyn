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
import { join } from 'node:path'

/**
 * No project-level auth lookups (AGL-1122).
 *
 * A GCIP tenant user — anyone who signs in through SSO — is not in the
 * project user pool. `auth().getUser()` throws `auth/user-not-found` for them
 * and `auth().getUserByEmail()` / `listUsers()` simply omit them. Every one of
 * those reads compiles, passes review, and works perfectly for every account
 * except the ones on the plan that pays the most.
 *
 * AGL-1122 listed five call sites and fixed them. Six more were found on
 * 2026-08-01 by grepping instead of reading the list — including the usage
 * email and the erasure notice, both of which `.catch(() => undefined)` the
 * failure and record the org as having no email address. That is the shape
 * this guards: the failure is silent, so nothing surfaces it but a grep.
 *
 * The fix is always `findUserByUidAcrossPools` / `findUserByEmailAcrossPools`
 * / `listUsersAcrossPools` / `listStaffUidsAcrossPools` from
 * `libs/tenant/data/admin/src/lib/server/auth-pools.ts`, and `authForPool` to
 * act on the record afterwards.
 */

/** Calls that only ever see the project pool. */
const FORBIDDEN = [
  'getUserByEmail',
  'listUsers',
  'getUser',
]

/**
 * Reads that are fine because the receiver is already a pool-scoped auth —
 * `authForPool(t).getUser(...)` and `authForTenant(t).listUsers(...)` are the
 * correct calls, not the bug.
 */
const ALLOWED_RECEIVER = /(authForPool|authForTenant|\bpool)\s*(\([^)]*\))?\s*$/

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path) && !/\.spec\.tsx?$/.test(path)) yield path
  }
}

/**
 * `libs/` is walked too (AGL-1144). The commerce billing webhook had this bug
 * and was invisible to a console-only guard — which is exactly how it was
 * found by grep rather than by CI. The receiver allowlist already handles the
 * legitimate pool-scoped calls that live there, like `sso-enforcement.ts`
 * calling `pool.listUsers`.
 */
const ROOTS = [
  join(__dirname, '..', 'app'),
  join(__dirname, '..', '..', '..', 'libs'),
]

/**
 * `auth-pools.ts` IS the abstraction. Searching the project pool is half of
 * what "across pools" means, so the one file implementing it necessarily
 * makes the calls every other file is forbidden from making. Exempting it by
 * path rather than by a receiver pattern keeps that explicit — a second file
 * claiming the exemption has to edit this line and say why.
 */
const EXEMPT = /auth-pools\.ts$/

describe('project-level auth lookups (AGL-1122)', () => {
  it('are not used anywhere in the console or libs', () => {
    const offenders: string[] = []
    for (const file of ROOTS.flatMap((root) => [...sourceFiles(root)])) {
      if (EXEMPT.test(file)) continue
      const source = readFileSync(file, 'utf8')
      const lines = source.split('\n')
      lines.forEach((line, index) => {
        for (const call of FORBIDDEN) {
          const at = line.indexOf(`.${call}(`)
          if (at < 0) continue
          // What is this being called ON? A pool-scoped auth is correct.
          const receiver = line.slice(0, at)
          if (ALLOWED_RECEIVER.test(receiver)) continue
          // A chained `.getUser` on the previous line's receiver — the
          // multi-line `await auth\n.getUser(uid)` shape that hid three of
          // these until 2026-08-01.
          const previous = lines[index - 1] ?? ''
          if (ALLOWED_RECEIVER.test(previous.trimEnd())) continue
          offenders.push(
            `${file.split(/\/(?:apps|libs)\//)[1] ?? file}:${index + 1} → .${call}(`,
          )
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
