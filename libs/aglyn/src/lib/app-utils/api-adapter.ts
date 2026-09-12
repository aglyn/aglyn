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

import { Writable } from 'node:stream'
import type { PluginApiRequest, PluginApiResponse } from './api-plugins'
import { readClientIp } from './request-ip'

/**
 * A node-style API handler runnable through {@link runLegacyHandler}. Both
 * the framework-light `PluginApiHandler` and the shared handlers typed with
 * `NextApiRequest`/`NextApiResponse` (serveMediaCdn/servePluginFetch) satisfy
 * it — their parameter types differ (contravariance), so the boundary is
 * intentionally loose. The runtime shapes we pass (below) cover what each
 * handler actually touches.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LegacyApiHandler = (req: any, res: any) => unknown

/**
 * App Router ↔ node-style handler adapter (AGL-407). The plugin API contract
 * (`PluginApiHandler`) and a few shared handlers (`serveMediaCdn`,
 * `servePluginFetch`) are deliberately framework-light `(req, res)` functions
 * — that structural shape is what keeps plugins decoupled from any Next
 * router. This module lets an App Router `route.ts` invoke them from a Web
 * `Request`, so the tenant's API surface moves to the App Router with **zero
 * changes to plugin handlers** (they still run unchanged on the console's
 * Pages Router too). The response collector is a real `Writable`, so a
 * handler that pipes a read stream into `res` streams its body to the client
 * rather than handing it over whole — see {@link PluginResponseCollector}.
 */

/**
 * The address a node-style handler reads as `req.socket.remoteAddress`.
 *
 * There is no real socket behind an App Router `Request`, so this stands in
 * for one — which makes it a client-address reader wearing a socket's name,
 * and every plugin handler that falls back to `req.socket?.remoteAddress`
 * inherits whatever it decides. It goes through the shared reader for exactly
 * that reason: the fallback has to be the same trusted hop as the header
 * reading it falls back FROM, or a handler could be steered onto a
 * caller-supplied value by omitting a header.
 *
 * `undefined` rather than a placeholder when nothing is readable — node leaves
 * `remoteAddress` undefined on a destroyed socket, so handlers already have to
 * cope with its absence.
 */
function clientIp(headers: Headers): string | undefined {
  return readClientIp(headers) ?? undefined
}

/** Parse a `Cookie` header into a flat record. */
function parseCookies(headers: Headers): Record<string, string> {
  const raw = headers.get('cookie')
  if (!raw) return {}
  const out: Record<string, string> = {}
  for (const pair of raw.split(';')) {
    const index = pair.indexOf('=')
    if (index < 0) continue
    const key = pair.slice(0, index).trim()
    if (key) out[key] = decodeURIComponent(pair.slice(index + 1).trim())
  }
  return out
}

/**
 * Builds a `PluginApiRequest` from a Web `Request` plus the App Router route
 * `params` (awaited by the caller). Body parsing mirrors Next's default
 * body parser: JSON for `application/json`, form fields for urlencoded,
 * raw text otherwise; GET/HEAD carry no body.
 */
export async function pluginRequestFromWeb(
  request: Request,
  params: Record<string, string | string[]> = {},
): Promise<PluginApiRequest> {
  const url = new URL(request.url)
  const query: Record<string, string | string[]> = { ...params }
  for (const key of url.searchParams.keys()) {
    if (key in query) continue
    const all = url.searchParams.getAll(key)
    query[key] = all.length > 1 ? all : (all[0] ?? '')
  }

  const method = request.method ?? 'GET'
  let body: unknown
  let rawBody: string | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const raw = await request.text()
    rawBody = raw || undefined
    if (raw) {
      const contentType = request.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        try {
          body = JSON.parse(raw)
        } catch {
          body = raw
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        body = Object.fromEntries(new URLSearchParams(raw))
      } else {
        body = raw
      }
    }
  }

  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  return {
    method,
    query,
    body,
    rawBody,
    headers,
    cookies: parseCookies(request.headers),
    socket: { remoteAddress: clientIp(request.headers) },
  }
}

type WriteCallback = (error?: Error | null) => void

