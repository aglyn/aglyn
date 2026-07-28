/**
 * @jest-environment node
 */

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
 * The folder sharing cascade's cursor (AGL-1045).
 *
 * The failure that matters is a slice that silently skips a document: the
 * console then reports a folder and its files as restricted when one file
 * is still org-wide. `chunkStart` arrives from the browser, so garbage in
 * has to mean "start over", never "skip ahead".
 */

import { scopeCascadeSlice } from './media-scope'

const BATCH = 500
const slice = (total: number, chunkStart?: unknown, chunkSize?: unknown) =>
  scopeCascadeSlice({ total, chunkStart, chunkSize, batchLimit: BATCH })

describe('scopeCascadeSlice', () => {
  it('writes everything in one pass when no cursor is sent', () => {
    // The pre-cursor callers still exist; they must keep their behaviour.
    expect(slice(48)).toEqual({ start: 0, size: 48, next: 48, done: true })
  })

  it('walks a subtree in slices and covers every doc exactly once', () => {
    const total = 253
    const seen: number[] = []
    let cursor = 0
    for (let guard = 0; guard < 100; guard += 1) {
      const step = slice(total, cursor, 100)
      for (let i = step.start; i < step.next; i += 1) seen.push(i)
      cursor = step.next
      if (step.done) break
    }
    expect(cursor).toBe(total)
    expect(seen).toEqual([...Array(total).keys()])
  })

  it('reports done for a cursor at or past the end, without looping', () => {
    expect(slice(10, 10, 100)).toEqual({
      start: 10,
      size: 0,
      next: 10,
      done: true,
    })
    // A stale cursor from a client that resumed after the folder shrank.
    expect(slice(10, 999, 100)).toMatchObject({ size: 0, done: true })
  })

  it('treats an unusable cursor as the beginning, never as a skip', () => {
    for (const bad of [undefined, null, -5, 'abc', NaN, {}, [1, 2]]) {
      expect(slice(30, bad, 10)).toMatchObject({ start: 0, size: 10 })
    }
  })

  it('never asks for more writes than one batch can commit', () => {
    expect(slice(2000, 0, 5000)).toMatchObject({ start: 0, size: BATCH })
  })

  it('handles the folder-only case (cascade off): one doc, one slice', () => {
    expect(slice(1)).toEqual({ start: 0, size: 1, next: 1, done: true })
  })

  it('is empty and done for an empty operation', () => {
    expect(slice(0)).toEqual({ start: 0, size: 0, next: 0, done: true })
  })
})
