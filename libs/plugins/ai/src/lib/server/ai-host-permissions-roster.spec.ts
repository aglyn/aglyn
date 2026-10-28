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
 * The AI keys of a collaborator's per-site verdict, copied onto their roster
 * row when the platform's generic toggle door writes them (AGL-4047): only
 * the two AI keys, and nothing for a row that is gone.
 */

const docs = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => {
        const ref = (path: string) => ({
          collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
          get: async () => ({ exists: docs.has(path) }),
          update: async (data: Record<string, unknown>) => {
            docs.set(path, { ...docs.get(path), ...data })
          },
        })
        return { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }) }
      },
    }),
  },
}))

import { recordAiPermissionsOnRoster } from './ai-host-permissions-roster'

describe('recordAiPermissionsOnRoster (AGL-4047)', () => {
  beforeEach(() => docs.clear())

  it('copies the two AI keys of the verdict onto the roster row', async () => {
    docs.set('hosts/h1/members/m1', { email: 'pat@example.com' })
    await recordAiPermissionsOnRoster('h1', 'm1', {
      'ai.use': true,
      'ai.generate': false,
      'other.key': true,
    })
    expect(docs.get('hosts/h1/members/m1')).toEqual({
      email: 'pat@example.com',
      aiPermissions: { 'ai.use': true, 'ai.generate': false },
    })
  })

  it('leaves a roster row that no longer exists alone', async () => {
    await recordAiPermissionsOnRoster('h1', 'gone', { 'ai.use': true, 'ai.generate': true })
    expect(docs.has('hosts/h1/members/gone')).toBe(false)
  })
})
