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

// Self-test for the Linear citation comparator (AGL-2306).
//
// The suite it needs most is the DISCRIMINATION one: a validator that matches
// nothing calls every corpus clean, and is indistinguishable from a working
// one unless something asserts that it separates a real id from a fabricated
// one. That is the first block below, pinned to the real fourteen.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  FABRICATED,
  OK,
  STALE_AFTER_DAYS,
  UNKNOWN,
  ceilingAgeDays,
  classifyCitation,
  raiseCeiling,
  issueFromSubject,
  overallExitCode,
  parseCitations,
  readCeiling,
  remedy,
  sweepVerdict,
  NOT_A_CITATION,
  isExemptPath,
  isForgivenCommit,
} from './linear-ids.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CEILING_PATH = join(HERE, '..', 'linear-issue-ceiling.json')

/** The ceiling as it stood when the fourteen landed. */
const CEILING = 2499

const one = (id) => parseCitations(id)[0]
const verdict = (id, ceiling = CEILING) => classifyCitation(one(id), ceiling)

/** The fourteen commits of 2026-08-28 and the ids they invented. */
const FABRICATED_IDS = [
  'AGL-2508', 'AGL-2509', 'AGL-2510', 'AGL-2511', 'AGL-2512', 'AGL-2513',
  'AGL-2514', 'AGL-2515', 'AGL-2516', 'AGL-2517', 'AGL-2518', 'AGL-2519',
  'AGL-2520', 'AGL-2521',
]

/** Ids confirmed to exist in the workspace. */
const REAL_IDS = ['AGL-96', 'AGL-305', 'AGL-1009', 'AGL-2036', 'AGL-2306', 'AGL-2486', 'AGL-2499']

describe('it discriminates', () => {
  it('refuses every one of the fourteen fabricated ids', () => {
    for (const id of FABRICATED_IDS)
      assert.equal(verdict(id), FABRICATED, `${id} was never assigned and must be refused`)
  })

  it('accepts every id confirmed to exist', () => {
    for (const id of REAL_IDS)
      assert.equal(verdict(id), OK, `${id} exists and must not be refused`)
  })

  // ⚠️ The assertion that makes the two above mean anything. A classifier
  // stuck on one answer satisfies exactly one of them, and a broken parser
  // returning UNKNOWN for everything satisfies neither while still producing
  // "no fabrications found" in the guard. Both verdicts must OCCUR.
  it('produces BOTH verdicts, so it is not matching everything or nothing', () => {
    const seen = new Set([...FABRICATED_IDS, ...REAL_IDS].map((id) => verdict(id)))
    assert.ok(seen.has(OK), 'no citation was ever accepted — the guard refuses everything')
    assert.ok(seen.has(FABRICATED), 'no citation was ever refused — the guard is inert')
    assert.equal(seen.size, 2, `expected exactly OK and FABRICATED, got ${[...seen].join(', ')}`)
  })

  it('splits exactly at the ceiling', () => {
    assert.equal(verdict(`AGL-${CEILING}`), OK, 'the ceiling itself exists')
    assert.equal(verdict(`AGL-${CEILING + 1}`), FABRICATED, 'one past the ceiling cannot exist')
  })
})

describe('parsing a citation', () => {
  it('finds every id in a commit message, deduped, in order', () => {
    const found = parseCitations('fix(x): a thing (AGL-2521)\n\nfollows AGL-305 and AGL-2521 again')
    assert.deepEqual(found.map((c) => c.id), ['AGL-2521', 'AGL-305'])
  })

  it('is anchored on a word boundary, so a longer token is not a citation', () => {
    // `AGL-25211` is its own id, not AGL-2521 with a stray digit. Matching a
    // PREFIX would report a real id as the fabricated one it starts with.
    const found = parseCitations('see AGL-25211')
    assert.deepEqual(found.map((c) => c.id), ['AGL-25211'])
  })

  it('reads a number out of the id rather than comparing strings', () => {
    // String comparison puts "AGL-300" above "AGL-2499". The whole ceiling
    // idea collapses if the ordering is lexical.
    assert.equal(verdict('AGL-300'), OK)
    assert.equal(one('AGL-300').number, 300)
  })

  it('refuses AGL-0 and a zero id outright', () => {
    assert.equal(verdict('AGL-0'), FABRICATED)
  })

  it('finds nothing in text that cites nothing', () => {
    assert.deepEqual(parseCitations('chore: tidy up'), [])
    assert.deepEqual(parseCitations(''), [])
    assert.deepEqual(parseCitations(null), [])
  })
})

