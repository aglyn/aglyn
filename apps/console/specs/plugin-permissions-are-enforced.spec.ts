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
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../..')

/**
 * EVERY PLUGIN-DECLARED permission is enforced by SERVER code (AGL-2474).
 *
 * The sibling guard `org-permissions-are-enforced.spec.ts` makes exactly this
 * promise for the dotted `ORG_PERMISSIONS` catalog, and `managePos` shipped
 * declared-but-unread anyway — because the plugin registry is a SECOND
 * vocabulary that guard never looked at. `org-permissions.ts` even carries the
 * rule ("EVERY KEY HERE MUST BE ENFORCED SERVER-SIDE") and points future
 * granular permissions at the plugin mechanism, so the gap was structural: the
 * documented path to adding a permission was the one path with no coverage.
 *
 * A green check only proves what it reads. This one reads the other half.
 *
 * ## Why the keys are parsed as TEXT rather than imported
 *
 * The registry is populated by `registerPluginPermissions` at plugin module
 * scope, so importing it from a spec measures IMPORT ORDER, not what the repo
 * declares — an empty registry would make every assertion below pass. Reading
 * the declaration files means the guard sees a key the moment somebody writes
 * it down, which is the moment it starts being a promise.
 */

/** Same roots as the dotted-catalog guard: where a check can actually bite. */
const ENFORCEMENT_ROOTS = [
  'apps/console/app/api',
  'libs/tenant/data/admin/src',
  'libs/tenant/runtime/src',
  'libs/plugins',
]

/**
 * Files that MENTION a plugin key without enforcing it: the declaration
 * itself, and the resolver that mixes every registered key into the map.
 * Without this exclusion the guard passes for a registry nothing reads —
 * precisely the state being fixed.
 */
const NOT_ENFORCEMENT = [
  'libs/plugins/commerce/src/lib/model/plugin-permissions.ts',
  'libs/aglyn/src/lib/plugin-manager/plugin-permissions.ts',
  'libs/aglyn/src/lib/app-utils/org-roles.ts',
  'libs/tenant/runtime/src/lib/org-permissions.ts',
]

function gitGrepFiles(needle: string, roots: string[]): string[] {
  try {
    return execFileSync(
      'git',
      ['grep', '-l', '--untracked', '--fixed-strings', needle, '--', ...roots],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
      .split('\n')
      .filter(Boolean)
  } catch {
    // `git grep` exits 1 when nothing matches. That is an answer.
    return []
  }
}

/** Declaration modules: anything typed as a `PluginPermission[]`. */
function declarationFiles(): string[] {
  return gitGrepFiles('PluginPermission[]', ['libs/plugins'])
}

/** Every `key: '...'` a declaration file writes down. */
function declaredKeys(): { key: string; file: string }[] {
  return declarationFiles().flatMap((file) => {
    const source = readFileSync(resolve(REPO_ROOT, file), 'utf8')
    return [...source.matchAll(/\bkey:\s*'([A-Za-z0-9_]+)'/g)].map((match) => ({
      key: match[1],
      file,
    }))
  })
}

function serverFilesEnforcing(key: string): string[] {
  // `permissions.managePos` is the shape a resolved map is read through;
  // the quoted key covers a route that indexes it dynamically.
  return [`permissions.${key}`, `'${key}'`]
    .flatMap((needle) => gitGrepFiles(needle, ENFORCEMENT_ROOTS))
    .filter((path) => !/\.spec\./.test(path))
    .filter((path) => !NOT_ENFORCEMENT.includes(path))
}

describe('every plugin-declared permission is enforced server-side (AGL-2474)', () => {
  it('finds the declarations at all', () => {
    // Anti-vacuity #1. If the discovery regex or the pathspec breaks, every
    // `it.each` below silently becomes zero cases and the suite goes green
    // over an unread registry — the exact failure this guard exists to catch.
    const keys = declaredKeys()
    expect(declarationFiles().length).toBeGreaterThan(0)
    expect(keys.map((entry) => entry.key)).toContain('managePos')
  })

  it('the search really searches — a key nobody declares finds nothing', () => {
    // Anti-vacuity #2, mirroring the dotted guard: prove the grep can come
    // back empty AND can come back full, so an empty result means something.
    expect(serverFilesEnforcing('noSuchPluginPermission')).toEqual([])
    expect(
      gitGrepFiles('resolveOrgPermissions', ENFORCEMENT_ROOTS).length,
    ).toBeGreaterThan(5)
  })

  it('the declaration and resolver files are excluded, and DO mention the key', () => {
    // The exclusion is load-bearing. Without it `managePos` looks enforced by
    // the file that declares it, which is how it shipped unenforced.
    const raw = gitGrepFiles('managePos', ['libs'])
    expect(raw).toContain(
      'libs/plugins/commerce/src/lib/model/plugin-permissions.ts',
    )
    expect(serverFilesEnforcing('managePos')).not.toContain(
      'libs/plugins/commerce/src/lib/model/plugin-permissions.ts',
    )
  })

  it.each(declaredKeys().map((entry) => [entry.key, entry.file]))(
    '%s (declared in %s) is checked by at least one server file',
    (key: string) => {
      // Declaring a permission without wiring a check fails HERE, with the
      // key named — not as a capability a customer is told they have.
      expect(serverFilesEnforcing(key)).not.toEqual([])
    },
  )
})
