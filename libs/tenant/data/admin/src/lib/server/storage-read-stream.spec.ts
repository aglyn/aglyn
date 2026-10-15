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
 * A Storage read raises no leak warning, and its listeners do not accumulate
 * (AGL-3795).
 *
 * The warning came from the Storage client's own wiring (node-fetch,
 * teeny-request, retry-request), not from our code, so a mocked
 * `createReadStream` could not show it. The reads therefore run through the
 * real client that firebase-admin ships, pointed at a local HTTP server that
 * stands in for GCS through the emulator host variable.
 *
 * They run in a child `node`. teeny-request loads node-fetch with a dynamic
 * `import()`, which Jest's VM cannot run. The child imports the module under
 * test straight from its `.ts` source, using Node's type stripping, so what
 * it exercises is this file's real code.
 *
 * The control read goes through the bare `createReadStream` and must warn.
 * That is the proof that this setup reproduces the production warning. If a
 * library upgrade stops it warning, the control fails, which tells us the
 * budget can be dropped.
 */

import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  openStorageReadStream,
  STORAGE_READ_BODY_LISTENER_BUDGET,
  type StorageReadableFile,
} from './storage-read-stream'

const CHUNK = 16 * 1024

/** What the child reports. */
interface HarnessReport {
  /** Leak warnings from one bare `createReadStream` read. */
  control: string[]
  /** Leak warnings from one bare `download()`, the read a site icon used to make. */
  downloadControl: string[]
  /** Leak warnings from five reads through `openStorageReadStream`, two of them ranged. */
  streamed: string[]
  /** Peak listeners per event on the body: 2 chunks, 200 chunks, 1st and 10th read. */
  peaks: Record<'small' | 'large' | 'first' | 'tenth', Record<string, number>>
  /** Leak warnings and byte count from `readStorageObject`. */
  buffered: { warnings: string[]; length: number }
}

const HARNESS = String.raw`
import { once } from 'node:events'
import http from 'node:http'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'
const { openStorageReadStream, readStorageObject } = await import(process.env.MODULE_UNDER_TEST)

const CHUNK = ${CHUNK}
const server = http.createServer((req, res) => {
  const match = /chunks-(\d+)/.exec(req.url ?? '')
  const chunks = match ? Number(match[1]) : 1
  res.writeHead(200, { 'content-type': 'application/octet-stream' })
  let sent = 0
  const next = () => {
    if (sent++ >= chunks) return void res.end()
    res.write(Buffer.alloc(CHUNK, sent % 251))
    setImmediate(next)
  }
  next()
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
process.env.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:' + server.address().port
const app = initializeApp({ projectId: 'storage-read-stream-spec' }, 'spec')
const file = (name) => getStorage(app).bucket('spec-bucket').file(name)

const tick = () => new Promise((settle) => setImmediate(settle))
async function leakWarningsDuring(run) {
  const seen = []
  const onWarning = (warning) => {
    if (warning.name === 'MaxListenersExceededWarning') seen.push(warning.message)
  }
  process.on('warning', onWarning)
  try {
    await run()
    await tick()
    await tick()
  } finally {
    process.off('warning', onWarning)
  }
  return seen
}
const slowSink = () =>
  new Writable({ highWaterMark: 1, write: (_c, _e, callback) => void setImmediate(callback) })
async function peakBodyListeners(name) {
  const peak = {}
  const stream = openStorageReadStream(file(name), { validation: false })
  stream.once('response', (body) => {
    const record = () => {
      for (const event of body.eventNames()) {
        peak[String(event)] = Math.max(peak[String(event)] ?? 0, body.listenerCount(event))
      }
    }
    body.on('newListener', () => setImmediate(record))
    record()
  })
  await pipeline(stream, slowSink())
  return peak
}

const control = await leakWarningsDuring(() =>
  pipeline(file('chunks-4').createReadStream({ validation: false }), slowSink()),
)
const downloadControl = await leakWarningsDuring(() =>
  file('chunks-4').download({ validation: false }),
)
const streamed = await leakWarningsDuring(async () => {
  for (let read = 0; read < 5; read++) {
    await pipeline(
      openStorageReadStream(
        file('chunks-32'),
        read % 2 ? { start: 0, end: CHUNK * 8 - 1 } : { validation: false },
      ),
      slowSink(),
    )
  }
})
const small = await peakBodyListeners('chunks-2')
const large = await peakBodyListeners('chunks-200')
const first = await peakBodyListeners('chunks-8')
for (let read = 0; read < 8; read++) await peakBodyListeners('chunks-8')
const tenth = await peakBodyListeners('chunks-8')
let length = 0
const bufferedWarnings = await leakWarningsDuring(async () => {
  length = (await readStorageObject(file('chunks-6'), { validation: false })).length
})
await deleteApp(app)
server.close()
process.stdout.write(JSON.stringify({
  control,
  downloadControl,
  streamed,
  peaks: { small, large, first, tenth },
  buffered: { warnings: bufferedWarnings, length },
}))
`

let report: HarnessReport

beforeAll(async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--no-warnings=ExperimentalWarning', '--input-type=module', '-e', HARNESS],
    {
      // `firebase-admin` resolves from the repository's node_modules.
      cwd: path.resolve(__dirname, '../../../../../../..'),
      env: {
        ...process.env,
        MODULE_UNDER_TEST: path.join(__dirname, 'storage-read-stream.ts'),
      },
      timeout: 60_000,
    },
  )
  report = JSON.parse(stdout) as HarnessReport
}, 90_000)

describe('Storage reads (AGL-3795)', () => {
  it('control: the bare createReadStream trips the warning on one read', () => {
    expect(report.control.some((message) => message.includes('[PassThrough]'))).toBe(true)
  })

  it('control: a bare download() trips it too, since it is the same read underneath', () => {
    expect(report.downloadControl.some((message) => message.includes('[PassThrough]'))).toBe(
      true,
    )
  })

  it('a streamed read raises no leak warning, across reads and ranges', () => {
    expect(report.streamed).toEqual([])
  })

  it('keeps the body inside the budget, however many chunks it carries', () => {
    const { small, large } = report.peaks
    // A fixed fan-out, not a per-chunk one: 100 times the chunks, the same peak.
    expect(large['error']).toBe(small['error'])
    expect(large['close']).toBe(small['close'])
    for (const peak of [small, large]) {
      for (const count of Object.values(peak)) {
        expect(count).toBeLessThanOrEqual(STORAGE_READ_BODY_LISTENER_BUDGET)
      }
    }
  })

  it('keeps the same peak from the first read to the tenth', () => {
    expect(report.peaks.tenth).toEqual(report.peaks.first)
  })

  it('reads a whole object into one Buffer without a warning', () => {
    expect(report.buffered.warnings).toEqual([])
    expect(report.buffered.length).toBe(CHUNK * 6)
  })

  it('leaves a limit someone raised on purpose alone', () => {
    const listeners: Array<(body: unknown) => void> = []
    const body = new EventEmitter()
    body.setMaxListeners(50)
    const file: StorageReadableFile = {
      createReadStream: () =>
        ({
          once: (_event: string, listener: (body: unknown) => void) => {
            listeners.push(listener)
          },
        }) as unknown as NodeJS.ReadableStream,
    }
    openStorageReadStream(file)
    for (const listener of listeners) listener(body)
    expect(body.getMaxListeners()).toBe(50)
  })
})
