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
 * Which hash answers for a site member (AGL-3308).
 *
 * The credential document is authoritative once it carries a hash; the copy
 * on the profile answers only for a member the migration has not reached.
 * Every password check and every reset-token binding goes through
 * `storedPasswordHash`, so these cases are the whole precedence rule.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    firestore: { FieldValue: { delete: () => 'field-deleted' } },
  },
}))

import {
  isMemberDocumentId,
  MEMBER_CREDENTIAL_FIELDS,
  memberCredentialRef,
  readMemberPasswordHash,
  retiredCredentialFields,
  storedPasswordHash,
} from './member-credentials'

const snapshot = (
  fields: Record<string, unknown> | null,
  id = 'member-1',
): FirebaseFirestore.DocumentSnapshot =>
  ({
    id,
    exists: fields !== null,
    get: (field: string) => fields?.[field],
  }) as unknown as FirebaseFirestore.DocumentSnapshot

const MOVED = `${'a'.repeat(32)}:${'b'.repeat(128)}`
const LEGACY = `${'c'.repeat(32)}:${'d'.repeat(128)}`

describe('storedPasswordHash', () => {
  it('answers with the credential document once it carries a hash', () => {
    expect(
      storedPasswordHash(
        snapshot({ passwordScrypt: MOVED }),
        snapshot({ passwordScrypt: LEGACY }),
      ),
    ).toBe(MOVED)
  })

  it('falls back to the legacy copy for a member with no credential document', () => {
    expect(
      storedPasswordHash(snapshot(null), snapshot({ passwordScrypt: LEGACY })),
    ).toBe(LEGACY)
  })

  it('falls back when the credential document holds no usable hash', () => {
    // A document the migration wrote for `passwordResetAt` alone, or one
    // carrying junk, does not blank a member whose hash is still legacy.
    for (const credential of [
      snapshot({ passwordResetAt: 'yesterday' }),
      snapshot({ passwordScrypt: '' }),
      snapshot({ passwordScrypt: 42 }),
    ]) {
      expect(
        storedPasswordHash(credential, snapshot({ passwordScrypt: LEGACY })),
      ).toBe(LEGACY)
    }
  })

  it('answers nothing for a member with no hash anywhere', () => {
    expect(storedPasswordHash(snapshot(null), snapshot({}))).toBeUndefined()
    expect(storedPasswordHash(null, null)).toBeUndefined()
    expect(
      storedPasswordHash(snapshot(null), snapshot({ passwordScrypt: 7 })),
    ).toBeUndefined()
  })

  it('never reads the profile of a member that does not exist', () => {
    expect(
      storedPasswordHash(snapshot(null), snapshot(null)),
    ).toBeUndefined()
  })
})

describe('readMemberPasswordHash', () => {
  it('reads the credential document named by the member, under that site', async () => {
    const paths: string[] = []
    const hostRef = {
      collection: (name: string) => ({
        doc: (id: string) => {
          paths.push(`${name}/${id}`)
          return { get: async () => snapshot({ passwordScrypt: MOVED }, id) }
        },
      }),
    } as unknown as FirebaseFirestore.DocumentReference
    await expect(
      readMemberPasswordHash(hostRef, snapshot({ passwordScrypt: LEGACY }, 'member-7')),
    ).resolves.toBe(MOVED)
    expect(paths).toEqual(['siteMemberCredentials/member-7'])
  })

  it('addresses the same document the writers do', () => {
    const hostRef = {
      collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
    } as unknown as FirebaseFirestore.DocumentReference
    expect((memberCredentialRef(hostRef, 'member-7') as any).path).toBe(
      'siteMemberCredentials/member-7',
    )
  })
})

describe('retiredCredentialFields', () => {
  it('deletes exactly the credential fields from a profile', () => {
    expect(retiredCredentialFields()).toEqual({
      passwordScrypt: 'field-deleted',
      passwordResetAt: 'field-deleted',
    })
    expect(Object.keys(retiredCredentialFields()).sort()).toEqual(
      [...MEMBER_CREDENTIAL_FIELDS].sort(),
    )
  })
})

describe('isMemberDocumentId', () => {
  it('accepts an auto id and a seeded one', () => {
    expect(isMemberDocumentId('Xy12AbCdEfGhIjKlMnOp')).toBe(true)
    expect(isMemberDocumentId('seed-site-member')).toBe(true)
  })

  it('refuses what would address another document', () => {
    for (const id of ['', 'member-1/nested/doc', 'a/b', '.', '..', 'x'.repeat(1501)]) {
      expect([id.slice(0, 20), isMemberDocumentId(id)]).toEqual([id.slice(0, 20), false])
    }
  })
})
