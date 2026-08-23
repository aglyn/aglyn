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
/**
 * `apps/tenant` is walked too (AGL-2005). It was not, and it held a live one:
 * `api/edit-access/exchange` called project-level `getUser(claims.uid)`, so
 * every SSO user was refused edit access with "No edit access" — a message
 * that reads as a permission decision rather than a lookup that never
 * happened. It survived because the forged project-pool twin AGL-1962
 * describes answered the call; deleting that twin re-exposed it.
 *
 * The lesson is about the guard, not the route. A guard is only as wide as
 * its roots, and this one passed for months while an app it never opened
 * carried the exact bug it exists to find. Any new app serving authenticated
 * routes belongs on this list.
 */
const ROOTS = [
  join(__dirname, '..', 'app'),
  join(__dirname, '..', '..', 'tenant', 'app'),
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

/**
 * The CODE on each line, with comments blanked out and the line numbering
 * intact (AGL-2486).
 *
 * The guard used to scan raw lines, and on 2026-08-23 it went red on a DOC
 * COMMENT — `firebase-admin.ts` had just gained a comment explaining that
 * `assertIdTokenNotRevoked` names its parameter `pool`, which is precisely
 * why this guard missed a real bug. Prose describing the pattern tripped the
 * detector for the pattern.
 *
 * Blanked rather than removed so `index + 1` still reports the true line, and
 * so the previous-line receiver lookup below still sees the line it expects
 * — deleting comment lines would silently shift both.
 *
 * Block state is carried ACROSS lines, which is the whole point: a JSDoc
 * block is many lines and only its first carries the opener. `//` is honoured
 * only outside quotes, so a `'https://…'` in real code is not mistaken for
 * the start of a comment — the failure that would matter here is a FALSE
 * NEGATIVE, a real call hidden behind an over-eager stripper.
 */
function codeLines(source: string): string[] {
  let inBlock = false
  return source.split('\n').map((line) => {
    let out = ''
    let quote: string | null = null
    for (let i = 0; i < line.length; i += 1) {
      const two = line.slice(i, i + 2)
      if (inBlock) {
        if (two === '*/') {
          inBlock = false
          out += '  '
          i += 1
        } else {
          out += ' '
        }
        continue
      }
      if (quote) {
        out += line[i]
        if (line[i] === '\\') {
          out += line[i + 1] ?? ''
          i += 1
        } else if (line[i] === quote) quote = null
        continue
      }
      if (line[i] === "'" || line[i] === '"' || line[i] === '`') {
        quote = line[i]
        out += line[i]
        continue
      }
      if (two === '//') return out + ' '.repeat(line.length - i)
      if (two === '/*') {
        inBlock = true
        out += '  '
        i += 1
        continue
      }
      out += line[i]
    }
    return out
  })
}

describe('project-level auth lookups (AGL-1122)', () => {
  it('are not used anywhere in the console, the tenant app, or libs', () => {
    const offenders: string[] = []
    for (const file of ROOTS.flatMap((root) => [...sourceFiles(root)])) {
      if (EXEMPT.test(file)) continue
      const source = readFileSync(file, 'utf8')
      const lines = codeLines(source)
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
