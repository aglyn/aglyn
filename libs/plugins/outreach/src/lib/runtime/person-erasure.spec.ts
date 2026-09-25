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
 *
 * @jest-environment node
 */

import { outreachDoNotContactKey } from '../engine/do-not-contact'
import { createOutreachPersonEraser } from './person-erasure'

/**
 * A PERSON ERASURE TAKES THEIR HISTORY WITH THEIR ENROLLMENTS (AGL-3332).
 *
 * A subcollection outlives the document above it, so an erasure that
 * deleted the enrollment alone would leave every link the person followed,
 * and when, under a path nothing lists — a record of an erased person that
 * nobody could find to delete. The in-memory store below is paths to data,
 * which is all the eraser reaches.
 */

type Data = Record<string, unknown>

const ORG = 'org-1'
const EMAIL = 'lee@example.com'
const ENROLLMENTS = `orgs/${ORG}/outreachEnrollments`

function fakeFirestore(docs: Map<string, Data>): FirebaseFirestore.Firestore {
  const doc = (path: string): any => ({
    path,
    id: path.slice(path.lastIndexOf('/') + 1),
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    update: async (data: Data) => void docs.set(path, { ...(docs.get(path) ?? {}), ...data }),
  })
  const children = (path: string) =>
    [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
  const collection = (path: string): any => ({
    doc: (id: string) => doc(`${path}/${id}`),
    get: async () => ({ docs: children(path).map((key) => ({ id: key.slice(path.length + 1), ref: doc(key) })) }),
    where: (field: string, op: string, value: unknown) => ({
      get: async () => ({
        docs: children(path)
          .filter((key) => {
            const held = docs.get(key)?.[field]
            return op === 'in' ? (value as unknown[]).includes(held) : held === value
          })
          .map((key) => ({ id: key.slice(path.length + 1), ref: doc(key) })),
      }),
    }),
  })
  return {
    collection,
    batch: () => {
      const deletes: string[] = []
      return {
        delete: (ref: { path: string }) => void deletes.push(ref.path),
        commit: async () => deletes.forEach((path) => docs.delete(path)),
      }
    },
  } as unknown as FirebaseFirestore.Firestore
}

describe('Outreach’s share of a person erasure', () => {
  const seeded = () =>
    new Map<string, Data>([
      [`${ENROLLMENTS}/seq-1_c-1`, { email: EMAIL, contactId: 'c-1' }],
      [`${ENROLLMENTS}/seq-1_c-1/history/000000000000001-aaaaaa`, { kind: 'click', atMs: 1 }],
      [`${ENROLLMENTS}/seq-1_c-1/history/000000000000002-bbbbbb`, { kind: 'action', atMs: 2 }],
      [`${ENROLLMENTS}/seq-2_c-1`, { email: 'someone.else@example.com', contactId: 'c-1' }],
      [`${ENROLLMENTS}/seq-3_c-9`, { email: 'kept@example.com', contactId: 'c-9' }],
      [`${ENROLLMENTS}/seq-3_c-9/history/000000000000003-cccccc`, { kind: 'click', atMs: 3 }],
    ])

  it('deletes each of the person’s enrollments and every row of its history, and no one else’s', async () => {
    const docs = seeded()
    const erase = createOutreachPersonEraser({ firestore: () => fakeFirestore(docs) })
    const report = await erase({
      orgId: ORG,
      email: EMAIL,
      key: outreachDoNotContactKey(EMAIL),
      contactIds: ['c-1'],
      dryRun: false,
    } as never)
    expect(report).toMatchObject({ enrollments: 2 })
    expect([...docs.keys()].sort()).toEqual([
      `${ENROLLMENTS}/seq-3_c-9`,
      `${ENROLLMENTS}/seq-3_c-9/history/000000000000003-cccccc`,
    ])
  })

  it('counts on a dry run and deletes nothing', async () => {
    const docs = seeded()
    const erase = createOutreachPersonEraser({ firestore: () => fakeFirestore(docs) })
    const report = await erase({
      orgId: ORG,
      email: EMAIL,
      key: outreachDoNotContactKey(EMAIL),
      contactIds: ['c-1'],
      dryRun: true,
    } as never)
    expect(report).toMatchObject({ enrollments: 2 })
    expect(docs.size).toBe(6)
  })
})
