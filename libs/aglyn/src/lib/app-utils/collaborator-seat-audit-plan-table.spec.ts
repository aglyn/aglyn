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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_ENTITLEMENTS, UNLIMITED } from './plan-entitlements'

/**
 * `tools/scripts/audit-collaborator-seat-allocation.mjs` transcribes the
 * collaborator caps out of `PLAN_ENTITLEMENTS` (AGL-2439). This asserts the
 * copy still matches.
 *
 * WHY A TRANSCRIPTION EXISTS AT ALL. The audit is plain ESM run by `node`
 * against production Firestore; the plan table is TypeScript inside an nx
 * graph with a build step. Importing it would mean building the library to
 * answer a read-only question about live data, which is the kind of friction
 * that gets an audit skipped.
 *
 * WHY THIS GUARD EXISTS. The audit's whole output is a COUNT of orgs above
 * the corrected cap, and that count is what the grandfathering decision rests
 * on. A stale transcription does not fail loudly — it silently sizes the
 * affected population against last month's plan table and reports a number
 * that looks exactly like a real one. This turns that into a red test the
 * next time anyone edits a plan's collaborator allowance.
 *
 * Forced red on purpose: changing any single number in the script's table
 * fails the matching key here, and deleting a plan from either side fails the
 * key-set assertion.
 */
describe('the collaborator audit script tracks PLAN_ENTITLEMENTS (AGL-2439)', () => {
  const source = readFileSync(
    join(
      __dirname,
      '../../../../../tools/scripts/audit-collaborator-seat-allocation.mjs',
    ),
    'utf8',
  )

  /**
   * Parsed out of the source rather than imported: the script calls
   * `initializeApp` and `process.exit` at module scope, so importing it from
   * a test would try to reach production.
   */
  function auditTable(): Record<
    string,
    { membersPerHost: number; maxMembersPerHost: number }
  > {
    const block = source.match(
      /AUDIT_PLAN_COLLABORATOR_CAPS = \{([\s\S]*?)\n\}/,
    )?.[1]
    if (!block) throw new Error('AUDIT_PLAN_COLLABORATOR_CAPS not found')
    const table: Record<string, any> = {}
    for (const [, plan, body] of block.matchAll(
      /(\w+):\s*\{([\s\S]*?)\}/g,
    )) {
      const read = (key: string): number => {
        const raw = body.match(new RegExp(`${key}:\\s*([^,\\n]+)`))?.[1]?.trim()
        if (raw === undefined) throw new Error(`${plan}.${key} missing`)
        return raw === 'Number.POSITIVE_INFINITY' ? UNLIMITED : Number(raw)
      }
      table[plan] = {
        membersPerHost: read('membersPerHost'),
        maxMembersPerHost: read('maxMembersPerHost'),
      }
    }
    return table
  }

  it('covers exactly the plans the entitlement table declares', () => {
    expect(Object.keys(auditTable()).sort()).toEqual(
      Object.keys(PLAN_ENTITLEMENTS).sort(),
    )
  })

  it('carries the same two collaborator numbers for every plan', () => {
    const table = auditTable()
    for (const [plan, entitlements] of Object.entries(PLAN_ENTITLEMENTS)) {
      expect({ plan, ...table[plan] }).toEqual({
        plan,
        membersPerHost: entitlements.membersPerHost,
        maxMembersPerHost: entitlements.maxMembersPerHost,
      })
    }
  })

  it('parses something real — the guard cannot pass on an empty table', () => {
    // Without this, a regex that stopped matching would yield `{}` and the
    // per-plan loop above would assert nothing at all.
    const table = auditTable()
    expect(Object.keys(table).length).toBeGreaterThanOrEqual(8)
    expect(table['free'].membersPerHost).toBe(1)
    expect(table['enterprise'].membersPerHost).toBe(UNLIMITED)
  })
})
