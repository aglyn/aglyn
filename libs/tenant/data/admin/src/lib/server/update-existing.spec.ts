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

/**
 * `updateExisting` earns its existence by what it does NOT swallow (AGL-1763).
 *
 * The one-liner it replaces — `ref.update(data).catch(() => false)` — reports
 * "the document was absent" for a permission denial, an App Check rejection, a
 * transport failure and an INVALID_ARGUMENT alike. Callers map `false` onto a
 * 404 or an audit row, so that shorthand turns an outage into a confident lie
 * about the data. Only gRPC `NOT_FOUND` means absent; the discrimination is the
 * whole helper, so every non-`NOT_FOUND` code has a test.
 */

import { updateExisting } from './update-existing'

/** gRPC codes: NOT_FOUND, PERMISSION_DENIED, INVALID_ARGUMENT, UNAVAILABLE. */
const NOT_FOUND = 5
const PERMISSION_DENIED = 7
const INVALID_ARGUMENT = 3
const UNAVAILABLE = 14

function rejectingRef(code: number, message = 'boom') {
  return {
    path: 'orgs/org-1',
    update: jest.fn(async () => {
      const error: Error & { code?: number } = new Error(message)
      error.code = code
      throw error
    }),
  }
}

describe('updateExisting', () => {
  it('applies the patch and reports true when the document exists', async () => {
    const update = jest.fn(async () => undefined)
    const applied = await updateExisting({ update }, { plan: 'starter' })
    expect(applied).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ plan: 'starter' })
  })

  it('reports false — and does NOT throw — on NOT_FOUND', async () => {
    const ref = rejectingRef(NOT_FOUND, '5 NOT_FOUND: no entity to update')
    await expect(updateExisting(ref, { plan: 'starter' })).resolves.toBe(false)
  })

  it('RETHROWS a permission denial rather than calling it absent', async () => {
    // The failure the `.catch(() => false)` shorthand hides: a rules or
    // credentials problem reported as "there is no such org", which a caller
    // then records as an orphaned subscription that does not exist.
    const ref = rejectingRef(PERMISSION_DENIED)
    await expect(updateExisting(ref, { plan: 'starter' })).rejects.toThrow('boom')
  })

  it('RETHROWS an INVALID_ARGUMENT — the nested delete-sentinel trap', async () => {
    // `set({ merge: true })` accepts a delete sentinel at any depth; `update()`
    // accepts one only at the root. Swallowing this would silently drop the
    // write and report the document missing.
    const ref = rejectingRef(
      INVALID_ARGUMENT,
      'FieldValue.delete() must appear at the top-level',
    )
    await expect(updateExisting(ref, { discount: {} })).rejects.toThrow(
      'top-level',
    )
  })

  it('RETHROWS a transport failure', async () => {
    const ref = rejectingRef(UNAVAILABLE)
    await expect(updateExisting(ref, { plan: 'starter' })).rejects.toThrow('boom')
  })

  it('RETHROWS an error carrying no code at all', async () => {
    const ref = {
      update: jest.fn(async () => {
        throw new Error('plain')
      }),
    }
    await expect(updateExisting(ref, { plan: 'starter' })).rejects.toThrow('plain')
  })

  it('does not mistake a STRING "5" for the NOT_FOUND code', async () => {
    // Strict equality on purpose: a coerced comparison would let an unrelated
    // library's `code: '5'` masquerade as an absent document.
    const ref = rejectingRef('5' as never)
    await expect(updateExisting(ref, { plan: 'starter' })).rejects.toThrow('boom')
  })
})
