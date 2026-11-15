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

import { accountEndRefuses, readEditHintEndedAt } from './edit-hint-end'

/**
 * The two endings the site edit bar reads without anything new being written
 * (AGL-1842): a device signed out from the device list (`devices/{did}`), and
 * the account signed out everywhere (`tokensValidAfterTime`).
 */
describe('edit hint endings', () => {
  const DID = 'device-browser-a-0001'

  function firestoreWith(docs: Record<string, Record<string, unknown>>) {
    const reads: string[] = []
    const firestore = {
      collection: (top: string) => ({
        doc: (uid: string) => ({
          collection: (sub: string) => ({
            doc: (id: string) => ({
              get: async () => {
                const path = `${top}/${uid}/${sub}/${id}`
                reads.push(path)
                const data = docs[path]
                return {
                  exists: Boolean(data),
                  get: (field: string) => data?.[field],
                }
              },
            }),
          }),
        }),
      }),
    }
    return { firestore: firestore as never, reads }
  }

  describe('readEditHintEndedAt', () => {
    it('is the LATER of this browser’s sign-out and its device revoke', async () => {
      const { firestore } = firestoreWith({
        [`users/u1/editHintEnds/${DID}`]: { endedAt: 1_000 },
        [`users/u1/devices/${DID}`]: { revokedAt: 5_000, lastSeenAt: 4_000 },
      })
      expect(await readEditHintEndedAt(firestore, 'u1', DID)).toBe(5_000)
    })

    it('reads a live device row (no revokedAt) as no ending', async () => {
      const { firestore } = firestoreWith({
        [`users/u1/devices/${DID}`]: { lastSeenAt: 4_000 },
      })
      expect(await readEditHintEndedAt(firestore, 'u1', DID)).toBe(0)
    })

    it('reads only this browser’s two documents', async () => {
      const { firestore, reads } = firestoreWith({})
      await readEditHintEndedAt(firestore, 'u1', DID)
      expect(reads.sort()).toEqual([
        `users/u1/devices/${DID}`,
        `users/u1/editHintEnds/${DID}`,
      ])
    })

    it('reads nothing for an unusable browser id', async () => {
      const { firestore, reads } = firestoreWith({})
      expect(await readEditHintEndedAt(firestore, 'u1', 'a/b')).toBe(0)
      expect(reads).toEqual([])
    })
  })

  describe('accountEndRefuses', () => {
    const at = Date.UTC(2026, 10, 14, 12, 0, 0)

    it('refuses a credential proven before the account epoch', () => {
      expect(accountEndRefuses(new Date(at).toUTCString(), at - 5_000)).toBe(true)
    })

    it('admits one proven after it (signed back in)', () => {
      expect(accountEndRefuses(new Date(at).toUTCString(), at + 5_000)).toBe(false)
    })

    it('compares whole seconds, like the ID-token check', () => {
      // `tokensValidAfterTime` has second granularity; a hint minted later in
      // the same second must not read as refused.
      expect(accountEndRefuses(new Date(at).toUTCString(), at + 400)).toBe(false)
    })

    it('ends nothing for an account that was never revoked', () => {
      expect(accountEndRefuses(undefined, at)).toBe(false)
      expect(accountEndRefuses(null, at)).toBe(false)
      expect(accountEndRefuses('not a date', at)).toBe(false)
    })

    it('refuses an undateable credential once an epoch exists', () => {
      expect(accountEndRefuses(at, 0)).toBe(true)
    })
  })
})
