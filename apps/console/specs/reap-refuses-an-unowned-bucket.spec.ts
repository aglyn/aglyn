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
 * THE REAPER DELETES NOTHING WHEN NOBODY CLAIMS ANYTHING (AGL-3080).
 *
 * ⛔ THE ONE CASE THAT CANNOT BE ALLOWED TO REGRESS. This job deletes exactly
 * the objects nothing claims, permanently, from a bucket with no object
 * versioning — so "no claims" arriving because nothing answered is
 * indistinguishable, at the deletion, from a bucket where every object is
 * genuinely orphaned. Before AGL-3080 the claim walk was inline and could not
 * be absent; now it is a registration, and this is what stands in its place.
 *
 * Deliberately run against the REAL contract with nothing registered — not a
 * mocked refusal — because the state being tested is a process that booted
 * without the owning plugin, and a mock of the refusal would prove only that
 * the route reads a field.
 *
 * The bucket answers with objects, all of them old enough to reap and none
 * of them claimed. Every one would go if the route drew a conclusion from
 * the empty answer, which is what makes the deletion count the assertion.
 */

export {}

const mockDeleted: string[] = []
const mockAuditAdd = jest.fn(async () => undefined)

/*
 * Two objects a run would reap: canonical paths, well past the min age.
 *
 * `mock`-prefixed because a `jest.mock` factory may not close over an
 * ordinary out-of-scope name — the repo's own lint rule names this fix, and
 * it is the same hoisting rule the AGL-2282 note describes.
 */
const mockOldDate = new Date('2020-01-01T00:00:00.000Z')
const mockObjects = [
  `artifacts/listing-1/1.0.0/${'a'.repeat(64)}.bundle`,
  `artifacts/listing-2/2.1.0/${'b'.repeat(64)}.bundle`,
]

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({ add: mockAuditAdd, doc: (id: string) => ({ id }) }),
      }),
      storage: () => ({
        bucket: () => ({
          getFiles: async () => [
            mockObjects.map((name) => ({
              name,
              metadata: {
                timeCreated: mockOldDate.toISOString(),
                size: '1024',
              },
            })),
          ],
          file: (name: string) => ({
            delete: async () => {
              mockDeleted.push(name)
            },
          }),
        }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => '__now__' } },
  },
}))

// The loader would load the owning plugin, and an app spec may not import
// one (AGL-2282). A process that booted without it is exactly the state
// under test, so the no-op is the honest double here.
jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { hasPluginArtifactInventory } from '@aglyn/aglyn/plugin-manager/plugin-artifact-inventory'

const ORIGINAL_ENV = process.env

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    CRON_SECRET: 'cron-fake',
    PLUGIN_ARTIFACTS_BUCKET: 'artifacts-bucket',
  } as NodeJS.ProcessEnv
  mockDeleted.length = 0
  mockAuditAdd.mockClear()
  resetPluginServicesForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  process.env = ORIGINAL_ENV
})

describe('the artifact reaper on a bucket nothing owns', () => {
  it('CONTROL: nothing is registered, and the objects are reapable', () => {
    // Both halves, because either one silently untrue would make the case
    // below pass for the wrong reason: a registry some other suite filled,
    // or a bucket with nothing in it to delete.
    expect(hasPluginArtifactInventory()).toBe(false)
    expect(mockObjects).toHaveLength(2)
  })

  it('refuses the run and deletes nothing', async () => {
    const { POST } = await import(
      '../app/api/admin/reap-plugin-artifacts/route'
    )
    const response = await POST(
      new Request('https://app.aglyn.com/api/admin/reap-plugin-artifacts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cron-secret': 'cron-fake',
        },
        body: JSON.stringify({ dryRun: false }),
      }),
    )
    const payload = await response.json()

    // 507, not 200-with-zero-orphans: a run that could not read the claims
    // has not found the bucket clean, and the report has to say so.
    expect(response.status).toBe(507)
    expect(payload.error).toContain('No plugin owns')
    expect(mockDeleted).toEqual([])
    // And no audit row either — nothing happened to record.
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })
})
