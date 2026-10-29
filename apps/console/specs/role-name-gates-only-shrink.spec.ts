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

/**
 * NO NEW GATE ON A ROLE NAME (AGL-4047).
 *
 * Every action is permission-checked, and roles (the built-in ones and custom
 * ones) are only presets of permissions: a route, a rule or a console control
 * that asks "is this member an Admin?" cannot be granted to anyone outside
 * that role or refused to anyone in it. The ones that remain are being
 * converted to catalog keys whose presets keep today's access exactly, and
 * this guard holds the line while they are: it counts, per file, the lines
 * that decide on a role NAME, and the count must equal the allowlist's.
 *
 *   - A NEW role gate (a file not on the list, or a count above it) fails:
 *     check a permission key instead (`memberHasOrgPermission`,
 *     `memberHasPermissionOnHost`, a site-role preset key read with
 *     `hostStampedSitePermission`, the console's `can()` /
 *     `usePermissionsOnHost`).
 *   - A CONVERTED one (a count below the list) fails too, until the list is
 *     lowered in the same change: the allowlist only shrinks.
 *
 * `role-name-gates.allowlist.json` beside this file names every file still
 * holding one, with its kind:
 *
 *   - `exception`: an act tied to ownership itself (transfer the workspace,
 *     its URL, the owner hand-off), which stays the owner's by design;
 *   - `not-a-gate`: a role read that decides no caller's access (who a notice
 *     goes to, validating a role a request names, protecting the owner as the
 *     TARGET of an edit);
 *   - `pending`: a gate still to convert, listed in the AGL-4047 inventory.
 *
 * Comment lines are not counted, and the rules are read from the
 * comment-stripped artifact that deploys, so prose that names a role is
 * never a gate.
 */

const REPO_ROOT = resolve(__dirname, '../../..')
const ALLOWLIST_PATH = resolve(__dirname, 'role-name-gates.allowlist.json')

/** Where a role gate can decide something: servers, rules, and the console's controls. */
export const ROLE_GATE_ROOTS = [
  'apps/console/app',
  'apps/console/components',
  'apps/console/hooks',
  'apps/console/utils',
  'apps/tenant',
  'libs/plugins',
  'libs/tenant',
]

const EXCLUDED = [':!*.spec.*', ':!*.test.*', ':!*/src/ios/*', ':!*/src/android/*', ':!*.generated.*']

/**
 * A line that decides on a role name in TypeScript: a role helper called, a
 * role-ish name compared with a role literal (either way round), a list of
 * role literals, a `*_ROLES` set asked, or `role in [...]`.
 */
export const TS_ROLE_GATE = [
  String.raw`\b(hostRoleCanWrite|hostRoleCanPublish|canWriteHost|canPublishHost|canManageOrg|orgRoleAtLeast)\(`,
  String.raw`(role|Role)\b[^=!;]{0,40}(===|!==)\s*'(owner|admin|editor|author|viewer)'`,
  String.raw`'(owner|admin|editor|author|viewer)'\s*(===|!==)\s*[A-Za-z_.?]*(role|Role)\b`,
  String.raw`\[\s*'(owner|admin|editor|author)',\s*'(owner|admin|editor|author|viewer)'`,
  String.raw`(ROLES|Roles)\.(includes|has)\(`,
  String.raw`\b(role|Role)\s+in\s+\[`,
  // A projection read inline: `memberRoles[uid] === 'admin'`.
  String.raw`memberRoles\b[^;=!]{0,60}(===|!==)\s*'(owner|admin|editor|author|viewer)'`,
].join('|')

/**
 * The deployed rules: a role helper called, or a role compared with a literal
 * or a literal list. `canWriteHostContent`, `canPublishHostContent` and
 * `canReadHostSensitive` are not on it: they ask the site keys (AGL-4047).
 * Nor is `canReadTransferJobs`, which asks "Manage data" alone.
 */
export const RULES_ROLE_GATE = [
  String.raw`\b(canManageOrg|canWriteOrgData|canWriteOrgWideData|isOrgWideAudienceManager|publisherManager|listingManager|canReadScopedPeople|canReadOutreach)\(`,
  String.raw`hostMemberRole\(hostId\)\s*(==|in)\s*['\[]`,
  String.raw`\brole\s*(==|in)\s*['\[]`,
  String.raw`\.role\s+in\b`,
  String.raw`\bin\s*\[\s*'(owner|admin|editor|author)'`,
].join('|')

export const RULES_FILE = 'cloud/firebase-firestore.deploy.rules'

function grep(pattern: string, paths: string[]): string[] {
  try {
    return execFileSync('git', ['grep', '-n', '--untracked', '-P', pattern, '--', ...paths], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean)
  } catch {
    // `git grep` exits 1 when nothing matches: an answer, not a failure.
    return []
  }
}

/** Per file, how many non-comment lines decide on a role name. */
export function roleGateCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  const lines = [...grep(TS_ROLE_GATE, [...ROLE_GATE_ROOTS, ...EXCLUDED]), ...grep(RULES_ROLE_GATE, [RULES_FILE])]
  for (const line of lines) {
    const match = /^([^:]+):\d+:(.*)$/.exec(line)
    if (!match) continue
    const [, file, text] = match
    if (/^\s*(\*|\/\/|\/\*)/.test(text)) continue
    counts[file] = (counts[file] ?? 0) + 1
  }
  return counts
}

type Kind = 'exception' | 'not-a-gate' | 'pending'

interface AllowlistEntry {
  count: number
  kind: Kind
  note?: string
}

const ALLOWLIST = (JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as { files: Record<string, AllowlistEntry> }).files

describe('no new gate on a role name (AGL-4047)', () => {
  const counts = roleGateCounts()

  it('the search really searches: it finds the gates still on the list, and a pattern for nothing finds nothing', () => {
    expect(Object.keys(counts).length).toBeGreaterThan(10)
    expect(counts[RULES_FILE]).toBeGreaterThan(0)
    expect(grep(String.raw`\bnoSuchRoleHelperAnywhere\(`, ROLE_GATE_ROOTS)).toEqual([])
  })

  it('every file that still decides on a role name is on the allowlist, at exactly its count', () => {
    const drift = Object.entries(counts)
      .filter(([file, count]) => ALLOWLIST[file]?.count !== count)
      .map(([file, count]) => `${file}: ${count} role-name line(s), allowlist says ${ALLOWLIST[file]?.count ?? 'nothing'}`)
    expect(drift).toEqual([])
  })

  it('names no file that no longer holds one: the list only shrinks', () => {
    expect(Object.keys(ALLOWLIST).filter((file) => !counts[file])).toEqual([])
  })

  it('says why each exception and each non-gate stays', () => {
    const unexplained = Object.entries(ALLOWLIST)
      .filter(([, entry]) => entry.kind !== 'pending' && !entry.note?.trim())
      .map(([file]) => file)
    expect(unexplained).toEqual([])
    for (const entry of Object.values(ALLOWLIST)) {
      expect(['exception', 'not-a-gate', 'pending']).toContain(entry.kind)
    }
  })
})
