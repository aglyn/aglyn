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
 * Every write to `adminAudit` is stamped (AGL-3321), swept across the whole
 * repo.
 *
 * The staff audit page queries its Action group filter and its search by the
 * `actionGroup` and `searchTokens` each row carries (`withAdminAuditIndex`).
 * A writer that skips the stamp leaves a row that still lists and that
 * neither the filter nor the search can ever find: an audit search that
 * quietly misses one entry, which nobody would notice. With a hundred writers
 * across the console, the tenant app, three plugins and the scripts, only a
 * corpus sweep holds that.
 *
 * So a reference to the collection is one of:
 *
 *   - a READ: followed by a query method, or the first argument of the web
 *     SDK's `query(...)` or of `applyListQuery(...)`, which plans a list
 *     query onto it;
 *   - a STAMPED WRITE: its data passed straight through `withAdminAuditIndex`
 *     (the browser's one batch write) or `stampAdminAuditIndex` (the
 *     scripts' restatement);
 *   - inside the door itself: `addAdminAudit` / `setAdminAudit` in
 *     `admin-audit-write.ts`, and `recordAdminAudit` in `admin-audit.ts`.
 *
 * Anything else — an unstamped `add`, a `doc()` handed to a batch, a
 * reference parked in a variable to be written through later — is refused.
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../..')

/** The door: the only files that write the collection without restamping at the call. */
const DOORS = new Set([
  'libs/tenant/data/admin/src/lib/server/admin-audit-write.ts',
  'libs/tenant/data/admin/src/lib/server/admin-audit.ts',
])

/** A reference to the collection, in either SDK's spelling. */
const REFERENCE =
  /collection\(\s*(?:[\w$.()]+\s*,\s*)?(?:'adminAudit'|"adminAudit"|ADMIN_AUDIT_COLLECTION)\s*\)/g

const READ_AFTER =
  /^\s*\.\s*(?:where|orderBy|limit|limitToLast|get|select|count|startAfter|startAt|onSnapshot|withConverter)\(/
// `query(collection(…` in the web SDK; `applyListQuery(db.collection(…` on
// the server, where the handle's own chain (`firebaseAdmin.app().firestore().`)
// may sit between the call and the collection.
const READ_BEFORE = /(?:\bquery|\bapplyListQuery)\(\s*(?:[\w$]+(?:\(\))?\.)*$/
const STAMPED_ADD = /^\s*\.\s*add\(\s*(?:withAdminAuditIndex|stampAdminAuditIndex)\(/
const STAMPED_DOC = /^\s*\)\s*,\s*withAdminAuditIndex\(/
const DOC_BEFORE = /doc\(\s*$/

/**
 * The source without its comments, which name the shapes this refuses.
 *
 * A scanner rather than the shared `code()` stripper: that one bounds the
 * span a comment may claim, and a module header on a route this sweep
 * reaches (org override) is longer than its bound. Strings and template
 * literals are stepped over whole, so a `//` or `/*` inside one is kept.
 */
function withoutComments(source: string): string {
  let out = ''
  let at = 0
  while (at < source.length) {
    const char = source[at]
    const next = source[at + 1]
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', at)
      at = end === -1 ? source.length : end
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2)
      at = end === -1 ? source.length : end + 2
    } else if (char === "'" || char === '"' || char === '`') {
      let end = at + 1
      while (end < source.length && source[end] !== char) end += source[end] === '\\' ? 2 : 1
      out += source.slice(at, end + 1)
      at = end + 1
    } else {
      out += char
      at += 1
    }
  }
  return out
}

/** Each reference in one source that is neither a read nor a stamped write. */
function unstampedAuditWrites(source: string): string[] {
  const offenders: string[] = []
  for (const match of source.matchAll(REFERENCE)) {
    const at = match.index ?? 0
    const before = source.slice(Math.max(0, at - 40), at)
    const after = source.slice(at + match[0].length, at + match[0].length + 80)
    if (READ_AFTER.test(after) || READ_BEFORE.test(before)) continue
    if (STAMPED_ADD.test(after)) continue
    if (DOC_BEFORE.test(before) && STAMPED_DOC.test(after)) continue
    offenders.push(source.slice(Math.max(0, at - 30), at + match[0].length + 30).replace(/\s+/g, ' '))
  }
  return offenders
}

describe('AGL-3321 · every adminAudit write carries the fields its list queries', () => {
  const candidates = (): string[] =>
    execSync('git ls-files "*.ts" "*.tsx" "*.mjs" "*.js" "*.cjs"', {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
      .toString()
      .split('\n')
      .filter(Boolean)
      .filter((file) => !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file))
      .filter((file) => !DOORS.has(file))
      .filter((file) => {
        const text = readFileSync(join(REPO_ROOT, file), 'utf8')
        return text.includes('adminAudit') || text.includes('ADMIN_AUDIT_COLLECTION')
      })

  it('finds no unstamped write anywhere in tracked source', () => {
    const offenders: string[] = []
    for (const file of candidates()) {
      const source = withoutComments(readFileSync(join(REPO_ROOT, file), 'utf8'))
      for (const found of unstampedAuditWrites(source)) offenders.push(`${file}: ${found}`)
    }
    expect(offenders.sort()).toEqual([])
  })

  it('the door stamps what it writes', () => {
    const door = readFileSync(
      join(REPO_ROOT, 'libs/tenant/data/admin/src/lib/server/admin-audit-write.ts'),
      'utf8',
    )
    expect(door).toMatch(/\.add\(withAdminAuditIndex\(entry\)\)/)
    expect(door).toMatch(/\.set\(ref, withAdminAuditIndex\(entry\)\)/)
    const record = readFileSync(
      join(REPO_ROOT, 'libs/tenant/data/admin/src/lib/server/admin-audit.ts'),
      'utf8',
    )
    expect(record).toMatch(/transaction\.create\(collection\.doc\(\), withAdminAuditIndex\(\{/)
  })

  /**
   * The shapes the writers had before (AGL-3321), and the ones that stay
   * legal. A detector that has never gone red is not yet a detector.
   */
  it('refuses the shapes the writers used, and passes reads and stamped writes', () => {
    const refused = [
      "await firestore.collection('adminAudit').add({ action: 'org.override' })",
      "batch.set(firestore.collection('adminAudit').doc(), { action: 'org.override' })",
      "tx.set(db.collection(ADMIN_AUDIT_COLLECTION).doc(), entry)",
      "const audit = db.collection('adminAudit'); await audit.add(entry)",
      "batch.set(doc(collection(firestore, 'adminAudit')), { action: 'org.erasureRequested' })",
      "await addDoc(collection(firestore, 'adminAudit'), { action: 'x' })",
    ]
    for (const shape of refused) expect(unstampedAuditWrites(shape)).toHaveLength(1)

    const allowed = [
      "firestore.collection('adminAudit').where('target', '==', t).orderBy('at', 'desc')",
      "db .collection('adminAudit') .orderBy('at', 'desc') .limit(200) .get()",
      "getDocs(query(collection(firestore, 'adminAudit'), where('action', '==', a)))",
      'applyListQuery(firestore.collection(ADMIN_AUDIT_COLLECTION), plan).limit(26).get()',
      "await firestore.collection('adminAudit').add(stampAdminAuditIndex({ action: 'x' }))",
      "batch.set(doc(collection(firestore, 'adminAudit')), withAdminAuditIndex({ action: 'x' }))",
      "await addAdminAudit(firestore, { action: 'org.override' })",
      "setAdminAudit(batch, firestore, { action: 'org.override' })",
    ]
    for (const shape of allowed) expect(unstampedAuditWrites(shape)).toEqual([])
  })

  it('reads code, not the comments that name the refused shapes', () => {
    const source = [
      "// was: firestore.collection('adminAudit').add({ action })",
      "/* batch.set(db.collection('adminAudit').doc(), entry) */",
      "const url = 'https://example.com/a//b'",
      "await addAdminAudit(firestore, { note: 'a // b /* c' })",
    ].join('\n')
    expect(unstampedAuditWrites(withoutComments(source))).toEqual([])
    expect(withoutComments(source)).toContain("'https://example.com/a//b'")
    expect(withoutComments(source)).toContain("'a // b /* c'")
  })
})
