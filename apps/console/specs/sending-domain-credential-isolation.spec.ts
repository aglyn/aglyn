/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * The domains credential belongs to the console, and the tenant runtime must
 * not be able to reach it.
 *
 * `RESEND_DOMAINS_API_KEY` is FULL ACCESS. A key that can create a sending
 * domain can also list every domain in the account, read the account's API
 * keys and mint more of them. `RESEND_API_KEY` is send-only restricted, which
 * is why `email-health.ts` can safely use `GET /domains` as a read-only probe;
 * this one has no such ceiling.
 *
 * The tenant runtime serves published sites to the public internet and renders
 * tenant-authored content. Anything it can import is one bug away from being
 * reachable from a site request, so the isolation cannot be "we remembered not
 * to" — it has to be a property of where the file lives.
 *
 * ## What makes it structural
 *
 * The driver is in `apps/console/utils/server/`. `tsconfig.base.json` maps
 * `@aglyn/*` to `libs/*` and nothing to an app, so there is no specifier the
 * tenant app could write; nx's `enforce-module-boundaries` forbids an app
 * depending on another app; and Next bundles each app from its own directory.
 * A tenant-side module cannot import it without first moving it.
 *
 * ## Why a sweep rather than a unit test
 *
 * No test of any one module can find this, because each one passes. Only an
 * exhaustive read of the tree can — the same argument
 * `email-send-metering-coverage.spec.ts` makes about metering call sites.
 * Moving the driver into a library to "share" it, or adding a second read of
 * the variable in `libs/`, fails here naming the file.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const SEARCH_ROOTS = ['apps', 'libs', 'tools', 'cloud'].map((dir) =>
  join(REPO_ROOT, dir),
)

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', '.nx', 'tmp'])
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/** The variable, spelled so this file is not itself a hit for its own sweep. */
const CREDENTIAL = ['RESEND', 'DOMAINS', 'API', 'KEY'].join('_')

/** The one module allowed to read it, relative to the repo root. */
const DRIVER = join('apps', 'console', 'utils', 'server', 'sending-domain-provider.ts')

/** A specifier that would reach the driver from anywhere. */
const DRIVER_BASENAME = 'sending-domain-provider'

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...sourceFiles(full))
      continue
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(full)
    }
  }
  return found
}

const FILES = SEARCH_ROOTS.flatMap(sourceFiles).map((path) => ({
  path: relative(REPO_ROOT, path),
  text: readFileSync(path, 'utf8'),
}))

const CONSOLE_PREFIX = join('apps', 'console') + sep

describe('the sweep can actually see the tree', () => {
  /*
   * The premise guard. A search that silently matched nothing would let every
   * assertion below pass while proving nothing at all — the failure mode a
   * blocked directory or a bad root produces, and the reason a control that
   * is known to be present is checked first.
   */
  it('reads thousands of source files, including the driver and the store seam', () => {
    expect(FILES.length).toBeGreaterThan(1000)
    expect(FILES.some((file) => file.path === DRIVER)).toBe(true)
    expect(
      FILES.some(
        (file) =>
          file.path === join('libs', 'tenant', 'data', 'admin', 'src', 'lib', 'server', 'sending-domains.ts'),
      ),
    ).toBe(true)
  })

  it('finds the send-only key it is NOT policing, so a zero result would be visible', () => {
    // A control with a known-present value. `RESEND_API_KEY` is read in both
    // apps and in libs, by design; if this returns nothing the sweep is broken.
    const sendKey = FILES.filter((file) => file.text.includes('RESEND_API_KEY'))
    expect(sendKey.length).toBeGreaterThan(0)
  })
})

describe('the full-access domains credential', () => {
  /** `process.env.<NAME>` — the read itself, not a mention of the name. */
  const READ = new RegExp(`process\\s*\\.\\s*env\\s*[.[]\\s*['"\`]?${CREDENTIAL}`)

  it('is READ by exactly one module, and that module is in the console app', () => {
    // Specs are excluded: one SETS the variable to exercise the driver, which
    // is arranging a fixture rather than reading a credential, and no spec is
    // part of either app's bundle. The next case covers them anyway by
    // refusing the name anywhere outside the console.
    const readers = FILES.filter(
      (file) => !/\.spec\.tsx?$/.test(file.path) && READ.test(file.text),
    ).map((file) => file.path)

    expect(readers).toEqual([DRIVER])
  })

  it('is not so much as NAMED by any library — a lib is importable by the tenant runtime', () => {
    const named = FILES.filter(
      (file) => !file.path.startsWith(CONSOLE_PREFIX) && file.text.includes(CREDENTIAL),
    ).map((file) => file.path)

    expect(named).toEqual([])
  })
})

describe('the driver module', () => {
  it('is imported only from inside the console app', () => {
    const importers = FILES.filter(
      (file) =>
        file.path !== DRIVER &&
        new RegExp(`from ['"][^'"]*${DRIVER_BASENAME}['"]`).test(file.text),
    ).map((file) => file.path)

    expect(importers.length).toBeGreaterThan(0)
    for (const importer of importers) {
      expect(importer.startsWith(CONSOLE_PREFIX)).toBe(true)
    }
  })

  /**
   * The seam the tenant runtime DOES import takes a key as an argument and
   * reads no environment. Moving the credential read into it would put the
   * full-access key one import away from tenant request handling.
   */
  it('is not what the shared store seam depends on', () => {
    const store = FILES.find(
      (file) =>
        file.path ===
        join('libs', 'tenant', 'data', 'admin', 'src', 'lib', 'server', 'sending-domains.ts'),
    )

    expect(store.text).not.toMatch(new RegExp(`from ['"][^'"]*${DRIVER_BASENAME}['"]`))
    expect(store.text).not.toContain(CREDENTIAL)
  })
})
