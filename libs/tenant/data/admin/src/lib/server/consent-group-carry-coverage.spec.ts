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
 * WHAT A CONSENT GROUP CHANGE CARRIES IS WHAT THE SEND PATHS READ (AGL-3320, I8).
 *
 * A refusal stored on one site and read across the CURRENT group is lost the
 * moment two sites stop being one sender — unless the change carries it.
 * `consent-group-carry.ts` carries exactly three stores. The day a send path
 * starts reading a FOURTH per-site store across the group, every change that
 * separates two sites silently drops that store's refusals, and nothing about
 * the new reader would say so.
 *
 * So this is a source sweep of every file that resolves the sites a refusal
 * is read across — `consentGroupOptOutHosts`, `optOutHostIds`, the outreach
 * gate's `keyedGroupLookup` — and every collection those files read must be
 * one the change carries, or be named below with the reason it is not a
 * per-site store read across a group. A new store fails here until it is
 * carried or argued.
 *
 * Two more halves of the same promise are pinned beside it: the declaration
 * is written by the executor's declare step and nowhere else, because a write
 * anywhere else would flip a group without a carry; and a per-site REFUSAL is
 * a contact's alone, because that is the only record the CRM's participant
 * carries one on.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONSENT_GROUP_CARRY_SUBCOLLECTIONS } from './consent-group-carry'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..', '..')
const EXECUTOR = 'libs/tenant/data/admin/src/lib/server/consent-group-change.ts'

const NOT_SOURCE = /\.(?:spec|test)\.[cm]?[jt]sx?$|\/(?:fixtures|rules-tests|__mocks__)\/|\.d\.ts$/

function trackedSource(pattern?: string): string[] {
  const args = pattern
    ? ['grep', '-l', '-E', pattern, '--', 'libs', 'apps', 'tools', 'cloud/functions/src']
    : ['ls-files', '--', 'libs', 'apps', 'tools', 'cloud/functions/src']
  let out = ''
  try {
    out = execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    // `git grep` exits 1 when nothing matches, which is an answer, not a fault.
    if ((error as { status?: number }).status !== 1) throw error
  }
  return out
    .split('\n')
    .filter((path) => /\.(?:[cm]?[jt]sx?)$/.test(path) && !NOT_SOURCE.test(path))
}

const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

/** The file's code, without its comments: a sentence naming a store reads nothing. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n')
}

/** Every `export const NAME = 'value'` in the tracked source: how a constant is resolved. */
const CONSTANTS = (() => {
  const map = new Map<string, string>()
  for (const path of trackedSource('export const [A-Z0-9_]+ =')) {
    for (const match of read(path).matchAll(/export const ([A-Z0-9_]+)\s*=\s*'([^']+)'/g)) {
      map.set(match[1], match[2])
    }
  }
  return map
})()

/*==========================================
 * I8 — every collection a group-wide opt-out reader touches
 *=========================================*/

/**
 * Collections read beside the group-wide opt-outs that are NOT per-site
 * stores read across the group, each with why.
 */
const NOT_CARRIED: Readonly<Record<string, string>> = {
  hosts: 'The parent path every per-site store hangs off, not a store.',
  orgs: 'The organization document and its org-wide collections, which one group or another shares already.',
  emailSuppressions:
    'The platform list: a bounce or complaint on it holds every site of every workspace, grouped or not.',
  emailTopics: 'The org’s topic catalog, which every site reads whole.',
  lists: 'Org-wide lists, which every site of the org shares whatever the declaration.',
  listAssignments: 'The inbox’s assignment of a list, read for the one site whose inbox asked.',
  formSubmissions: 'A site’s own submissions, read for that site alone.',
  replies: 'A submission’s replies, read for that submission’s site alone.',
  subcollection: 'The parameter of `getAllAcrossSites`, whose callers are checked by name.',
}

