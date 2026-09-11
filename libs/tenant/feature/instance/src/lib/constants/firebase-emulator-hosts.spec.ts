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
 * The page connects to the emulators its server was started with (AGL-2834).
 *
 * An emulator stack on private ports has to be reachable from the browser at
 * those ports, and a page started without the variables has to keep
 * connecting where it always did. A malformed value must not become a
 * connection to a half-parsed address, so it reads as unset.
 */

import {
  authEmulatorUrl,
  databaseEmulatorHost,
  DEFAULT_AUTH_EMULATOR,
  DEFAULT_DATABASE_EMULATOR,
  DEFAULT_FIRESTORE_EMULATOR,
  firestoreEmulatorHost,
  parseEmulatorHost,
} from './firebase-emulator-hosts'

const VARIABLES = [
  'NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST',
  'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST',
  'NEXT_PUBLIC_FIREBASE_DATABASE_EMULATOR_HOST',
] as const

const saved = Object.fromEntries(
  VARIABLES.map((name) => [name, process.env[name]]),
)

beforeEach(() => {
  for (const name of VARIABLES) delete process.env[name]
})

afterAll(() => {
  for (const name of VARIABLES) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

describe('parseEmulatorHost (AGL-2834)', () => {
  const FALLBACK = { host: 'localhost', port: 8082 }

  it('reads host:port the way the emulator variables spell it', () => {
    expect(parseEmulatorHost('localhost:18082', FALLBACK)).toEqual({
      host: 'localhost',
      port: 18082,
    })
    expect(parseEmulatorHost('127.0.0.1:19099', FALLBACK)).toEqual({
      host: '127.0.0.1',
      port: 19099,
    })
    expect(parseEmulatorHost(' localhost:18082\n', FALLBACK)).toEqual({
      host: 'localhost',
      port: 18082,
    })
  })

  it('keeps the brackets of an IPv6 host, which a URL needs', () => {
    expect(parseEmulatorHost('[::1]:19000', FALLBACK)).toEqual({
      host: '[::1]',
      port: 19000,
    })
  })

  it('falls back for anything that is not a host and a TCP port', () => {
    for (const value of [
      undefined,
      null,
      '',
      'localhost',
      'localhost:',
      ':8082',
      'localhost:port',
      'localhost:0',
      'localhost:65536',
      'localhost:8082.5',
      '::1:9099',
    ]) {
      expect(parseEmulatorHost(value, FALLBACK)).toBe(FALLBACK)
    }
  })
})

describe('the hosts the page connects to (AGL-2834)', () => {
  it('connects where it always did when the server passed no hosts', () => {
    expect(firestoreEmulatorHost()).toEqual(DEFAULT_FIRESTORE_EMULATOR)
    expect(DEFAULT_FIRESTORE_EMULATOR).toEqual({ host: 'localhost', port: 8082 })
    expect(authEmulatorUrl()).toBe('http://localhost:9099')
    expect(DEFAULT_AUTH_EMULATOR).toEqual({ host: 'localhost', port: 9099 })
    expect(databaseEmulatorHost()).toEqual(DEFAULT_DATABASE_EMULATOR)
    expect(DEFAULT_DATABASE_EMULATOR).toEqual({ host: 'localhost', port: 9000 })
  })

  it('connects to a private port set the server was started with', () => {
    process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST = 'localhost:18082'
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:19099'
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_EMULATOR_HOST = 'localhost:19000'
    expect(firestoreEmulatorHost()).toEqual({ host: 'localhost', port: 18082 })
    expect(authEmulatorUrl()).toBe('http://127.0.0.1:19099')
    expect(databaseEmulatorHost()).toEqual({ host: 'localhost', port: 19000 })
  })

  it('reads each host when it is asked for, not when the module loads', () => {
    expect(firestoreEmulatorHost().port).toBe(8082)
    process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST = 'localhost:28082'
    expect(firestoreEmulatorHost().port).toBe(28082)
  })
})
