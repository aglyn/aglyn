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
import { resolve } from 'node:path'

import { ORG_PERMISSION_KEYS, type OrgPermission } from '@aglyn/aglyn'

const REPO_ROOT = resolve(__dirname, '../../..')

/**
 * EVERY advertised org permission is enforced by SERVER code (AGL-2444).
 *
 * `custom-roles.md` states the guarantee outright — "Permissions are enforced
 * everywhere — across the console's APIs and every surface" — and three of
 * the eleven keys had zero consumers anywhere. An owner could build a custom
 * role, untick "Delete sites", assign it, and the member deleted sites; the
 * console did not even dim the control, because nothing read the key.
 *
 * That is worse than the permission not existing. Its absence would be a
 * missing feature; its presence is a control the customer is told they have.
 *
 * ## Why the search is for the ENFORCEMENT name, not the key
 *
 * Two keys are enforced through the legacy camelCase projection that
 * `toLegacyPermissions` produces — `marketplace.publish` reaches the
 * marketplace publish paths as `permissions.publishToMarketplace`. Searching
 * only for the dotted string would report those as unenforced and invite
 * somebody to "fix" a working gate. The alias map below is therefore part of
 * the assertion: adding a key means naming where it bites.
 *
 * ## Why some files are excluded
 *
 * `org-permissions.ts` DEFINES the keys and `libs/tenant/runtime`'s namesake
 * PROJECTS them; both mention every key, so counting them would make this
 * guard pass for a catalog nothing enforces — which is precisely the state
 * being fixed. Specs are excluded for the same reason: a key used as a
 * convenient sample in a merge-layering test was how `data.manage` and
 * `marketing.manage` looked consumed while governing nothing.
 */
const ENFORCEMENT_ROOTS = [
  'apps/console/app/api',
  'libs/tenant/data/admin/src',
  'libs/tenant/runtime/src',
  'libs/plugins',
]

/** Files that MENTION every key without enforcing any. */
const NOT_ENFORCEMENT = [
  'libs/aglyn/src/lib/app-utils/org-permissions.ts',
  'libs/aglyn/src/lib/app-utils/org-roles.ts',
  'libs/tenant/runtime/src/lib/org-permissions.ts',
]

/**
 * Where each key actually bites, as a string a server file contains.
 *
 * The legacy aliases are the camelCase names `toLegacyPermissions` emits —
 * keep this in step with that function, and never add a key here without a
 * real call site behind it.
 */
const ENFORCED_AS: Record<OrgPermission, readonly string[]> = {
  'org.settings': ["'org.settings'"],
  'org.auditLog': ["'org.auditLog'"],
  'billing.view': ["'billing.view'"],
  'billing.manage': ["'billing.manage'"],
  'members.manage': ["'members.manage'", 'permissions.manageMembers'],
  'hosts.create': ["'hosts.create'", 'permissions.createHosts'],
  'hosts.delete': ["'hosts.delete'"],
  'data.manage': ["'data.manage'"],
  'marketplace.publish': [
    "'marketplace.publish'",
    'permissions.publishToMarketplace',
  ],
  'plugins.install': ["'plugins.install'", 'permissions.installPlugins'],
}

function serverFilesContaining(needle: string): string[] {
  let output: string
  try {
    output = execFileSync(
      'git',
      [
        'grep',
        '-l',
        // UNTRACKED too: a route added in this change is not in the index
        // yet, and a guard that only saw committed files would report a
        // freshly-wired permission as unenforced — teaching the next person
        // to ignore it. `.gitignore` still applies, so build output stays out.
        '--untracked',
        '--fixed-strings',
        needle,
        '--',
        ...ENFORCEMENT_ROOTS,
      ],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
  } catch {
    // `git grep` exits 1 with no matches, which is an answer, not a failure.
    return []
  }
  return output
    .split('\n')
    .filter(Boolean)
    .filter((path) => !/\.spec\./.test(path))
    .filter((path) => !NOT_ENFORCEMENT.includes(path))
}

describe('every advertised org permission is enforced server-side (AGL-2444)', () => {
  it('the catalog and the map name exactly the same keys', () => {
    // Adding a permission without deciding where it is enforced fails HERE,
    // with the key named, rather than as a silent hole a customer finds.
    expect([...ORG_PERMISSION_KEYS].sort()).toEqual(
      Object.keys(ENFORCED_AS).sort(),
    )
    expect(ORG_PERMISSION_KEYS.length).toBe(10)
  })

  it('the search really searches — a key nobody uses finds nothing', () => {
    // Anti-vacuity. A broken `git grep` invocation, a root list that matched
    // no files, or an exclusion that swallowed everything would make every
    // assertion below pass while reading nothing at all.
    expect(serverFilesContaining("'no.such.permission'")).toEqual([])
    expect(serverFilesContaining('resolveOrgMembership').length).toBeGreaterThan(
      5,
    )
  })

  it('the definition and projection files are excluded, and DO mention the keys', () => {
    // The exclusion is load-bearing: without it this guard passes for a
    // catalog nothing enforces, because those two files name every key.
    const raw = execFileSync(
      'git',
      ['grep', '-l', '--fixed-strings', "'plugins.install'", '--', 'libs'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
    expect(raw).toContain('libs/aglyn/src/lib/app-utils/org-permissions.ts')
  })

  it.each(ORG_PERMISSION_KEYS.map((key) => [key]))(
    '%s is checked by at least one server file',
    (key: OrgPermission) => {
      const files = ENFORCED_AS[key].flatMap(serverFilesContaining)
      expect([...new Set(files)].sort()).not.toEqual([])
    },
  )
})
