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

import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Retention on the media bucket, checked against the code that writes to it
 * (AGL-1443).
 *
 * The media bucket had **no lifecycle configuration at all**, which is how an
 * erasure could leave a complete copy of an erased workspace in it forever.
 * That object is gone — `eraseOrg` no longer writes one — and what remains has
 * to be bounded rather than merely smaller, because the failure mode here is
 * not size. It is that a prefix nobody reaps outlives the promise made about
 * the data in it (DPA §11: "a limited period, after which it will be deleted
 * or de-identified").
 *
 * Two things are asserted, and they are different in kind:
 *
 *  1. **Every rule is bounded and scoped.** A lifecycle rule has no view of
 *     Firestore — it matches on age. An unprefixed rule, or one naming
 *     `orgs/`/`hosts/`/`users/`, would delete the bytes behind media
 *     documents that still exist, across live workspaces, with nothing to say
 *     which. That is a worse outcome than the retention problem being fixed,
 *     so it is asserted as an invariant rather than trusted to review.
 *  2. **The prefixes are read out of the writers, not restated here.** The
 *     archive path comes from the archiver's own source. Asserting a
 *     plausible-looking policy in isolation is exactly what let the bucket's
 *     CORS config and its uploader drift apart (AGL-1408), and this file
 *     exists in the same blind spot: nothing in a repo can prove what is
 *     actually on the bucket, so the least it can do is prove the committed
 *     document matches the code.
 *
 * What this does NOT prove: that the committed document is what is live on
 * the bucket. See `docs/STORAGE_MANUAL_CONFIG.md` for the read-back command.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..')

/** Prefixes holding live customer media. Deleted by code, never by age. */
const CUSTOMER_MEDIA_PREFIXES = ['orgs/', 'hosts/', 'users/']

interface LifecycleRule {
  action?: { type?: string }
  condition?: { age?: number; matchesPrefix?: string[] }
}

function lifecycleRules(): LifecycleRule[] {
  const raw = readFileSync(
    join(REPO_ROOT, 'cloud', 'media-bucket-lifecycle.json'),
    'utf8',
  )
  return (JSON.parse(raw) as { lifecycle?: { rule?: LifecycleRule[] } })
    .lifecycle?.rule ?? []
}

function source(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

/**
 * The archive prefix as the archiver writes it, read out of the route rather
 * than restated. A rename there without a matching rule here silently
 * un-bounds the archive again.
 */
function auditArchivePrefix(): string {
  const route = source('apps/console/app/api/admin/audit-archive/route.ts')
  const match = /\.file\(\s*`([\w-]+)\//.exec(route)
  if (!match) {
    throw new Error(
      'The audit archiver no longer writes to a literal Storage prefix — ' +
        're-derive this spec against whatever replaced it before deleting it.',
    )
  }
  return `${match[1]}/`
}

describe('media bucket retention (AGL-1443)', () => {
  it('bounds the audit archive the code moves entries into', () => {
    // `/api/admin/audit-archive` advertises RETENTION_DAYS = 90, but it only
    // ever MOVED entries: out of Firestore and into a bucket prefix with no
    // reaper. Rows name the org and some carry `email`.
    const prefix = auditArchivePrefix()
    const rule = lifecycleRules().find((entry) =>
      (entry.condition?.matchesPrefix ?? []).includes(prefix),
    )
    expect(rule).toBeDefined()
    expect(rule?.action?.type).toBe('Delete')
    expect(rule?.condition?.age).toBeGreaterThan(0)
  })

  it('keeps a backstop over the erasure prefix nothing writes any more', () => {
    // The rule is not what bounds the erasure record — the `adminAudit` row
    // is. It is here so that a revert, a rollback or a future writer cannot
    // quietly recreate an unbounded prefix.
    const rule = lifecycleRules().find((entry) =>
      (entry.condition?.matchesPrefix ?? []).includes('erasures/'),
    )
    expect(rule).toBeDefined()
    expect(rule?.action?.type).toBe('Delete')
    expect(rule?.condition?.age).toBeGreaterThan(0)
  })

  it('and the erase path writes no object for it to expire', () => {
    // The behavioural proof lives in `erase-org-export.emulator.spec.ts`,
    // which only runs with an emulator. This is the guard that runs
    // everywhere: `eraseOrg` performs Storage DELETES and nothing else, so a
    // reintroduced `.save(` fails here rather than in production.
    const erase = source('libs/tenant/data/admin/src/lib/server/erase.ts')
    expect(erase).not.toContain('.save(')
  })

  it('never lets a rule match the whole bucket', () => {
    for (const rule of lifecycleRules()) {
      // An unprefixed Delete rule ages out every customer's media.
      expect(rule.condition?.matchesPrefix ?? []).not.toHaveLength(0)
    }
  })

  it('never ages out live customer media', () => {
    for (const rule of lifecycleRules()) {
      for (const prefix of rule.condition?.matchesPrefix ?? []) {
        for (const owned of CUSTOMER_MEDIA_PREFIXES) {
          // Either direction is fatal: a rule ON `orgs/`, or a rule on a
          // prefix that `orgs/` sits inside.
          expect(prefix.startsWith(owned)).toBe(false)
          expect(owned.startsWith(prefix)).toBe(false)
        }
      }
    }
  })

  it('bounds every rule it carries, with no open-ended action', () => {
    const rules = lifecycleRules()
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      expect(rule.action?.type).toBe('Delete')
      expect(rule.condition?.age).toBeGreaterThan(0)
      expect(Number.isFinite(rule.condition?.age)).toBe(true)
    }
  })
})
