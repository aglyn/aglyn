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
 * Pages Router too). The response collector is a real `Writable` so the
 * streaming media handler's `stream.pipe(res)` works as-is.
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

/**
 * A `PluginApiResponse` that buffers the node-style handler's output and
 * finalizes to a Web `Response`. Extends `Writable` so a handler that pipes
 * a read stream into `res` (the media CDN) works unchanged; `status`/`json`/
 * `send`/`redirect` cover the buffered handlers and every plugin handler.
 */
class PluginResponseCollector extends Writable implements PluginApiResponse {
  private statusCode = 200
  private readonly outHeaders: Record<string, string | number | readonly string[]> =
    {}
  private readonly chunks: Buffer[] = []
  private readonly finished: Promise<void>
  headersSent = false

  constructor() {
    super()
    this.finished = new Promise<void>((resolve) => this.once('finish', resolve))
  }

  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.headersSent = true
    this.chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array),
    )
    callback()
  }

  status(code: number): this {
    this.statusCode = code
    return this
  }

  setHeader(name: string, value: string | number | readonly string[]): void {
    this.outHeaders[name.toLowerCase()] = value
  }

  json(body: unknown): void {
    if (this.outHeaders['content-type'] === undefined) {
      this.setHeader('content-type', 'application/json; charset=utf-8')
    }
    this.end(Buffer.from(JSON.stringify(body)))
  }

  send(body: unknown): void {
    if (body === undefined || body === null) return void this.end()
    if (Buffer.isBuffer(body)) return void this.end(body)
    if (typeof body === 'string') return void this.end(Buffer.from(body))
    return this.json(body)
  }

  redirect(statusOrUrl: number | string, maybeUrl?: string): void {
    const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302
    const location = typeof statusOrUrl === 'number' ? (maybeUrl ?? '') : statusOrUrl
    this.statusCode = status
    this.setHeader('location', location)
    this.end()
  }

  /** Awaits the stream `finish` (fired by `end()` / a completed `pipe`). */
  async toResponse(): Promise<Response> {
    await this.finished
    const body = this.chunks.length ? Buffer.concat(this.chunks) : null
    const headers = new Headers()
    for (const [key, value] of Object.entries(this.outHeaders)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, String(item))
      } else {
        headers.set(key, String(value))
      }
    }
    const bodyless =
      this.statusCode === 204 || this.statusCode === 304 || body?.length === 0
    return new Response(bodyless ? null : (body as BodyInit | null), {
      status: this.statusCode,
      headers,
    })
  }
}

/**
 * Runs a node-style `(req, res)` handler against a Web `Request` and returns
 * the Web `Response` it produced. The entry point for App Router `route.ts`
 * files that dispatch to plugin handlers or the shared `serveMediaCdn` /
 * `servePluginFetch` handlers. Runs on the Node.js runtime (streams,
 * firebase-admin) — not edge.
 */
export async function runLegacyHandler(
  handler: LegacyApiHandler,
  request: Request,
  params: Record<string, string | string[]> = {},
): Promise<Response> {
  const req = await pluginRequestFromWeb(request, params)
  const res = new PluginResponseCollector()
  await handler(req, res)
  return res.toResponse()
}