/** A promise and the function that settles it. */
function signal(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** Statuses a `Response` may not carry a body on (Fetch §2.2.4). */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

/**
 * A `PluginApiResponse` that turns a node-style handler's output into a Web
 * `Response`, in one of two shapes.
 *
 * - **A complete body** — `json`, `send`, `redirect`, or `end()` with nothing
 *   written. It is kept whole and becomes a buffered `Response` once the
 *   handler returns, which is the shape every plugin handler relies on.
 * - **A streamed body** — anything written through the `Writable` side:
 *   `write()`, `stream.pipe(res)`, `pipeline(source, res)`. The `Response` is
 *   handed back at the FIRST chunk, carrying the status and headers set by
 *   then, and its body is a `ReadableStream` the client pulls one chunk at a
 *   time (AGL-2810).
 *
 * ## Why a streamed body is never collected
 *
 * The media CDN pipes whole Storage objects into `res`. Collected, each
 * request held its entire file in function memory — briefly twice, while the
 * chunks were concatenated — and sent nothing until the last byte had been
 * read, so a player's opening `bytes=0-` on a large video pulled the whole
 * file before playback could start.
 *
 * ## Backpressure
 *
 * The body stream holds one chunk. A write is acknowledged only when the
 * client has taken the chunk before it, so `pipe`/`pipeline` pause the source
 * while the client is slow and a response never holds more than a few chunks
 * in memory, whatever the size of the file behind it.
 *
 * ## Failure after the first chunk
 *
 * Once the status line is gone the only honest signal left is to fail the
 * body. `destroy(error)` errors the stream, so the client sees a broken
 * transfer. Closing it instead would present a truncated file as complete —
 * which, for a video player, is a corrupt file it has no reason to doubt.
 *
 * ## A client that stops reading
 *
 * Canceling the body destroys this writer, and `pipeline` answers a
 * destination that closed early by destroying its source. An abandoned
 * response therefore stops reading from Storage instead of leaving the read
 * open behind a client that has gone.
 */
class PluginResponseCollector extends Writable implements PluginApiResponse {
  private statusCode = 200
  private readonly outHeaders: Record<string, string | number | readonly string[]> =
    {}
  /** What `json`/`send` produced, when nothing was streamed. */
  private completeBody: Buffer | null = null
  private body: ReadableStream<Uint8Array> | null = null
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null
  /** The acknowledgement for the chunk the client has not taken yet. */
  private awaitingPull: WriteCallback | null = null
  /** Set by `_final`: the body ended, so a later teardown is not a failure. */
  private bodyEnded = false
  private readonly ended = signal()
  private readonly firstChunk = signal()
  headersSent = false

  constructor() {
    super()
    this.once('finish', this.ended.resolve)
    // `close` as well as `finish`: a writer destroyed before it wrote or
    // ended must still let `toResponse` return rather than wait forever.
    this.once('close', this.ended.resolve)
    // A streamed failure reaches the client through the body (`_destroy`).
    // Without a listener, `destroy(error)` would also emit an `error` event
    // nothing handles, and an unhandled `error` takes the process down.
    this.on('error', () => undefined)
  }

  /** True once a chunk has been written, so the `Response` is committed. */
  get streaming(): boolean {
    return this.body !== null
  }

  /** Settles at the first streamed chunk. */
  get firstChunkWritten(): Promise<void> {
    return this.firstChunk.promise
  }

  override _write(
    chunk: unknown,
    encoding: BufferEncoding,
    callback: WriteCallback,
  ): void {
    this.headersSent = true
    const controller = this.controller ?? this.openBody()
    try {
      controller.enqueue(
        chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk), encoding),
      )
    } catch (error) {
      // The client already canceled or the body already failed: the write
      // fails the way a write to a closed socket does.
      callback(error instanceof Error ? error : new Error(String(error)))
      return
    }
    if ((controller.desiredSize ?? 0) > 0) callback()
    else this.awaitingPull = callback
  }

  override _final(callback: WriteCallback): void {
    this.bodyEnded = true
    try {
      this.controller?.close()
    } catch {
      // Canceled by the client; nothing is waiting for the end.
    }
    callback()
  }

  override _destroy(error: Error | null, callback: WriteCallback): void {
    this.awaitingPull = null
    if (this.controller && !this.bodyEnded) {
      try {
        this.controller.error(
          error ?? new Error('Response body closed before it ended'),
        )
      } catch {
        // Already closed or errored.
      }
    }
    callback(error)
  }

  /** Commits the response: the status and headers set so far are final. */
  private openBody(): ReadableStreamDefaultController<Uint8Array> {
    const started: { controller?: ReadableStreamDefaultController<Uint8Array> } =
      {}
    this.body = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          started.controller = controller
        },
        pull: () => {
          const acknowledge = this.awaitingPull
          this.awaitingPull = null
          acknowledge?.()
        },
        cancel: () => {
          this.awaitingPull = null
          this.destroy()
        },
      },
      { highWaterMark: 1 },
    )
    // `start` runs synchronously inside the constructor (Streams §4.2.4).
    if (!started.controller) {
      throw new Error('ReadableStream did not start synchronously')
    }
    this.controller = started.controller
    this.firstChunk.resolve()
    return started.controller
  }

  status(code: number): this {
    this.statusCode = code
    return this
  }

  setHeader(name: string, value: string | number | readonly string[]): void {
    this.outHeaders[name.toLowerCase()] = value
  }

  removeHeader(name: string): void {
    delete this.outHeaders[name.toLowerCase()]
  }

  json(body: unknown): void {
    if (this.outHeaders['content-type'] === undefined) {
      this.setHeader('content-type', 'application/json; charset=utf-8')
    }
    this.endWith(Buffer.from(JSON.stringify(body)))
  }

  send(body: unknown): void {
    if (body === undefined || body === null) return void this.end()
    if (Buffer.isBuffer(body)) return void this.endWith(body)
    if (typeof body === 'string') return void this.endWith(Buffer.from(body))
    return this.json(body)
  }

  redirect(statusOrUrl: number | string, maybeUrl?: string): void {
    const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302
    const location = typeof statusOrUrl === 'number' ? (maybeUrl ?? '') : statusOrUrl
    this.statusCode = status
    this.setHeader('location', location)
    this.end()
  }

  /**
   * Ends the response with a complete body. After a streamed chunk the body
   * is already a stream, so the bytes can only join it.
   */
  private endWith(body: Buffer): void {
    if (this.body) {
      this.end(body)
      return
    }
    this.completeBody = body
    this.end()
  }

  /**
   * The Web `Response`, as soon as it is decided: at the first streamed chunk,
   * or once the handler has ended the response with a complete body.
   */
  async toResponse(): Promise<Response> {
    await Promise.race([this.ended.promise, this.firstChunk.promise])
    const headers = new Headers()
    for (const [key, value] of Object.entries(this.outHeaders)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, String(item))
      } else {
        headers.set(key, String(value))
      }
    }
    const bodyless = NULL_BODY_STATUSES.has(this.statusCode)
    if (this.body) {
      if (bodyless) {
        void this.body.cancel()
        return new Response(null, { status: this.statusCode, headers })
      }
      return new Response(this.body, { status: this.statusCode, headers })
    }
    const body = this.completeBody
    return new Response(
      bodyless || !body || body.length === 0 ? null : (body as BodyInit),
      { status: this.statusCode, headers },
    )
  }
}

