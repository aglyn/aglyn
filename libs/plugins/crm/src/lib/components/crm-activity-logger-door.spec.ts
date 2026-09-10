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

import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * CRM activity goes through ONE door, and it is not the low-level one
 * (AGL-2760).
 *
 * `useCrmActivityLogger` decides the feed from the level the act was
 * performed at: a site's `hosts/{hostId}/activity` under a site, the org's
 * `orgs/{orgId}/activity` through `crm/org-activity` at the organization
 * hub. `useHostActivityLogger` is the site half of that, and a surface that
 * reaches past the CRM hook for it can only write the site feed — so at the
 * org hub it either writes nothing or writes to a site the caller may hold
 * no role on.
 *
 * ## Why an import ratchet rather than a behavioral test
 *
 * The defect this guards is not a wrong VALUE, it is asking the wrong
 * question: `hostId ?? record.hostId` reads as a sensible fallback and is a
 * gate mismatch, because the record write is authorized on the ORG and the
 * append on the HOST. Six surfaces carried it; four were fixed under
 * AGL-2738 and the last two under AGL-2760, each time by a reader noticing
 * the pattern rather than by a failing test.
 *
 * A behavioral test would have to mount six large drawers and pages to say
 * the same thing once. The import is the thing that has to stay true, and
 * it is checkable in milliseconds.
 *
 * ## What the allowlist means
 *
 * A row is a surface that writes ONLY a site feed and is handed the MOUNTED
 * site — never a record's own. `props.hostId` is null at the org hub, where
 * these surfaces' org-level lines come from `useCrmBulkApply` instead, so
 * the site logger is correctly inert there.
 *
 * Enumerated from `git ls-files` rather than a filesystem walk, so a built
 * `dist/` cannot change the answer (the lesson `selfhost-hardcoded-hosts`
 * records).
 */
const REPO_ROOT = resolve(__dirname, '../../../../../..')
const CRM_LIB = 'libs/plugins/crm/src/lib'

/** The hook that reaches only the site feed. */
const LOW_LEVEL_HOOK = /\buseHostActivityLogger\b/

const SOURCE = /\.(ts|tsx)$/
const NOT_A_TEST = /\.spec\.|\.e2e\.|\.test\./

/**
 * Comments removed, so the prose explaining this decision cannot pass for
 * the decision — the trap `selfhost-hardcoded-hosts.spec.ts` records. Two
 * files named the hook only to say why they exist beside it
 * (`crm-activity-report.ts`, `server/org-activity.ts`) and both read as
 * violations until this ran.
 *
 * The line-comment pass refuses to fire on `://` so a URL literal keeps its
 * scheme. Erring that way is safe here: a `//` inside a non-URL string can
 * only HIDE a match, and a hidden match is a call this guard would have to
 * see spelled normally somewhere else to matter.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Surfaces permitted to call the site logger directly, and WHY each is not
 * the bug. Every other CRM surface goes through `useCrmActivityLogger`.
 */
const ALLOWED: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: `${CRM_LIB}/hooks/use-crm-activity-logger.ts`,
    reason:
      'The door itself. It wraps the site logger and picks between that and ' +
      'the org route.',
  },
  {
    file: `${CRM_LIB}/components/companies-bulk-bar.tsx`,
    reason:
      'AGL-2738. Site-only logger handed `props.hostId` — the MOUNTED site, ' +
      'never a row\'s own. At the org hub that is null and this is inert; the ' +
      'org-level lines come from `useCrmBulkApply` through `crm/org-activity`.',
  },
  {
    file: `${CRM_LIB}/components/deals-bulk-bar.tsx`,
    reason:
      'AGL-2738. Same shape as the companies bulk bar: `props.hostId` only, ' +
      'with the org-level lines written by `useCrmBulkApply`.',
  },
]

function trackedCrmSources(): string[] {
  const out = execFileSync('git', ['ls-files', CRM_LIB], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return out
    .split('\n')
    .filter((file) => file && SOURCE.test(file) && !NOT_A_TEST.test(file))
}

describe('CRM activity is written through one door', () => {
  const allowed = new Set(ALLOWED.map((entry) => entry.file))

  it('no CRM surface reaches past `useCrmActivityLogger` for the site logger', () => {
    const offenders = trackedCrmSources().filter((file) => {
      if (allowed.has(file)) return false
      const source = withoutComments(
        readFileSync(resolve(REPO_ROOT, file), 'utf8'),
      )
      return LOW_LEVEL_HOOK.test(source)
    })

    expect(offenders).toEqual([])
  })

  it('every allowlisted file still exists and still calls the site logger', () => {
    const tracked = new Set(trackedCrmSources())
    const stale = ALLOWED.filter((entry) => {
      if (!tracked.has(entry.file)) return true
      return !LOW_LEVEL_HOOK.test(
        withoutComments(readFileSync(resolve(REPO_ROOT, entry.file), 'utf8')),
      )
    })

    // A row that no longer describes anything is a row that would forgive a
    // future re-introduction silently.
    expect(stale.map((entry) => entry.file)).toEqual([])
  })

  it('every allowlisted file records WHY it is not the bug', () => {
    const unreasoned = ALLOWED.filter((entry) => entry.reason.trim().length <= 20)
    expect(unreasoned.map((entry) => entry.file)).toEqual([])
  })

  it('the two create drawers go through the CRM door', () => {
    // The AGL-2760 surfaces specifically: they were the last two carrying
    // `hostId ?? record.hostId`, and their create path picks a site that is
    // where the record is STAMPED rather than where the act happened.
    for (const file of [
      `${CRM_LIB}/components/company-edit-drawer.tsx`,
      `${CRM_LIB}/components/deal-edit-drawer.tsx`,
    ]) {
      const source = withoutComments(
        readFileSync(resolve(REPO_ROOT, file), 'utf8'),
      )
      expect(source).toMatch(/useCrmActivityLogger\(hostId\)/)
      expect(source).not.toMatch(LOW_LEVEL_HOOK)
    }
  })
})
