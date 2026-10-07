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

import type { Firestore } from 'firebase/firestore'

/*
 * What every commerce mobile query and action is handed (AGL-3621).
 *
 * The app shell owns sign-in, the workspace and the site switcher; a screen
 * receives the signed-in Firestore, the site it is looking at and the console
 * API client, and nothing here reaches for a global. Reads go through the
 * Firebase JS SDK under the same security rules as the console; writes the
 * console makes through an API route go through that same route with the
 * member's ID token, so the phone has no path the browser does not.
 */

export interface MobileApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Query-string parameters, for a GET. */
  query?: Readonly<Record<string, string>>
  /** JSON body, for a write. */
  body?: unknown
  /** One attempt's key: a retry of the same attempt sends the same key. */
  idempotencyKey?: string
}

/** The console API, signed in as the member (`Authorization: Bearer <ID token>`). */
export interface MobileApiClient {
  /** `path` is the route below `/api/`, e.g. `commerce/refund`. Rejects with `MobileApiError`. */
  request<T>(path: string, init: MobileApiRequest): Promise<T>
}

/** A route's refusal, carrying the `{ error }` text the route wrote. */
export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'MobileApiError'
  }
}

export interface CommerceMobileContext {
  firestore: Firestore
  /** The site whose store this is. */
  hostId: string
  api: MobileApiClient
  /** Clock, injectable for specs. */
  now?: () => number
}

/** A fresh key for one attempt at a money or stock write. */
export function newAttemptKey(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random()
          .toString(36)
          .slice(2, 12)}`
  return `${prefix}:${random}`
}

/**
 * The alphabet and length of `createResourceUid`, the id every console
 * resource carries: nanoid's URL-safe alphabet, ten characters. Restated
 * because the console's helper reaches a barrel that is not free of React;
 * `context.spec.ts` holds both to their sources.
 */
export const RESOURCE_ID_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'
export const RESOURCE_ID_LENGTH = 10

/**
 * A new document id in the console's own form, for a document the app
 * creates. Drawn from the platform's secure random source where the runtime
 * has one.
 */
export function newResourceId(): string {
  const bytes = new Uint8Array(RESOURCE_ID_LENGTH)
  const crypto = globalThis.crypto
  if (typeof crypto?.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  let id = ''
  // 64 symbols: the low six bits pick one with no bias.
  for (const byte of bytes) id += RESOURCE_ID_ALPHABET[byte & 63]
  return id
}

export const nowOf = (context: Pick<CommerceMobileContext, 'now'>): number =>
  context.now ? context.now() : Date.now()
