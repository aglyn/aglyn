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
 * AGL-1490. Restoring a Firestore backup creates a NEW database — it cannot
 * restore into `(default)` — so recovery depends on being able to point the
 * platform at a restored database by CONFIGURATION, not by shipping a code
 * change mid-incident. `FIRESTORE_DATABASE_ID` is that lever. The properties
 * that matter:
 *
 *   - unset (every environment today): the databaseId reaching the Admin SDK
 *     is `undefined`, which the SDK resolves to `(default)` via
 *     `databaseId || DEFAULT_DATABASE_ID` — bit-identical to the pre-AGL-1490
 *     one-argument call;
 *   - set: the NAMED database id reaches every `getFirestore` call, through
 *     both compatibility facades (`fbAdmin` in shared-util-fbserver and
 *     `firebaseAdmin` here);
 *   - the empty string is normalized to undefined — `FIRESTORE_DATABASE_ID=`
 *     in an env file must not send the literal `''` to the SDK (which would
 *     also fall through, but only by accident of the SDK's `||`);
 *   - the value is read at CALL time, so a process restarted with new env is
 *     enough — no module-load-order trap.
 */

const mockApp = { name: 'mock-default-app' }
const mockFirestore = { __sentinel: 'firestore' }
const mockGetFirestore = jest.fn(() => mockFirestore)

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApps: () => [mockApp],
  getApp: () => mockApp,
  initializeApp: jest.fn(() => mockApp),
  cert: jest.fn(() => ({})),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  getFirestore: (...args: unknown[]) => mockGetFirestore(...(args as [])),
  FieldValue: { serverTimestamp: () => ({}) },
  Timestamp: { now: () => ({}) },
  FieldPath: class {},
}))

import fbAdmin, { firestoreDatabaseId } from '@aglyn/shared-util-fbserver'
import firebaseAdmin from './firebase-admin'

const ORIGINAL = process.env.FIRESTORE_DATABASE_ID

beforeEach(() => {
  delete process.env.FIRESTORE_DATABASE_ID
  mockGetFirestore.mockClear()
})

afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.FIRESTORE_DATABASE_ID
  else process.env.FIRESTORE_DATABASE_ID = ORIGINAL
})

describe('firestoreDatabaseId', () => {
  it('is undefined when the env var is unset', () => {
    expect(firestoreDatabaseId()).toBeUndefined()
  })

  it('returns the env value when set', () => {
    process.env.FIRESTORE_DATABASE_ID = 'restore-rehearsal-2026-08-13'
    expect(firestoreDatabaseId()).toBe('restore-rehearsal-2026-08-13')
  })

  it('normalizes the empty string to undefined', () => {
    process.env.FIRESTORE_DATABASE_ID = ''
    expect(firestoreDatabaseId()).toBeUndefined()
  })
})

describe('with FIRESTORE_DATABASE_ID unset', () => {
  it('fbAdmin.firestore() sends an undefined databaseId to the SDK (its `(default)` fallback)', () => {
    expect(fbAdmin.firestore()).toBe(mockFirestore)
    expect(mockGetFirestore).toHaveBeenCalledTimes(1)
    expect(mockGetFirestore).toHaveBeenCalledWith(mockApp, undefined)
  })

  it('firebaseAdmin.firestore() sends an undefined databaseId', () => {
    expect(firebaseAdmin.firestore()).toBe(mockFirestore)
    expect(mockGetFirestore).toHaveBeenCalledWith(mockApp, undefined)
  })

  it('firebaseAdmin.app().firestore() sends an undefined databaseId', () => {
    expect(firebaseAdmin.app().firestore()).toBe(mockFirestore)
    expect(mockGetFirestore).toHaveBeenCalledWith(mockApp, undefined)
  })
})

describe('with FIRESTORE_DATABASE_ID set', () => {
  const DB = 'restore-rehearsal-2026-08-13'

  beforeEach(() => {
    process.env.FIRESTORE_DATABASE_ID = DB
  })

  it('fbAdmin.firestore() sends the named database to the SDK', () => {
    fbAdmin.firestore()
    expect(mockGetFirestore).toHaveBeenCalledWith(mockApp, DB)
  })

  it('firebaseAdmin.firestore() sends the named database', () => {
    firebaseAdmin.firestore()
    expect(mockGetFirestore).toHaveBeenCalledWith(mockApp, DB)
  })

  it('firebaseAdmin.app().firestore() sends the named database', () => {
    firebaseAdmin.app().firestore()
    expect(mockGetFirestore).toHaveBeenCalledWith(mockApp, DB)
  })

  it('an explicit app argument still threads the override', () => {
    const other = { name: 'named-app' }
    fbAdmin.firestore(other as never)
    expect(mockGetFirestore).toHaveBeenCalledWith(other, DB)
  })

  it('the value is read per call, not captured at module load', () => {
    fbAdmin.firestore()
    delete process.env.FIRESTORE_DATABASE_ID
    fbAdmin.firestore()
    expect(mockGetFirestore).toHaveBeenNthCalledWith(1, mockApp, DB)
    expect(mockGetFirestore).toHaveBeenNthCalledWith(2, mockApp, undefined)
  })
})
