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
 * two are indistinguishable. Both apps' instrumentation catches that failure
 * and logs one line, so the symptom in production is not an error: it is
 * every form submission, signup and booking on every site in that process
 * recording no contact, for as long as the instance lives.
 *
 * So `recordCapturedContact` does not accept `null` on trust. These are the
 * behaviours that depend on:
 *
 *  - a writer already registered is reached with NO await in between, because
 *    every caller is fire-and-forget and an await before the writer hands the
 *    capture to a request that may already have returned;
 *  - no writer means run the app's boot step and ask again, which repairs the
 *    broken-boot case rather than reporting it;
 *  - a writer that throws costs the door nothing, because the door has
 *    already accepted the thing it is recording.
 *
 * The registry here is the real one: what a door gets wrong is reaching the
 * writer, and a double of the lookup would prove only that the double was
 * called.
 */

import {
  registerPluginContactCaptureWriter,
  type PluginContactCaptureRequest,
} from './plugin-contact-capture'
import { resetPluginServicesForTests } from './plugin-services'
import {
  recordCapturedContact,
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from './record-captured-contact'

const ORDER: string[] = []
let captures: PluginContactCaptureRequest[] = []

const REQUEST: PluginContactCaptureRequest = {
  orgId: 'org-1',
  hostId: 'host-1',
  identity: { email: 'a@b.test' },
  interaction: { source: 'form' },
}

/** A record plugin that keeps everything it is handed. */
function keepsPeople(): void {
  registerPluginContactCaptureWriter(
    {
      capture: async (request) => {
        captures.push(request)
        ORDER.push('capture')
        return { ok: true, record: 'contact', contactId: 'c1', created: true }
      },
    },
    { pluginId: 'crm' },
  )
}

beforeEach(() => {
  resetPluginServicesForTests()
  resetPluginDeclarationsRepairForTests()
  ORDER.length = 0
  captures = []
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a capture reaches a writer', () => {
  it('hands a registered writer the capture with nothing awaited first', () => {
    keepsPeople()
    let booted = 0
    registerPluginDeclarationsRepair(async () => {
      booted += 1
    })

    // Not awaited: the door calls this fire-and-forget, so what matters is
    // that the writer has the capture by the time the caller's own turn ends.
    // A `void` call that only reached the writer a microtask later would be
    // racing the response on a serverless runtime.
    void recordCapturedContact(REQUEST)

    expect(captures).toEqual([REQUEST])
    expect(booted).toBe(0)
  })

  it("runs the app's boot step and asks again when nobody answers", async () => {
    let booted = 0
    registerPluginDeclarationsRepair(async () => {
      booted += 1
      ORDER.push('boot')
      keepsPeople()
    })

    const verdict = await recordCapturedContact(REQUEST)

    expect(ORDER).toEqual(['boot', 'capture'])
    expect(booted).toBe(1)
    expect(captures).toEqual([REQUEST])
    expect(verdict).toEqual({ ok: true, record: 'contact', contactId: 'c1', created: true })
    // Said out loud: a process that had to register its own writer booted
    // wrong, and every capture before this one went nowhere.
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('found no writer until it registered one itself'),
    )
  })

  it('says so when no plugin keeps people even after the boot step', async () => {
    registerPluginDeclarationsRepair(async () => {
      ORDER.push('boot')
    })

    expect(await recordCapturedContact(REQUEST)).toBeNull()
    expect(ORDER).toEqual(['boot'])
    expect(captures).toEqual([])
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('no plugin keeps people'),
    )
  })

  it('says the same thing when the app offered no boot step at all', async () => {
    // A process that never ran its instrumentation has bigger silences than
    // this one, and this is not the place to throw about it: the door has
    // already accepted what it was recording.
    expect(await recordCapturedContact(REQUEST)).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('no plugin keeps people'),
    )
  })

  it('records nobody, and never throws, when the boot step itself fails', async () => {
    registerPluginDeclarationsRepair(async () => {
      throw new Error('a declaration module would not load')
    })

    await expect(recordCapturedContact(REQUEST)).resolves.toBeNull()
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('plugin declarations failed'),
      expect.any(Error),
    )
  })

  it('returns a refusal and says which one', async () => {
    registerPluginContactCaptureWriter(
      {
        capture: async () => ({
          ok: false,
          reason: 'band',
          error: 'This workspace is at the number of contacts its plan holds.',
        }),
      },
      { pluginId: 'crm' },
    )

    const verdict = await recordCapturedContact(REQUEST)

    expect(verdict).toEqual({
      ok: false,
      reason: 'band',
      error: 'This workspace is at the number of contacts its plan holds.',
    })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('(band)'))
  })

  it('costs the door nothing when the writer throws', async () => {
    registerPluginContactCaptureWriter(
      {
        capture: async () => {
          throw new Error('firestore is unhappy')
        },
      },
      { pluginId: 'crm' },
    )

    // Returned, not thrown. The submission was already accepted; losing it
    // over a contact that could not be filed is the larger failure, and the
    // contract says a writer returns its refusals rather than throwing them.
    await expect(recordCapturedContact(REQUEST)).resolves.toBeNull()
    expect(console.error).toHaveBeenCalled()
  })
})