describe('the subject tag', () => {
  it('reads only the anchored tag as the commit’s own claim', () => {
    assert.equal(issueFromSubject('fix(x): follow-up to AGL-1000 (AGL-2000)'), 'AGL-2000')
  })

  it('is null when the subject carries no tag', () => {
    assert.equal(issueFromSubject('chore: tidy up'), null)
    assert.equal(issueFromSubject('fix: mentions AGL-305 in passing'), null)
  })
})

describe('an unusable ceiling is UNKNOWN, never a pass', () => {
  it('accepts the real ceiling file', () => {
    const result = readCeiling(JSON.parse(readFileSync(CEILING_PATH, 'utf8')))
    assert.ok(result.ok, result.reason)
    assert.equal(result.ceiling.team, 'AGL')
    assert.ok(result.ceiling.highest >= CEILING, 'the ceiling must never be lowered below AGL-2499')
  })

  it('rejects a missing, zero or non-integer highest', () => {
    const base = { team: 'AGL', verifiedAt: '2026-08-28' }
    for (const highest of [undefined, 0, -1, '2499', 2499.5, null])
      assert.equal(readCeiling({ ...base, highest }).ok, false, `highest=${highest} must be rejected`)
  })

  it('rejects a wrong team, so an unscoped refresh cannot disarm it', () => {
    assert.equal(readCeiling({ team: 'ZZZ', highest: 2499, verifiedAt: '2026-08-28' }).ok, false)
  })

  it('rejects a missing or malformed verifiedAt', () => {
    for (const verifiedAt of [undefined, '', 'yesterday', '28-08-2026', '2026-13-45'])
      assert.equal(
        readCeiling({ team: 'AGL', highest: 2499, verifiedAt }).ok,
        false,
        `verifiedAt=${verifiedAt} must be rejected`,
      )
  })

  it('rejects a non-object', () => {
    for (const raw of [null, 'AGL-2499', 42, []])
      assert.equal(readCeiling(raw).ok, false)
  })

  it('classifies as UNKNOWN when the ceiling is not usable', () => {
    assert.equal(classifyCitation(one('AGL-305'), 0), UNKNOWN)
    assert.equal(classifyCitation(one('AGL-305'), undefined), UNKNOWN)
    assert.equal(classifyCitation(undefined, CEILING), UNKNOWN)
  })
})

describe('the positive control', () => {
  // ⚠️ The single most important behaviour here. A sweep that examined NOTHING
  // has not proved a corpus clean, and this repo has repeatedly shipped the
  // shape where it printed the same green as one that had.
  it('a sweep over a non-empty corpus that examined nothing is UNKNOWN', () => {
    const result = sweepVerdict({
      fabricated: [], scanned: 0, corpusSize: 4321, ceiling: CEILING, name: 'source',
    })
    assert.equal(result.state, UNKNOWN)
    assert.match(result.detail, /4321/)
  })

  it('a sweep over an EMPTY corpus is OK — nothing to look at is not a failure', () => {
    const result = sweepVerdict({
      fabricated: [], scanned: 0, corpusSize: 0, ceiling: CEILING, name: 'commits',
    })
    assert.equal(result.state, OK)
  })

  it('a sweep that examined citations and found none fabricated is OK', () => {
    const result = sweepVerdict({
      fabricated: [], scanned: 812, corpusSize: 4321, ceiling: CEILING, name: 'source',
    })
    assert.equal(result.state, OK)
    assert.equal(result.scanned, 812)
  })

  it('a sweep with a fabricated citation is FABRICATED', () => {
    const result = sweepVerdict({
      fabricated: [{ id: 'AGL-2517', number: 2517, where: 'a.ts:1' }],
      scanned: 812, corpusSize: 4321, ceiling: CEILING, name: 'source',
    })
    assert.equal(result.state, FABRICATED)
    assert.equal(result.fabricated[0].id, 'AGL-2517')
  })
})

