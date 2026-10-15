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
 * Reading a Cloud Storage object without a false leak warning (AGL-3795).
 *
 * ## Why every Storage read used to warn
 *
 * `File#createReadStream` (and `File#download`, which is built on it) hands
 * the HTTP response body, a node-fetch `PassThrough`, to three `pipeline`s at
 * once:
 *
 * 1. node-fetch's own, from the socket into the body;
 * 2. teeny-request's, from the body into the retry-request stream, which
 *    Storage only `resume()`s;
 * 3. Storage's, from the body into the read stream it returns.
 *
 * On Node 24 those add 12 `error` listeners and 11 `close` listeners to the
 * body. Node's limit is 10, so `MaxListenersExceededWarning` fired once per
 * read on every route that touches Storage. The count is a fixed fan-out: it
 * is the same for a 1-chunk and a 200-chunk object and for the first and the
 * hundredth request, and the listeners go away with the body when the read
 * ends. So nothing accumulates. The warning is a heuristic tripping on a
 * library's wiring.
 *
 * ## What this does
 *
 * Storage re-emits the body as the read stream's `response` event before it
 * or teeny-request attaches its `pipeline`. At that point, only on that one
 * per-request body, the limit is raised to {@link STORAGE_READ_BODY_LISTENER_BUDGET}:
 * the measured fan-out plus a little headroom. The process default stays at
 * 10, so a real leak anywhere still warns, and so does a real leak on this
 * body once it grows past the budget.
 */

import type { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'

/**
 * The listener limit for a Storage response body. The measured peak is 12
 * (`error`). Room for a few more lets a library patch add one without
 * bringing the warning back, but stays low enough that a per-chunk or
 * per-request leak would still cross it within one read.
 */
export const STORAGE_READ_BODY_LISTENER_BUDGET = 16

/** The slice of a Storage `File` a read needs. */
export interface StorageReadableFile {
  createReadStream(options?: StorageReadOptions): NodeJS.ReadableStream
}

/** The `createReadStream` options the platform uses. */
export interface StorageReadOptions {
  start?: number
  end?: number
  validation?: 'crc32c' | 'md5' | boolean
}

/** Raises the limit on the response body Storage just received. */
function budgetResponseBody(body: unknown): void {
  const emitter = body as
    | { getMaxListeners?: () => number; setMaxListeners?: (n: number) => unknown }
    | null
    | undefined
  if (typeof emitter?.setMaxListeners !== 'function') return
  const current = emitter.getMaxListeners?.() ?? 0
  // 0 means unlimited, and a higher limit was set on purpose by someone else.
  if (current === 0 || current >= STORAGE_READ_BODY_LISTENER_BUDGET) return
  emitter.setMaxListeners(STORAGE_READ_BODY_LISTENER_BUDGET)
}

/**
 * `file.createReadStream(options)`, with the response body's listener
 * limit sized to Storage's fixed fan-out (see the module note).
 */
export function openStorageReadStream(
  file: StorageReadableFile,
  options: StorageReadOptions = {},
): NodeJS.ReadableStream {
  const stream = file.createReadStream(options)
  stream.once('response', budgetResponseBody)
  return stream
}

/**
 * The whole object as one Buffer, like `file.download()`, read through
 * {@link openStorageReadStream}. Rejects when the read fails.
 */
export async function readStorageObject(
  file: StorageReadableFile,
  options: StorageReadOptions = {},
): Promise<Buffer> {
  return buffer(openStorageReadStream(file, options) as Readable)
}
