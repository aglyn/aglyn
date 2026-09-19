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
 * The slice of the Workers R2 binding the delivery Worker calls, typed here
 * rather than taken from `@cloudflare/workers-types`: the Worker needs two
 * methods, and a spec satisfies these with an in-memory bucket.
 *
 * The shapes follow the binding's documented `R2Bucket.head` and
 * `R2Bucket.get`: `head` answers the object's metadata or null, and `get`
 * answers the object with a body, or null when the key does not exist. A
 * ranged `get` returns only the bytes in `range`.
 */

export interface R2ObjectMetadata {
  key: string
  /** The whole object's size, whatever range was read. */
  size: number
  /** The object's ETag, quoted, ready for an `ETag` header. */
  httpEtag: string
  httpMetadata?: { contentType?: string }
}

export interface R2ObjectWithBody extends R2ObjectMetadata {
  body: ReadableStream<Uint8Array>
}

export interface R2BucketBinding {
  head(key: string): Promise<R2ObjectMetadata | null>
  get(
    key: string,
    options?: { range?: { offset: number; length?: number } },
  ): Promise<R2ObjectWithBody | null>
}