describe('exit codes', () => {
  const sweep = (state) => ({ state, name: 'x', scanned: 1, corpusSize: 1, fabricated: [], detail: '' })

  it('is 0 when every sweep is OK', () => {
    assert.equal(overallExitCode([sweep(OK), sweep(OK)]), 0)
  })

  it('is 1 when any sweep found a fabrication', () => {
    assert.equal(overallExitCode([sweep(OK), sweep(FABRICATED)]), 1)
  })

  // Cannot-check must never be averaged away by a sweep that could run.
  it('is 2 when any sweep could not run, even beside a fabrication', () => {
    assert.equal(overallExitCode([sweep(OK), sweep(UNKNOWN)]), 2)
    assert.equal(overallExitCode([sweep(FABRICATED), sweep(UNKNOWN)]), 2)
  })
})

describe('staleness', () => {
  const ceiling = { team: 'AGL', highest: CEILING, verifiedAt: '2026-08-28', verifiedMs: Date.parse('2026-08-28T00:00:00Z') }

  it('reports the ceiling’s age in whole days', () => {
    assert.equal(ceilingAgeDays(ceiling, Date.parse('2026-08-28T12:00:00Z')), 0)
    assert.equal(ceilingAgeDays(ceiling, Date.parse('2026-09-12T00:00:00Z')), 15)
  })

  it('has a stale threshold that is actually reachable', () => {
    assert.ok(STALE_AFTER_DAYS > 0 && STALE_AFTER_DAYS < 365)
  })
})

describe('the remedy text', () => {
  const ceiling = { team: 'AGL', highest: CEILING, verifiedAt: '2026-08-28' }

  // The laundering path: raise the ceiling to whatever number just failed and
  // every fabrication approves itself. The output has to say so, because the
  // whole baseline is ONE number and one careless edit disarms it completely.
  it('steers away from raising the ceiling to the id that just failed', () => {
    const text = remedy('/x/ceiling.json', ceiling)
    assert.match(text, /do NOT simply raise it to whatever number failed/)
    assert.match(text, /ACTUALLY exists/)
  })

  it('names the issue-creation freeze, so the id is not made real instead', () => {
    assert.match(remedy('/x/ceiling.json', ceiling), /freeze/)
  })

  it('points at a correction note that EXISTS', () => {
    /*
     * ⚠️ The file and the heading are both read off disk. Asserting only that
     * the text mentions a filename is satisfied by any filename — this
     * assertion passed for a day against `docs/DECISIONS.md`, which is not a
     * file in this repo, so the remedy sent a reader looking for the
     * explanation to a path that does not exist. A pointer is only worth
     * anything if something is at the end of it.
     */
    const text = remedy('/x/ceiling.json', ceiling)
    const named = text.match(/docs\/[A-Z_]+\.md/)
    assert.ok(named, 'the remedy names no document at all')
    const path = fileURLToPath(new URL(`../../../${named[0]}`, import.meta.url))
    assert.ok(existsSync(path), `${named[0]} does not exist`)
    // And the section, not just the file: a correct filename with an invented
    // heading is the same dead end one directory further in.
    //
    // ⚠️ Anchored AFTER the document name. A bare `/"([^"]+)"/` finds the
    // FIRST quoted string in the remedy, which is `"highest"` from the JSON
    // snippet above it — and the decision log contains that word, so the
    // assertion passed against an invented heading.
    const heading = text
      .slice(text.indexOf(named[0]) + named[0].length)
      .match(/"([^"]+)"/)
    assert.ok(heading, 'the remedy names no section')
    const wanted = heading[1].replace(/\s+/g, ' ').trim()
    assert.ok(
      readFileSync(path, 'utf8').replace(/\s+/g, ' ').includes(wanted),
      `${named[0]} has no section "${wanted}"`,
    )
  })
})