/**
 * Runs a node-style `(req, res)` handler against a Web `Request` and returns
 * the Web `Response` it produced. The entry point for App Router `route.ts`
 * files that dispatch to plugin handlers or the shared `serveMediaCdn` /
 * `servePluginFetch` handlers. Runs on the Node.js runtime (streams,
 * firebase-admin) — not edge.
 *
 * A handler that responds with a complete body is awaited to the end, and a
 * throw before it responds rejects exactly as it always has. A handler that
 * streams gets its `Response` back at the first chunk while it keeps writing;
 * if it fails after that, the body fails with it (see
 * {@link PluginResponseCollector}).
 */
export async function runLegacyHandler(
  handler: LegacyApiHandler,
  request: Request,
  params: Record<string, string | string[]> = {},
): Promise<Response> {
  const req = await pluginRequestFromWeb(request, params)
  const res = new PluginResponseCollector()
  const failure: { error?: unknown; failed: boolean } = { failed: false }
  const handled = (async (): Promise<void> => {
    try {
      await handler(req, res)
    } catch (error) {
      if (res.streaming) {
        // The status line is already out, so only the body can carry this.
        res.destroy(error instanceof Error ? error : new Error(String(error)))
        return
      }
      failure.failed = true
      failure.error = error
    }
  })()
  await Promise.race([handled, res.firstChunkWritten])
  if (failure.failed) throw failure.error
  return res.toResponse()
}
