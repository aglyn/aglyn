/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
 *
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
 * Boot warm-up wiring (AGL-1500).
 *
 * The value of `instrumentation.ts` is ORDERING, which output equality cannot
 * see: `preferRest` must be applied to the render path's Firestore instance
 * before that instance's first call, and the warm read must actually be
 * issued at register time. Re-ordering either — or dropping the runtime
 * guard, which would drag firebase-admin into the edge bundle — keeps every
 * page render green while silently handing the first visitor the
 * establishment cost back. These specs pin the wiring itself.
 */

const settingsCalls: unknown[] = []
const getCalls: number[] = []
let settingsThrows = false
let warmReadResult: Promise<unknown> = Promise.resolve({ size: 0 })

const firestoreInstance = {
  settings: (options: unknown) => {
    if (settingsThrows) throw new Error('Firestore has already been initialized')
    settingsCalls.push(options)
  },
  collection: () => ({
    select: () => ({
      limit: () => ({
        get: () => {
          getCalls.push(Date.now())
          return warmReadResult
        },
      }),
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => firestoreInstance }),
  },
}))

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

describe('instrumentation register (AGL-1500)', () => {
  const originalRuntime = process.env.NEXT_RUNTIME
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    settingsCalls.length = 0
    getCalls.length = 0
    settingsThrows = false
    warmReadResult = Promise.resolve({ size: 0 })
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    process.env.NEXT_RUNTIME = originalRuntime
    logSpy.mockRestore()
  })

  it('applies preferRest to the shared instance BEFORE issuing the warm read', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    const { register } = await import('../instrumentation')
    await register()
    await flushMicrotasks()

    // The transport choice is the point, and it only binds if it lands before
    // the instance's first call — which in this process is the warm read.
    expect(settingsCalls).toEqual([{ preferRest: true }])
    expect(getCalls).toHaveLength(1)

    const bootLines = logSpy.mock.calls
      .map(([line]) => line)
      .filter((line) => typeof line === 'string' && line.includes('AGL-1500:boot'))
    expect(bootLines).toHaveLength(1)
    expect(JSON.parse(bootLines[0] as string)).toMatchObject({ ok: true })
  })

  it('still fires the warm read when settings() throws (already-used instance)', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    settingsThrows = true
    const { register } = await import('../instrumentation')
    await register()
    await flushMicrotasks()

    // A dev-server reload re-runs register against a live process; forfeiting
    // the transport choice must not forfeit the warm-up too.
    expect(getCalls).toHaveLength(1)
  })

  it('contains a warm-read failure: register resolves and the line reports it', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    warmReadResult = Promise.reject(new Error('firestore unreachable'))
    const { register } = await import('../instrumentation')
    await expect(register()).resolves.toBeUndefined()
    await flushMicrotasks()

    // Fire-and-forget must mean CONTAINED: an unhandled rejection at boot
    // would take the instance down harder than the cost this file removes.
    const bootLines = logSpy.mock.calls
      .map(([line]) => line)
      .filter((line) => typeof line === 'string' && line.includes('AGL-1500:boot'))
    expect(bootLines).toHaveLength(1)
    expect(JSON.parse(bootLines[0] as string)).toMatchObject({
      ok: false,
      error: 'firestore unreachable',
    })
  })

  it('honors the kill switch: AGLYN_DISABLE_BOOT_WARMUP=1 leaves transport and reads untouched', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.AGLYN_DISABLE_BOOT_WARMUP = '1'
    try {
      const { register } = await import('../instrumentation')
      await register()
      await flushMicrotasks()

      // The switch exists so production can restore lazy gRPC establishment
      // without a revert deploy — it must disable BOTH moves, not just one.
      expect(settingsCalls).toHaveLength(0)
      expect(getCalls).toHaveLength(0)
    } finally {
      delete process.env.AGLYN_DISABLE_BOOT_WARMUP
    }
  })

  it('is a no-op on the edge runtime — firebase-admin must never reach that bundle', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    const { register } = await import('../instrumentation')
    await register()
    await flushMicrotasks()

    expect(settingsCalls).toHaveLength(0)
    expect(getCalls).toHaveLength(0)
  })
})
