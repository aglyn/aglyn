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
 * Where the browser's Firebase clients find the emulators (AGL-2834).
 *
 * A dev server and the Node half of every e2e suite find them through
 * `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` and
 * `FIREBASE_DATABASE_EMULATOR_HOST`. A page in the browser cannot read those:
 * Next inlines `NEXT_PUBLIC_*` into client bundles and nothing else. So the
 * `serve:*:emulated` scripts mirror each host into a `NEXT_PUBLIC_` twin, and
 * the page connects where its server does.
 *
 * Without the twins, the page carried the default ports as literals, and an
 * emulator stack on any other ports split in two: the server and the suite
 * talked to that stack while the page in Chrome read and wrote whichever
 * emulators held 8082 and 9099 — another session's, when one was running.
 *
 * Called only inside the emulator branches, which the
 * `FIREBASE_*_EMULATOR_ENABLED` flags gate, so a build without those flags
 * never reads a host. Every default is the port `cloud/firebase.json` and
 * `cloud/firebase.e2e.json` pin, and the one the page used before.
 *
 * No Storage twin: no browser code talks to the Storage emulator. Uploads and
 * media reads go through the servers, which already follow
 * `FIREBASE_STORAGE_EMULATOR_HOST`.
 */

/** One emulator's address, as the SDK's `connect*Emulator` calls take it. */
export interface EmulatorHost {
  host: string
  port: number
}

export const DEFAULT_FIRESTORE_EMULATOR: EmulatorHost = {
  host: 'localhost',
  port: 8082,
}

export const DEFAULT_AUTH_EMULATOR: EmulatorHost = {
  host: 'localhost',
  port: 9099,
}

export const DEFAULT_DATABASE_EMULATOR: EmulatorHost = {
  host: 'localhost',
  port: 9000,
}

/**
 * `host:port`, as the emulator variables spell it, or `fallback` for anything
 * else: an unset variable, a bare host, a port that is not a TCP port, or an
 * IPv6 address without the brackets that tell its colons from the port's.
 */
export function parseEmulatorHost(
  value: string | null | undefined,
  fallback: EmulatorHost,
): EmulatorHost {
  const text = String(value ?? '').trim()
  const colon = text.lastIndexOf(':')
  if (colon <= 0) return fallback
  const host = text.slice(0, colon)
  const portText = text.slice(colon + 1)
  if (!/^\d{1,5}$/.test(portText)) return fallback
  const port = Number(portText)
  if (port < 1 || port > 65535) return fallback
  if (host.includes(':') && !/^\[[^\]]+\]$/.test(host)) return fallback
  return { host, port }
}

/** The Firestore emulator the page connects to. */
export function firestoreEmulatorHost(): EmulatorHost {
  return parseEmulatorHost(
    process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST,
    DEFAULT_FIRESTORE_EMULATOR,
  )
}

/** The Auth emulator's origin, the form `connectAuthEmulator` takes. */
export function authEmulatorUrl(): string {
  const { host, port } = parseEmulatorHost(
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
    DEFAULT_AUTH_EMULATOR,
  )
  return `http://${host}:${port}`
}

/** The Realtime Database emulator the page's presence session connects to. */
export function databaseEmulatorHost(): EmulatorHost {
  return parseEmulatorHost(
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_EMULATOR_HOST,
    DEFAULT_DATABASE_EMULATOR,
  )
}
