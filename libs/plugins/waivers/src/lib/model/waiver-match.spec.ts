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
import { waiverMatchName, waiverNameDobKey, waiverNameDobKeys, waiverNameDobKeysCurrent } from './waiver-match'

/**
 * The match key check-in finds a rider's signature by when their email
 * matches nothing (AGL-4042): a full name and a date of birth together.
 */

describe('a rider’s name and date of birth as one key', () => {
  it('ignores case and spacing in the name, and nothing else', () => {
    expect(waiverMatchName('  Jordan   LEE ')).toBe('jordan lee')
    expect(waiverNameDobKey('  Jordan   LEE ', '1990-04-02')).toBe('jordan lee|1990-04-02')
    expect(waiverNameDobKey('Jordan Lee', '1990-04-02')).toBe(waiverNameDobKey('JORDAN LEE', '1990-04-02'))
    // Spelling counts: a different name is a different person.
    expect(waiverNameDobKey('Jordan Leigh', '1990-04-02')).not.toBe(waiverNameDobKey('Jordan Lee', '1990-04-02'))
  })

  it('makes no key from a name alone, or from a date that is not a day', () => {
    expect(waiverNameDobKey('Jordan Lee', '')).toBeNull()
    expect(waiverNameDobKey('Jordan Lee', '1990-02-30')).toBeNull()
    expect(waiverNameDobKey('Jordan Lee', '04/02/1990')).toBeNull()
    expect(waiverNameDobKey('   ', '1990-04-02')).toBeNull()
  })

  it('keys the signer and every minor on a signature, once each', () => {
    expect(
      waiverNameDobKeys({
        signer: { name: 'Jordan Lee', dateOfBirth: '1990-04-02' },
        minors: [
          { name: 'Pat Lee', dateOfBirth: '2014-09-30' },
          { name: 'pat lee', dateOfBirth: '2014-09-30' },
          { name: 'Sam Lee', dateOfBirth: '' },
        ],
      }),
    ).toEqual(['jordan lee|1990-04-02', 'pat lee|2014-09-30'])
  })

  it('says whether stored keys are the ones its people give', () => {
    const signature = { signer: { name: 'Jordan Lee', dateOfBirth: '1990-04-02' }, minors: [] }
    expect(waiverNameDobKeysCurrent(signature)).toBe(false)
    expect(waiverNameDobKeysCurrent({ ...signature, nameDobKeys: ['jordan lee|1990-04-02'] })).toBe(true)
    expect(waiverNameDobKeysCurrent({ ...signature, nameDobKeys: ['jordan lee|1990-04-03'] })).toBe(false)
  })

  it('has the index its query needs: waiverSignatures (hostId, nameDobKeys CONTAINS, signedAtMs DESC)', () => {
    const config: { indexes: Array<{ collectionGroup: string; queryScope: string; fields: unknown[] }> } = JSON.parse(
      readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
    )
    expect(
      config.indexes.some(
        (index) =>
          index.collectionGroup === 'waiverSignatures' &&
          index.queryScope === 'COLLECTION' &&
          JSON.stringify(index.fields) ===
            JSON.stringify([
              { fieldPath: 'hostId', order: 'ASCENDING' },
              { fieldPath: 'nameDobKeys', arrayConfig: 'CONTAINS' },
              { fieldPath: 'signedAtMs', order: 'DESCENDING' },
            ]),
      ),
    ).toBe(true)
  })
})
