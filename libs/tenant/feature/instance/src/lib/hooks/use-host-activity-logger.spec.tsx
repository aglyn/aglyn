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
 * The activity append's failure doors (AGL-118, AGL-3734).
 *
 * On 2026-10-09 the beacon paged twice with `host-activity-write: Document
 * already exists: …/hosts/{hostId}/activity/{id}` (beta.234, on the media
 * page and a screen version view). `addDoc` is a create under an id the SDK
 * mints once per call, so the only way it meets an existing document is the
 * SDK replaying a write whose commit landed and whose answer did not (a flaky
 * connection, a tab waking from sleep). The entry IS in the log. That is
 * success, and it must stay silent, while a real refusal is still reported.
 */

import { renderHook } from '@testing-library/react'
import { useHostActivityLogger } from './use-host-activity-logger'

const mockAddDoc = jest.fn()
jest.mock('firebase/firestore', () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
}))

const mockReportHandledError = jest.fn()
jest.mock('@aglyn/aglyn/app-utils/error-beacon', () => ({
  reportHandledError: (...args: unknown[]) => mockReportHandledError(...args),
}))

jest.mock('./firebase/firebase-services', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'user-1', email: 'editor@example.com' } }),
}))

/** A FirestoreError's shape: the SDK's code plus its message. */
function firestoreError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, name: 'FirebaseError' })
}

/** Lets the floated `.catch` run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useHostActivityLogger failure doors', () => {
  let consoleError: jest.SpyInstance

  beforeEach(() => {
    mockAddDoc.mockReset()
    mockReportHandledError.mockReset()
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  /**
   * The console line is once per SESSION (module state), so only the last
   * test below may be the first to fail an append for real.
   */
  function logger() {
    return renderHook(() => useHostActivityLogger('host-1')).result.current
  }

  it('writes one entry per call under the host', async () => {
    mockAddDoc.mockResolvedValue({ id: 'entry-1' })
    logger()('Uploaded media', { type: 'media', id: 'm-1' })
    await settle()
    expect(mockAddDoc).toHaveBeenCalledTimes(1)
    expect(mockAddDoc.mock.calls[0][0]).toEqual({ path: 'hosts/host-1/activity' })
    expect(mockAddDoc.mock.calls[0][1]).toMatchObject({
      actorId: 'user-1',
      action: 'Uploaded media',
      target: { type: 'media', id: 'm-1' },
    })
  })

  it('treats ALREADY_EXISTS on a replayed create as the success it is', async () => {
    mockAddDoc.mockRejectedValue(
      firestoreError(
        'already-exists',
        'Document already exists: projects/p/databases/(default)/documents/hosts/host-1/activity/RWAAeraR9rQKlkkA4GZX',
      ),
    )
    logger()('Uploaded media', { type: 'media' })
    await settle()
    expect(mockReportHandledError).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('still reports a real refusal, to the beacon every time and the console once', async () => {
    const denied = firestoreError('permission-denied', 'Missing or insufficient permissions.')
    mockAddDoc.mockRejectedValue(denied)
    const log = logger()
    log('Saved page', { type: 'screen' })
    log('Saved page', { type: 'screen' })
    await settle()
    expect(mockReportHandledError).toHaveBeenCalledTimes(2)
    expect(mockReportHandledError).toHaveBeenCalledWith(denied, {
      kind: 'host-activity-write',
    })
    expect(consoleError).toHaveBeenCalledTimes(1)
  })
})
