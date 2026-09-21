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
 * A door that meets somebody never quietly records nobody (AGL-3080).
 *
 * `capturePluginContact` answers `null` for a workspace that keeps no
 * records, and that is a correct, quiet answer. It is ALSO what a process
 * whose boot-time registration failed looks like, and from a capture door the
 * two are indistinguishable. `instrumentation.ts` catches that failure and
 * logs one line, so the symptom in production is not an error: it is every
 * form submission on every site in that process recording no contact, for as
 * long as the instance lives.
 *
 * So `recordCapturedContact` does not accept `null` on trust. These are the
 * three behaviours that depend on:
 *
 *  - a writer already registered is reached with NO await in between, because
 *    every caller is fire-and-forget and an await before the writer hands the
 *    capture to a request that may already have returned;
 *  - no writer means run the boot step and ask again, which repairs the
 *    broken-boot case rather than reporting it;
 *  - a writer that throws costs the door nothing, because the door has
 *    already accepted the submission it is recording.
 */

export {}

const ORDER: string[] = []
let mockCaptures: unknown[] = []
let mockWriter: { capture: (request: unknown) => Promise<unknown> } | null = null
let mockBooted = 0
/** Whether the boot step finds a writer to register — false is a workspace
 * that keeps no records, which is the same silence as a boot that failed. */
let mockBootRegisters = true

jest.mock('@aglyn/aglyn/plugin-manager/plugin-contact-capture', () => ({
  __esModule: true,
  pluginContactCaptureWriter: () => (mockWriter ? { pluginId: 'crm', writer: mockWriter } : null),
}))

jest.mock(
  '../utils/plugins.declarations.server.generated',
  () => ({
    __esModule: true,
    registerPluginServerDeclarations: async () => {
      mockBooted += 1
      ORDER.push('boot')
      if (!mockBootRegisters) return
      mockWriter = {
        capture: async (request: unknown) => {
          mockCaptures.push(request)
          return { ok: true, contactId: 'c1', created: true }
        },
      }
    },
  }),
  { virtual: true },
)

const REQUEST = {
  orgId: 'org-1',
  hostId: 'host-1',
  identity: { email: 'a@b.test' },
  interaction: { source: 'form' },
}

beforeEach(() => {
  ORDER.length = 0
  mockCaptures = []
  mockWriter = null
  mockBooted = 0
  mockBootRegisters = true
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a capture reaches a writer', () => {
  it('hands a registered writer the capture with nothing awaited first', async () => {
    mockWriter = {
      capture: async (request: unknown) => {
        mockCaptures.push(request)
        ORDER.push('capture')
        return { ok: true, contactId: 'c1', created: true }
      },
    }
    const { recordCapturedContact } = await import('../utils/record-captured-contact')

    // Not awaited: the door calls this fire-and-forget, so what matters is
    // that the writer has the capture by the time the caller's own turn ends.
    // A `void` call that only reached the writer a microtask later would be
    // racing the response on a serverless runtime.
    void recordCapturedContact(REQUEST)
    expect(mockCaptures).toEqual([REQUEST])
    expect(mockBooted).toBe(0)
  })

  it('runs the boot step and asks again when nobody answers', async () => {
    const { recordCapturedContact } = await import('../utils/record-captured-contact')

    const verdict = await recordCapturedContact(REQUEST)

    expect(ORDER).toEqual(['boot'])
    expect(mockBooted).toBe(1)
    expect(mockCaptures).toEqual([REQUEST])
    expect(verdict).toEqual({ ok: true, contactId: 'c1', created: true })
    // Said out loud: a process that had to register its own writer booted
    // wrong, and every capture before this one went nowhere.
    expect(console.warn).toHaveBeenCalled()
  })

  it('says so, once, when no plugin keeps people even after booting', async () => {
    mockBootRegisters = false
    const { recordCapturedContact } = await import('../utils/record-captured-contact')

    expect(await recordCapturedContact(REQUEST)).toBeNull()
    expect(mockCaptures).toEqual([])
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('no plugin keeps people'),
    )
  })

  it('costs the door nothing when the writer throws', async () => {
    mockWriter = {
      capture: async () => {
        throw new Error('firestore is unhappy')
      },
    }
    const { recordCapturedContact } = await import('../utils/record-captured-contact')

    // Returned, not thrown. The submission was already accepted; losing it
    // over a contact that could not be filed is the larger failure, and the
    // contract says a writer returns its refusals rather than throwing them.
    await expect(recordCapturedContact(REQUEST)).resolves.toBeNull()
    expect(console.error).toHaveBeenCalled()
  })
})
