/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
import { recordAssistExchange, reserveAssistMessage } from './assist-usage'

/**
 * The third claim of the Anthropic subprocessor gate (AGL-1909): every Assist
 * record is written under the org document, which is what makes the retention
 * promise in the privacy disclosure true.
 *
 * `apps/console/specs/assist-anthropic-subprocessor-gate.spec.ts` holds the
 * other two, the flag and the key readers, which it reads as source. This one
 * drives the meter itself, so it sits beside the meter: an app reaches a
 * plugin only through its generated manifests (docs/PACKAGES.md).
 *
 * The meter reads `FieldValue` straight off the SDK, so the sentinel factory
 * is stubbed there, and the assertions below stay about PATHS.
 */
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')

/**
 * The retention half of the disclosure, pinned as behaviour.
 *
 * The privacy text can promise that erasing a workspace erases its assistant
 * history only because all four Assist collections are genuine
 * SUBCOLLECTIONS of the org document — `eraseOrg` finishes with
 * `recursiveDelete(orgRef)`, and a path-scoped cascade is structurally blind
 * to anything not under the path. `apiKeys`, `ssoDomains` and the console
 * domain claims are the standing proof of that blindness: each carries
 * `orgId` as a FIELD and needed its own sweep.
 *
 * So this asserts the WRITES, not the doc comment. The standing condition it
 * enforces: if a later phase denormalizes exchanges into a top-level
 * staff-mining collection — which the AGL-1860 spec explicitly wants, ranking
 * docs gaps by question frequency across orgs — this goes red, and the right
 * response is to change the published policy or add the sweep, not to widen
 * the assertion.
 */
describe('assist records stay reachable by eraseOrg (AGL-1860, AGL-1909)', () => {
  it('writes every record under orgs/{orgId}/', async () => {
    const written: string[] = []
    const makeDoc = (path: string) => ({
      path,
      id: path.split('/').pop(),
      collection: (name: string) => makeCollection(`${path}/${name}`),
    })
    const makeCollection = (prefix: string) => ({
      doc: (id?: string) => makeDoc(`${prefix}/${id ?? 'auto-1'}`),
    })
    const firestore = {
      collection: (name: string) => makeCollection(name),
      // The counters/rollup writes moved into the RESERVATION (AGL-2057), so
      // the erasure surface is only complete if this test drives both halves.
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          get: async () => ({
            exists: false,
            data: () => undefined,
            get: () => undefined,
          }),
          set: (ref: { path: string }) => {
            written.push(ref.path)
          },
        }),
      batch: () => ({
        set: (ref: { path: string }) => {
          written.push(ref.path)
        },
        commit: async () => undefined,
      }),
    } as unknown as FirebaseFirestore.Firestore

    await reserveAssistMessage(firestore, 'org-1', false)
    await recordAssistExchange(firestore, 'org-1', {
      uid: 'user-1',
      question: 'How do I publish?',
      answer: 'Press Publish.',
      route: '/acme/screens',
      hostId: 'host-1',
      model: 'claude-sonnet-5',
      tier: 'free',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      docsPaths: [],
      stopReason: 'end_turn',
    })

    // All FIVE: the exchange, its signal, the daily counter, the monthly
    // rollup, and the asker's own month (AGL-2928). `assistSignals` is the
    // half AGL-1972 split out so the prose could be given a TTL without
    // destroying the data loop — and splitting it created a new collection,
    // which is precisely the moment a cascade silently stops covering
    // everything. The length is asserted so a sixth collection added later
    // cannot slip past this list unnoticed.
    // Deduped: the monthly rollup is touched by BOTH halves now — the
    // reservation counts the message, the batch folds in the tokens.
    const distinct = [...new Set(written)]
    expect(distinct).toHaveLength(5)
    for (const path of distinct) {
      expect([path, path.startsWith('orgs/org-1/')]).toEqual([path, true])
    }
    expect(distinct.map((path) => path.split('/')[2]).sort()).toEqual([
      'aiUsageByUser',
      'assistExchanges',
      'assistSignals',
      'assistUsage',
      'counters',
    ])
    // The per-user month is keyed by the ASKER, under the org: the org's
    // cascade takes it, and `eraseUser` sweeps it by uid (AGL-2928).
    expect(distinct).toContain('orgs/org-1/aiUsageByUser/user-1/months/' +
      new Date().toISOString().slice(0, 7))
  })

  it('still finishes eraseOrg with a recursive delete of the org doc', () => {
    // The other half of the reachability claim. Org-scoped paths only help
    // while something actually walks the org tree; if this call goes away the
    // subcollection assertion above becomes decorative.
    const erase = readFileSync(
      join(REPO_ROOT, 'libs/tenant/data/admin/src/lib/server/erase.ts'),
      'utf8',
    )
    expect(erase).toContain('recursiveDelete(orgRef)')
  })
})