describe('the two exemptions, which are the only holes in this guard', () => {
  it('exempts the files whose ids are DATA, and nothing else', () => {
    for (const path of NOT_A_CITATION) assert.equal(isExemptPath(path), true, path)
    // The files a careless pattern would have swept in with them.
    for (const path of [
      'tools/scripts/lib/release-version.test.mjs',
      'apps/console/specs/billing-webhook-inert.spec.ts',
      'libs/plugins/commerce/src/lib/components/cart.tsx',
      'docs/SELF_HOSTING.md',
    ]) {
      assert.equal(isExemptPath(path), false, path)
    }
  })

  it('every exempt path still EXISTS — a stale entry is a silent hole', () => {
    // An allowlist entry for a deleted or renamed file exempts nothing and
    // reads as though it does, which is worse than no entry at all.
    for (const path of NOT_A_CITATION) {
      const full = fileURLToPath(new URL(`../../../${path}`, import.meta.url))
      assert.ok(existsSync(full), `${path} is allowlisted but does not exist`)
    }
  })

  it('normalises a leading ./ but does not match on a suffix', () => {
    assert.equal(isExemptPath('./docs/DECISION_LOG.md'), true)
    // The hazard: a suffix match would exempt any path ENDING in an entry.
    assert.equal(isExemptPath('vendor/docs/DECISION_LOG.md'), false)
  })

  it('forgives a listed historical commit, by full sha or an abbreviation', () => {
    const known = ['363d031560000000000000000000000000000000']
    assert.equal(isForgivenCommit('363d031560000000000000000000000000000000', known), true)
    assert.equal(isForgivenCommit('363d03156', ['363d03156']), true)
  })

  it('THE POINT: a FIFTEENTH commit is not forgiven', () => {
    // A date cut-off would forgive every future commit that predated a moving
    // line. A sha list forgives exactly what it names.
    const known = ['363d031560000000000000000000000000000000']
    assert.equal(isForgivenCommit('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', known), false)
    assert.equal(isForgivenCommit('anything', []), false)
    assert.equal(isForgivenCommit('anything', undefined), false)
  })

  it('the ceiling file carries the forgiven list, and it has not grown', () => {
    const raw = JSON.parse(readFileSync(CEILING_PATH, 'utf8'))
    const commits = raw.historicalCitations?.commits ?? []
    // May shrink; must never grow. Fourteen commits carried a fabricated id.
    assert.ok(commits.length <= 14, `forgiven list grew to ${commits.length}`)
    for (const sha of commits) assert.match(sha, /^[0-9a-f]{7,40}$/)
  })
})

// --- the live ceiling (AGL-2563) -------------------------------------------
//
// The red this removes: a session files AGL-2562 and commits citing it before
// anyone hand-bumps the cached file. Three of the last eight Main Gate reds
// were exactly that, and none of them were a defect in the code.

describe('raising the ceiling from Linear', () => {
  const cached = { team: 'AGL', highest: 2559, verifiedAt: '2026-09-03', verifiedMs: 0, raw: {} }

  it('raises when Linear is ahead of the cache — the false-red case', () => {
    const { ceiling, source } = raiseCeiling(cached, 2562)
    assert.equal(ceiling.highest, 2562)
    assert.match(source, /LIVE AGL-2562/)
  })

  it('still refuses a fabricated id against the LIVE ceiling', () => {
    // It must not become a rubber stamp: raising to the true max still rejects
    // everything above it, which is the guard's entire purpose.
    const { ceiling } = raiseCeiling(cached, 2562)
    assert.equal(classifyCitation({ number: 9999 }, ceiling.highest), FABRICATED)
    assert.equal(classifyCitation({ number: 2563 }, ceiling.highest), FABRICATED)
    assert.equal(classifyCitation({ number: 2562 }, ceiling.highest), OK)
  })

  it('never lowers the ceiling, so a deleted issue cannot fail an author', () => {
    const { ceiling, source } = raiseCeiling(cached, 2500)
    assert.equal(ceiling.highest, 2559)
    assert.match(source, /cached AGL-2559/)
  })

  it('falls back to the cache when Linear is unreadable', () => {
    for (const bad of [null, undefined, 0, -1, Number.NaN, 'AGL-2562']) {
      const { ceiling, source } = raiseCeiling(cached, bad)
      assert.equal(ceiling.highest, 2559, `bad input ${String(bad)} must not change the ceiling`)
      assert.match(source, /cached/)
    }
  })

  it('does not mutate the cached ceiling', () => {
    const before = { ...cached }
    raiseCeiling(cached, 2562)
    assert.deepEqual(cached, before)
  })
})
