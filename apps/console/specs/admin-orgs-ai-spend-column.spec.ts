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
 * The Organizations list's "AI spend (month)" column (AGL-2930).
 *
 * The grid sorts what the column's getter returns, so the one thing that can
 * go wrong is the getter handing it a string: `$10.0000` sorts before
 * `$9.0000`. The getter is pinned to return a NUMBER, an unmeasured org to
 * sort last, and the page to use that getter rather than a local one.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  aiSpendCell,
  aiSpendSortValue,
  byAiSpendDesc,
} from '../utils/staff-org-ai-spend'

describe('orgs list AI spend column (AGL-2930)', () => {
  it('sorts on the number, so ten lands after nine and not before it', () => {
    const rows = [{ aiSpendUsd: 10 }, { aiSpendUsd: 9 }, { aiSpendUsd: 0.08 }]
    expect(rows.map(aiSpendSortValue)).toEqual([10, 9, 0.08])
    expect([...rows].sort(byAiSpendDesc).map((row) => row.aiSpendUsd)).toEqual([
      10, 9, 0.08,
    ])
    // The formatted cell is what the getter must NOT return.
    expect(['$10.0000', '$9.0000'].sort()).toEqual(['$10.0000', '$9.0000'])
  })

  it('puts an unmeasured org last, and never renders it as $0', () => {
    const rows = [{ aiSpendUsd: null }, { aiSpendUsd: 2 }, {}, { aiSpendUsd: 5 }]
    expect([...rows].sort(byAiSpendDesc).map((row) => row.aiSpendUsd ?? null)).toEqual([
      5, 2, null, null,
    ])
    expect(aiSpendSortValue({ aiSpendUsd: null })).toBeNull()
    expect(aiSpendCell({ aiSpendUsd: null })).toBe('—')
    expect(aiSpendCell({ aiSpendUsd: 0 })).toBe('$0.0000')
    expect(aiSpendCell({ aiSpendUsd: 0.08 })).toBe('$0.0800')
  })

  it('is the getter the page column actually uses', () => {
    const source = readFileSync(
      join(__dirname, '../app/(app)/admin/orgs/page.tsx'),
      'utf8',
    )
    expect(source).toContain("field: 'aiSpendUsd'")
    expect(source).toContain("headerName: 'AI spend (month)'")
    expect(source).toContain('valueGetter: (_value, row: any) => aiSpendSortValue(row)')
  })

  it('is served per row by the orgs route', () => {
    const source = readFileSync(
      join(__dirname, '../app/api/admin/orgs/route.ts'),
      'utf8',
    )
    expect(source).toContain("aiSpendUsd: aiSpendByOrgId.get(docSnap.id) ?? null")
  })
})
