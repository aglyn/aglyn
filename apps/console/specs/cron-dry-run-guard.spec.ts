/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isCronDryRun } from '../utils/cron-auth'

/**
 * The GET-is-a-dry-run rule, and the fact that every route that needs it
 * actually calls it (AGL-2084).
 *
 * The rule was invented twice, transcribed inline both times, and never
 * written a third time for `audit-archive` — the route that moves audit rows
 * into Storage and then DELETES them from Firestore. Four lines copied by hand
 * into each route is how a control goes missing from exactly one of them, so
 * the rule now lives in `isCronDryRun` and this file holds both ends: what the
 * helper decides, and which routes are wired to it.
 *
 * There is no second line of defence behind these routes. The cron executor
 * reaches Firestore through the Admin SDK, which is not subject to any security
 * rule, so the route-level guard IS the control.
 */
describe('isCronDryRun — the rule itself', () => {
  it('defaults a GET to a dry run and a POST to a real run', () => {
    // The whole point: the verb everything on the web treats as safe to
    // retry, prefetch and follow must not write.
    expect(isCronDryRun({ method: 'GET' })).toBe(true)
    expect(isCronDryRun({ method: 'POST' })).toBe(false)
  })

  it('keys the default on the METHOD, not on the body being absent', () => {
    // Load-bearing. `scheduled-crons.yml` fires every one of these routes
    // with `curl -X POST` and no body at all; a helper that read an absent
    // `dryRun` as "be safe" would silently stop the archival, the reaping and
    // the re-verification — a worse failure than the one being guarded, and
    // one nothing would notice for 90 days.
    expect(isCronDryRun({ method: 'POST', body: undefined, query: {} })).toBe(
      false,
    )
    expect(isCronDryRun({ method: 'POST', body: {} })).toBe(false)
  })

  it('lets an explicit flag beat the method in BOTH directions', () => {
    // A guard that could only be tightened would leave no way to run the real
    // job by hand, and a guard that could only be loosened would not be one.
    expect(isCronDryRun({ method: 'GET', query: { dryRun: '0' } })).toBe(false)
    expect(isCronDryRun({ method: 'GET', query: { dryRun: 'false' } })).toBe(
      false,
    )
    expect(isCronDryRun({ method: 'POST', body: { dryRun: true } })).toBe(true)
    expect(isCronDryRun({ method: 'POST', body: { dryRun: '1' } })).toBe(true)
    expect(isCronDryRun({ method: 'POST', body: { dryRun: false } })).toBe(
      false,
    )
  })

  it('prefers the body over the query string', () => {
    // Both original routes read `body?.dryRun ?? query['dryRun']`, and the
    // resumable-sweep loop in the workflow re-POSTs a body while the URL
    // keeps whatever query string it started with.
    expect(
      isCronDryRun({
        method: 'POST',
        body: { dryRun: true },
        query: { dryRun: '0' },
      }),
    ).toBe(true)
  })

  it('treats anything it does not recognise as a DRY RUN', () => {
    // Fail safe, not open. `?dryRun` with no value arrives as '', and a
    // repeated `?dryRun=1&dryRun=0` arrives as an array — neither is one of
    // the three off switches, so neither may license a delete.
    expect(isCronDryRun({ method: 'POST', query: { dryRun: '' } })).toBe(true)
    expect(
      isCronDryRun({ method: 'POST', query: { dryRun: ['1', '0'] } }),
    ).toBe(true)
    expect(isCronDryRun({ method: 'POST', body: { dryRun: 'nope' } })).toBe(
      true,
    )
  })
})

describe('the routes are WIRED to it', () => {
  const apiRoot = join(__dirname, '..', 'app', 'api')
  const read = (route: string) =>
    readFileSync(join(apiRoot, route, 'route.ts'), 'utf8')

  /**
   * Every scheduled route that writes something a later run cannot take back.
   * `audit-archive` deletes Firestore audit rows; the other three write
   * Storage objects, stored verdicts and Vercel domain state.
   */
  const guarded = [
    'admin/audit-archive',
    'admin/reap-plugin-artifacts',
    'admin/reverify-plugin-versions',
    'admin/finish-domain-attachments',
  ]

  it.each(guarded)('%s calls the shared helper', (route) => {
    const source = read(route)
    // Imported AND called — a defined-but-unused guard is the shape this
    // repo keeps finding, so presence of the import alone proves nothing.
    expect(source).toMatch(/import \{[^}]*isCronDryRun[^}]*\} from/)
    expect(source).toMatch(/const dryRun = isCronDryRun\(/)
  })

  it('audit-archive consults dryRun before every irreversible step', () => {
    const source = read('admin/audit-archive')
    // The three things a run does that a later run cannot undo, each
    // downstream of the flag: the Storage write and the batch delete sit
    // behind the `if (dryRun) … continue`, and the staff email behind its
    // own `!dryRun`.
    const guardIndex = source.indexOf('const dryRun = isCronDryRun(')
    expect(guardIndex).toBeGreaterThan(-1)
    for (const irreversible of ['.save(', 'batch.delete(', 'sendEmail(']) {
      expect(source.indexOf(irreversible)).toBeGreaterThan(guardIndex)
    }
    expect(source).toMatch(/if \(dryRun\) \{/)
    expect(source).toMatch(/staffEmail && !dryRun/)
  })

  it('no route re-implements the rule inline any more', () => {
    // The drift check, and the reason this bug existed: the next route to
    // transcribe `dryRun … method === 'GET'` by hand is the next one to get a
    // character of it wrong, or to leave it out.
    //
    // `admin/backfill-scope` is the deliberate exception and is named rather
    // than pattern-matched: it is dry-run ALWAYS for a cron caller
    // (`scheduled || …`) and refuses `dryRun: false` to the scheduler
    // outright, which is a stricter rule than this helper's, not a copy of it.
    const inline =
      /dryRun[\s\S]{0,160}?method === 'GET'|method === 'GET'[\s\S]{0,160}?dryRun/
    const offenders = require('node:child_process')
      .execFileSync(
        'grep',
        ['-rl', '--include=route.ts', 'dryRun', apiRoot],
        { encoding: 'utf8' },
      )
      .split('\n')
      .filter(Boolean)
      .filter((file: string) => !file.includes('admin/backfill-scope'))
      .filter((file: string) => inline.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