describe('a consent group change carries every store a send path reads across a group (I8)', () => {
  const carried = new Set(Object.values(CONSENT_GROUP_CARRY_SUBCOLLECTIONS))
  const readers = trackedSource('consentGroupOptOutHosts\\(|optOutHostIds\\(|keyedGroupLookup\\(')

  it('finds the readers it is about', () => {
    // A sweep that found nothing would pass everything below.
    expect(readers).toEqual(
      expect.arrayContaining([
        'libs/tenant/data/admin/src/lib/server/email-suppression.ts',
        'libs/tenant/data/admin/src/lib/server/email-marketing-gate.ts',
        'libs/plugins/outreach/src/lib/enrollment/gate-lookups.ts',
      ]),
    )
    expect([...carried].sort()).toEqual(['emailFrequency', 'suppressions', 'topicOptOuts'])
  })

  it('reads nothing but a carried store or a collection argued not to be one', () => {
    const unclassified: string[] = []
    const seen = new Set<string>()
    for (const path of readers) {
      const code = codeOf(read(path))
      const args = [
        ...[...code.matchAll(/\.collection\(\s*([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*\)/g)].map((m) => m[1]),
        ...[...code.matchAll(/getAllAcrossSites\(\s*[^,()]+,\s*[^,()]+,\s*([A-Za-z_$][\w$]*|'[^']*')/g)].map(
          (m) => m[1],
        ),
      ]
      for (const arg of args) {
        const name = /^['"]/.test(arg) ? arg.slice(1, -1) : (CONSTANTS.get(arg) ?? arg)
        seen.add(name)
        if (!carried.has(name) && !(name in NOT_CARRIED)) unclassified.push(`${path}: ${arg} → ${name}`)
      }
    }
    expect(unclassified).toEqual([])
    // Every carried store is really read by one of them — a carry for a
    // store nothing reads would be a sign this sweep has lost its way.
    for (const name of carried) expect(seen.has(name) ? name : `${name} (never read)`).toBe(name)
  })

  it('argues only for collections one of the readers really reads', () => {
    const touched = new Set<string>()
    for (const path of readers) {
      const code = codeOf(read(path))
      for (const match of code.matchAll(/\.collection\(\s*([A-Za-z_$][\w$]*|'[^']*')\s*\)/g)) {
        const arg = match[1]
        touched.add(/^'/.test(arg) ? arg.slice(1, -1) : (CONSTANTS.get(arg) ?? arg))
      }
      if (/getAllAcrossSites\(/.test(code)) touched.add('subcollection')
    }
    const stale = Object.keys(NOT_CARRIED).filter((name) => !touched.has(name))
    expect(stale).toEqual([])
  })
})

/*==========================================
 * The declaration has one writer
 *=========================================*/

describe('`consentGroups` is written by the executor’s declare step alone', () => {
  const WRITE =
    /\[CONSENT_GROUPS_FIELD\]\s*:|(?:^|[\s{,(])['"]?consentGroups['"]?\s*:(?!:)|['"`]consentGroups\./

  /**
   * Files that spell the field as an object key without writing it, each
   * with the reason. Kept honest below: an entry whose file no longer spells
   * it fails, so the list only ever names a real exception.
   */
  const NOT_WRITERS: Record<string, string> = {
    'libs/plugins/email/src/lib/components/consent-group-dialog.tsx':
      'Lists the groups of the declaration a 409 answered with by handing `listConsentGroups` the org with that declaration in place. A browser cannot write the field: the rules deny it.',
  }
  const spells = (path: string) => codeOf(read(path)).split('\n').some((line) => WRITE.test(line))

  it('has no other writer anywhere in the tracked source', () => {
    const writers = trackedSource('CONSENT_GROUPS_FIELD|consentGroups')
      .filter((path) => !path.endsWith('.types.ts'))
      .filter((path) => !(path in NOT_WRITERS))
      .filter(spells)
    expect(writers).toEqual([EXECUTOR])
  })

  it('exempts only files that still spell the field', () => {
    expect(Object.keys(NOT_WRITERS).filter((path) => !spells(path))).toEqual([])
  })

  it('writes it inside the declare step, once', () => {
    const code = codeOf(read(EXECUTOR))
    const lines = code.split('\n')
    const writes = lines.map((line, index) => (WRITE.test(line) ? index : -1)).filter((index) => index >= 0)
    expect(writes).toHaveLength(1)
    const declareAt = lines.findIndex((line) => /^async function declare\(/.test(line))
    const nextFunction = lines.findIndex(
      (line, index) => index > declareAt && /^(?:export )?(?:async )?function /.test(line),
    )
    expect(declareAt).toBeGreaterThan(-1)
    expect(writes[0]).toBeGreaterThan(declareAt)
    expect(writes[0]).toBeLessThan(nextFunction)
  })
})

/*==========================================
 * A per-site refusal is a contact's alone
 *=========================================*/

describe('a per-site refusal is recorded on a contact and nowhere else', () => {
  /** The writers of the records that carry grants alone. */
  const GRANT_ONLY_WRITERS = [
    'libs/tenant/data/admin/src/lib/server/host-visitor-records.ts',
    'libs/tenant/data/admin/src/lib/server/list-members.ts',
    'libs/plugins/commerce/src/lib/server/membership-register.ts',
    'libs/tenant/runtime/src/lib/convert-host-lead.ts',
  ]

  it('only a contact writer records one', () => {
    const callers = trackedSource('declineMarketingConsentFields\\(')
      .filter((path) => !path.endsWith('app-utils/marketing-consent.ts'))
      .filter((path) => /declineMarketingConsentFields\(/.test(codeOf(read(path))))
    expect(callers.length).toBeGreaterThan(0)
    expect(callers.filter((path) => GRANT_ONLY_WRITERS.includes(path))).toEqual([])
  })

  it('no lead, list-member or site-member writer spells one out', () => {
    const refusal = /\[MARKETING_CONSENT_FIELD\]\s*:\s*false|\bmarketingConsent\s*:\s*false/
    for (const path of GRANT_ONLY_WRITERS) {
      const code = codeOf(read(path))
      expect(code.length).toBeGreaterThan(200)
      expect(refusal.test(code) ? path : null).toBeNull()
    }
  })
})
