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
 * AGL-1888 — the ownership-transfer lockout check cannot be walked around.
 *
 * `assessOwnershipTransferLockout` belongs inside `transferOrgOwnership`,
 * one layer below every caller, the way `enforceSsoSignInMethods` holds its
 * own pre-flight. It cannot go there: `organizations.ts` is imported by
 * `notifications.ts`, which `sso-enforcement.ts` imports, so the library
 * reaching back for the engine is an import cycle. The alternative — a second
 * copy of the assessment written to avoid the cycle — is worse, because two
 * copies of a security control diverge and the laxer one is the one that
 * decides.
 *
 * So the check sits at the call site, and THIS is what makes that safe: the
 * property "there is exactly one production call site, and it checks first"
 * is asserted rather than assumed. A second caller added anywhere in the repo
 * fails this suite, which is the moment to move the check rather than copy it.
 *
 * A source-text guard, like `sso-enforcement-console-owned.spec.ts`. It reads
 * the tree, so deleting the wiring cannot leave it green.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO = join(__dirname, '..', '..', '..')
const ROOTS = ['apps', 'libs', 'tools', 'cloud']
const SKIP = new Set([
  'node_modules',
  'dist',
  '.next',
  'coverage',
  '.nx',
  'out-tsc',
])
const CODE = /\.(ts|tsx|mjs|js)$/
/** Specs may call it freely — they are not a way into production. */
const IS_SPEC = /\.(spec|test)\.[tj]sx?$/

function walk(dir: string, found: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) walk(full, found)
    else if (CODE.test(entry) && !IS_SPEC.test(entry)) found.push(full)
  }
  return found
}

const SOURCES = ROOTS.flatMap((root) => walk(join(REPO, root)))

const ROUTE_PATH = 'apps/console/app/api/orgs/settings/route.ts'
/** Where the function is declared, and the barrel that re-exports it. */
const DEFINITION = 'libs/tenant/data/admin/src/lib/server/organizations.ts'

const callers = SOURCES.filter((file) =>
  /\btransferOrgOwnership\s*\(/.test(readFileSync(file, 'utf8')),
).map((file) => relative(REPO, file))

const ROUTE = readFileSync(join(REPO, ROUTE_PATH), 'utf8')

describe('AGL-1888 · every ownership transfer passes the lockout check', () => {
  it('walked a real tree, not an empty one', () => {
    // Without this the whole suite passes vacuously if `walk` ever returns
    // nothing — a directory rename would silently retire the guard.
    expect(SOURCES.length).toBeGreaterThan(500)
    expect(SOURCES.map((file) => relative(REPO, file))).toContain(ROUTE_PATH)
  })

  it('has exactly ONE production call site besides the definition', () => {
    // The property the route-level placement rests on. A second caller is not
    // necessarily wrong — it is the signal that the check has to move down
    // into `transferOrgOwnership`, cycle or no cycle.
    expect(callers.sort()).toEqual([DEFINITION, ROUTE_PATH].sort())
  })

  it('the route checks BEFORE it transfers', () => {
    const check = ROUTE.indexOf('assessOwnershipTransferLockout(')
    const transfer = ROUTE.indexOf('await transferOrgOwnership(')
    expect(check).toBeGreaterThan(-1)
    expect(transfer).toBeGreaterThan(-1)
    // Ordering, not mere presence. A check that ran after the transaction
    // would read as wired up and protect nothing.
    expect(check).toBeLessThan(transfer)
  })

  it('a refusal returns before the transfer, and is logged', () => {
    const block = ROUTE.slice(
      ROUTE.indexOf('assessOwnershipTransferLockout('),
      ROUTE.indexOf('await transferOrgOwnership('),
    )
    expect(block).toContain('lockout.refused')
    expect(block).toContain('status: 409')
    // Customer-visible, not just refused. This is the only surface on which
    // an org can see that a transfer was attempted and why it did not happen.
    expect(block).toContain('logOrgActivity')
  })

  it('the check is not gated on the caller being a customer', () => {
    // Staff can transfer any org without being a member of it. Stranding a
    // customer is stranding a customer whoever clicked, so the refusal must
    // not sit behind a `staff !== true`.
    const block = ROUTE.slice(
      ROUTE.indexOf('assessOwnershipTransferLockout('),
      ROUTE.indexOf('await transferOrgOwnership('),
    )
    expect(block).not.toContain('staff')
  })
})
