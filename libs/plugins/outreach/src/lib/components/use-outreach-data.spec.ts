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

import { renderHook } from '@testing-library/react'
import {
  OUTREACH_SEQUENCES_LIMIT,
  useOutreachSequences,
} from './use-outreach-data'

/** How many sequence documents the fake collection holds. */
let mockStored = 0
/** The `limit` each listen asked for. */
let mockLimits: number[] = []

/** One instance, as the real hook returns: the listen is keyed on it. */
const mockFirestore = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
}))

jest.mock('../model/stored-records', () => ({
  readStoredOutreachEnrollment: () => null,
  readStoredOutreachSequence: (id: string, data: { createdAtMs: number }) => ({
    id,
    createdAtMs: data.createdAtMs,
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: () => ({ constraints: [] }),
  doc: () => ({}),
  documentId: () => '__name__',
  where: () => ({}),
  orderBy: () => ({}),
  limit: (value: number) => ({ limit: value }),
  query: (_base: unknown, ...constraints: Array<{ limit?: number }>) => ({
    cap: constraints.find((entry) => typeof entry.limit === 'number')?.limit,
  }),
  onSnapshot: (built: { cap: number }, next: (snapshot: unknown) => void) => {
    mockLimits.push(built.cap)
    const count = Math.min(mockStored, built.cap)
    next({
      docs: Array.from({ length: count }, (_unused, at) => ({
        id: `seq-${at}`,
        data: () => ({ createdAtMs: 10_000 - at }),
      })),
    })
    return () => undefined
  },
}))

beforeEach(() => {
  mockLimits = []
})

describe('useOutreachSequences reports its cap honestly (AGL-3321)', () => {
  it('reads one past the cap and lists no more than the cap', () => {
    mockStored = OUTREACH_SEQUENCES_LIMIT + 5
    const { result } = renderHook(() => useOutreachSequences('org-1'))
    expect(mockLimits).toEqual([OUTREACH_SEQUENCES_LIMIT + 1])
    expect(result.current.data).toHaveLength(OUTREACH_SEQUENCES_LIMIT)
    expect(result.current.truncated).toBe(true)
  })

  it('is not truncated at exactly the cap', () => {
    mockStored = OUTREACH_SEQUENCES_LIMIT
    const { result } = renderHook(() => useOutreachSequences('org-1'))
    expect(result.current.data).toHaveLength(OUTREACH_SEQUENCES_LIMIT)
    expect(result.current.truncated).toBe(false)
  })
})
