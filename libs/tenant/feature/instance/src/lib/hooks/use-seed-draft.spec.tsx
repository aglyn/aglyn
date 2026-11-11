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
 * A row editor's draft kept as edits over the live row (AGL-4047): opened
 * from the cache's copy, held until the server answers, and saved as the
 * server's row plus what was typed.
 */

import { act, renderHook } from '@testing-library/react'
import { useSeedDraft } from './use-seed-draft'

type Row = { id: string | null; name: string; uses: number; note?: string }

function renderDraft(rows: Row[]) {
  return renderHook(
    ({ rows }: { rows: Row[] }) =>
      useSeedDraft<Row>((opened) =>
        opened.id ? rows.find((row) => row.id === opened.id) : undefined,
      ),
    { initialProps: { rows } },
  )
}

const cached: Row = { id: 'r1', name: 'Spring sale', uses: 3 }

describe('useSeedDraft (AGL-4047)', () => {
  it('is closed until a row is opened, and opens on it', () => {
    const { result } = renderDraft([cached])
    expect(result.current[0]).toBeNull()
    act(() => result.current[1](cached))
    expect(result.current[0]).toEqual(cached)
    expect(result.current[2].dirty).toBe(false)
  })

  it('replays what was typed onto the row the server confirms', () => {
    const { result, rerender } = renderDraft([cached])
    act(() => result.current[1](cached))
    act(() => result.current[1]({ ...result.current[0]!, name: 'Summer sale' }))
    expect(result.current[2].dirty).toBe(true)

    // The server's row differs from the cache's in a field nobody touched.
    rerender({ rows: [{ ...cached, uses: 9 }] })

    expect(result.current[0]).toEqual({ id: 'r1', name: 'Summer sale', uses: 9 })
  })

  it('takes the updater form and builds each call on the one before', () => {
    const { result } = renderDraft([cached])
    act(() => result.current[1](cached))
    act(() => {
      result.current[1]((draft) => draft && { ...draft, name: 'A' })
      result.current[1]((draft) => draft && { ...draft, note: 'B' })
    })
    expect(result.current[0]).toEqual({ ...cached, name: 'A', note: 'B' })
  })

  it('keeps the row as opened when the list no longer holds it', () => {
    const { result, rerender } = renderDraft([cached])
    act(() => result.current[1](cached))
    act(() => result.current[1]({ ...result.current[0]!, name: 'Kept' }))
    rerender({ rows: [] })
    expect(result.current[0]).toEqual({ ...cached, name: 'Kept' })
  })

  it('opens a new row from its blank, which no list answer changes', () => {
    const blank: Row = { id: null, name: '', uses: 0 }
    const { result, rerender } = renderDraft([cached])
    act(() => result.current[1](blank))
    act(() => result.current[1]({ ...result.current[0]!, name: 'New' }))
    rerender({ rows: [cached, { ...cached, id: 'r2' }] })
    expect(result.current[0]).toEqual({ id: null, name: 'New', uses: 0 })
  })

  it('closes on null and forgets the edits, so the next open starts clean', () => {
    const { result } = renderDraft([cached])
    act(() => result.current[1](cached))
    act(() => result.current[1]({ ...result.current[0]!, name: 'Dropped' }))
    act(() => result.current[1](null))
    expect(result.current[0]).toBeNull()
    act(() => result.current[1](cached))
    expect(result.current[0]).toEqual(cached)
  })
})
