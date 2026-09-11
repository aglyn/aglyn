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
 * What the App Router adapter hands back, and WHEN (AGL-2810).
 *
 * The claims here are about timing, so every streamed case drives a source
 * the test releases by hand: a chunk exists only once the test pushes it. A
 * `Response` observed while the source still holds bytes back is therefore
 * proof the adapter did not wait for the body, which is the property a
 * collecting implementation cannot fake.
 *
 * The complete-body cases pin the other half: a handler that answers with
 * `json`, `send`, `redirect` or a bare `end()` gets the same buffered
 * `Response` it always did, and a throw before it answers still rejects.
 */

import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { runLegacyHandler } from './api-adapter'

const request = (init?: RequestInit) =>
  new Request('https://site.test/api/thing', init)

/** A source that produces nothing until the test pushes it. */
const heldSource = () => new Readable({ read: () => undefined })

function readerOf(response: Response): ReadableStreamDefaultReader<Uint8Array> {
  if (!response.body) throw new Error('response has no body')
  return response.body.getReader()
}

const text = (bytes: Uint8Array | undefined) => Buffer.from(bytes ?? []).toString()

async function readRest(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const parts: Buffer[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return Buffer.concat(parts).toString()
    parts.push(Buffer.from(value))
  }
}

/** Lets queued stream work run, up to a bound, until `holds` is true. */
async function eventually(holds: () => boolean): Promise<void> {
  for (let turn = 0; turn < 500 && !holds(); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  if (!holds()) throw new Error('condition never held')
}

describe('AGL-2810 · a streamed body is handed back at its first chunk', () => {
  it('answers with the status and headers while the source is still producing', async () => {
    const source = heldSource()
    const state = { handlerDone: false }
    source.push(Buffer.from('first-'))
    const response = await runLegacyHandler(async (_req, res) => {
      res.setHeader('Content-Type', 'video/mp4')
      res.status(206)
      await pipeline(source, res)
      state.handlerDone = true
    }, request())

    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    const reader = readerOf(response)
    expect(text((await reader.read()).value)).toBe('first-')
    // The client holds bytes while the rest of the file does not exist yet.
    expect(state.handlerDone).toBe(false)

    source.push(Buffer.from('rest'))
    source.push(null)
    expect(await readRest(reader)).toBe('rest')
    await eventually(() => state.handlerDone)
  })

  it('reads from the source no faster than the client takes the bytes', async () => {
    const chunk = Buffer.alloc(64 * 1024, 7)
    const total = 200
    const produced = { chunks: 0 }
    const source = new Readable({
      read() {
        if (produced.chunks === total) {
          this.push(null)
          return
        }
        produced.chunks += 1
        this.push(chunk)
      },
    })
    const response = await runLegacyHandler(async (_req, res) => {
      await pipeline(source, res)
    }, request())

    // Give a collecting adapter every opportunity to drain the whole source.
    for (let turn = 0; turn < 100; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    // 200 chunks is 12.8 MB. An adapter that waits for the client holds a few.
    expect(produced.chunks).toBeLessThan(8)

    const reader = readerOf(response)
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
    }
    expect(bytes).toBe(total * chunk.length)
    expect(produced.chunks).toBe(total)
  })

  it('fails the body when the source fails after the first chunk, rather than ending it short', async () => {
    const source = heldSource()
    source.push(Buffer.from('partial'))
    const response = await runLegacyHandler(async (_req, res) => {
      try {
        await pipeline(source, res)
      } catch {
        // `pipeline` has already failed the response with the read's error.
      }
    }, request())

    const reader = readerOf(response)
    expect(text((await reader.read()).value)).toBe('partial')
    source.destroy(new Error('storage connection reset'))
    await expect(reader.read()).rejects.toThrow('storage connection reset')
  })

  it('fails the body when the handler throws after it started streaming', async () => {
    const gate: { open: () => void } = { open: () => undefined }
    const opened = new Promise<void>((resolve) => {
      gate.open = resolve
    })
    const response = await runLegacyHandler(async (_req, res) => {
      res.write('a')
      await opened
      throw new Error('late failure')
    }, request())

    const reader = readerOf(response)
    expect(text((await reader.read()).value)).toBe('a')
    gate.open()
    await expect(reader.read()).rejects.toThrow('late failure')
  })

  it('stops reading the source when the client cancels the body', async () => {
    const source = heldSource()
    source.push(Buffer.from('first-'))
    const outcome: { error?: unknown } = {}
    const response = await runLegacyHandler(async (_req, res) => {
      try {
        await pipeline(source, res)
      } catch (error) {
        outcome.error = error
      }
    }, request())

    const reader = readerOf(response)
    await reader.read()
    await reader.cancel()

    await eventually(() => source.destroyed && outcome.error !== undefined)
    expect((outcome.error as { code?: string }).code).toBe(
      'ERR_STREAM_PREMATURE_CLOSE',
    )
  })
})

describe('AGL-2810 · a complete body is still one buffered response', () => {
  it('json keeps its status, its type and its body', async () => {
    const response = await runLegacyHandler((_req, res) => {
      res.status(201).json({ ok: true })
    }, request({ method: 'POST', body: '{}' }))
    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(await response.json()).toEqual({ ok: true })
  })

  it.each([
    ['a string', 'hello', 'hello'],
    ['a buffer', Buffer.from('bytes'), 'bytes'],
  ])('send with %s answers the whole body', async (_label, body, expected) => {
    const response = await runLegacyHandler((_req, res) => {
      res.send(body)
    }, request())
    expect(await response.text()).toBe(expected)
  })

  it('redirect carries its status and location and no body', async () => {
    const response = await runLegacyHandler((_req, res) => {
      res.redirect(307, '/next')
    }, request())
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('/next')
    expect(response.body).toBeNull()
  })

  it.each([204, 304])('a bare end() with %p answers no body', async (status) => {
    const response = await runLegacyHandler((_req, res) => {
      res.status(status).end()
    }, request())
    expect(response.status).toBe(status)
    expect(response.body).toBeNull()
  })

  it('a headers-only answer keeps its headers, as a HEAD does', async () => {
    const response = await runLegacyHandler((_req, res) => {
      res.setHeader('Content-Length', '8')
      res.status(200).end()
    }, request({ method: 'HEAD' }))
    expect(response.body).toBeNull()
    expect(response.headers.get('content-length')).toBe('8')
  })

  it('an answer after an awaited step waits for the handler', async () => {
    const response = await runLegacyHandler(async (_req, res) => {
      await new Promise((resolve) => setImmediate(resolve))
      res.status(202).json({ queued: true })
    }, request())
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ queued: true })
  })

  it('a handler that throws before answering rejects', async () => {
    await expect(
      runLegacyHandler(async () => {
        throw new Error('boom')
      }, request()),
    ).rejects.toThrow('boom')
  })
})
