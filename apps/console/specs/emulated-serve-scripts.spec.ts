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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * An "emulated" dev server has to emulate STORAGE too (AGL-2795).
 *
 * firebase-admin reaches Cloud Storage through its own client, and that
 * client only looks for `FIREBASE_STORAGE_EMULATOR_HOST` (or
 * `STORAGE_EMULATOR_HOST`). Nothing in `shared-util-fbserver` derives it from
 * `FIREBASE_STORAGE_EMULATOR_ENABLED`. So a serve script that points Auth and
 * Firestore at the emulators and says nothing about Storage starts a server
 * whose media uploads, replaces, deletes and CDN reads all go to the REAL
 * bucket named in `.env.development.local`, with the real service account
 * beside it. The page looks emulated, and the bytes are not.
 *
 * It also has to hand the PAGE the emulators it hands the server (AGL-2834).
 * A browser bundle cannot read `FIRESTORE_EMULATOR_HOST` — Next inlines only
 * `NEXT_PUBLIC_*` into client code — so each script mirrors the hosts the page
 * connects to into `NEXT_PUBLIC_` twins, from the same caller-overridable
 * values. Without the twins, a stack on private ports splits in two: the
 * server talks to it and the page talks to whatever holds the default ports.
 *
 * The environment is measured rather than pattern-matched. Each script's own
 * shell text runs in `sh`, with the preflight dropped and the program swapped
 * for `env`, so what is asserted is what the started process would receive.
 */
const repoRoot = join(__dirname, '..', '..', '..')
const packageJson = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
) as { scripts: Record<string, string> }

const emulatedServeScripts = Object.entries(packageJson.scripts).filter(
  ([name]) => /^serve:[^:]+:emulated$/.test(name),
)

const PREFLIGHT = 'node tools/scripts/require-emulator.mjs && '

/** A port set no default stack uses, as a caller would export it. */
const PRIVATE = {
  FIRESTORE_EMULATOR_HOST: 'localhost:18082',
  FIREBASE_AUTH_EMULATOR_HOST: 'localhost:19099',
  FIREBASE_DATABASE_EMULATOR_HOST: 'localhost:19000',
  FIREBASE_STORAGE_EMULATOR_HOST: 'localhost:19199',
}

/** The environment `command` hands the program it starts, under `caller`. */
function launchedEnvironment(
  command: string,
  caller: Record<string, string> = {},
): Record<string, string> {
  const launch = command.startsWith(PREFLIGHT)
    ? command.slice(PREFLIGHT.length)
    : command
  const program = launch.search(/ (nx|node) /)
  if (program < 0) throw new Error(`No program to replace in: ${command}`)
  const output = execFileSync('sh', ['-c', `${launch.slice(0, program)} env`], {
    // A clean environment, so a variable exported in the shell running this
    // spec cannot stand in for one the script failed to set.
    env: { NODE_ENV: 'test', PATH: process.env['PATH'] ?? '', ...caller },
    encoding: 'utf8',
  })
  return Object.fromEntries(
    output
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]),
  )
}

describe('emulated serve scripts keep Storage off the real bucket (AGL-2795)', () => {
  it('finds the emulated serve scripts it guards', () => {
    // A rename that left this matching nothing would make every case below
    // vacuous, which is the shape of a guard that always passes.
    expect(emulatedServeScripts.map(([name]) => name)).toEqual(
      expect.arrayContaining(['serve:console:emulated', 'serve:tenant:emulated']),
    )
  })

  it.each(emulatedServeScripts)(
    '%s points the Admin SDK at the Storage emulator',
    (_name, command) => {
      const environment = launchedEnvironment(command)
      expect(environment['FIRESTORE_EMULATOR_HOST']).toBe('localhost:8082')
      expect(environment['FIREBASE_STORAGE_EMULATOR_HOST']).toBe('localhost:9199')
    },
  )

  it('the emulator recipe starts the Storage emulator those scripts point at', () => {
    expect(packageJson.scripts['firebase:emulate']).toMatch(
      /--only\s+\S*\bstorage\b/,
    )
  })
})

describe('emulated serve scripts hand the page the emulators the server gets (AGL-2834)', () => {
  /** Each script's server variables, and the twin the page reads for each. */
  const MIRRORS: Record<string, Array<[keyof typeof PRIVATE, string]>> = {
    'serve:console:emulated': [
      ['FIRESTORE_EMULATOR_HOST', 'NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST'],
      ['FIREBASE_AUTH_EMULATOR_HOST', 'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST'],
      [
        'FIREBASE_DATABASE_EMULATOR_HOST',
        'NEXT_PUBLIC_FIREBASE_DATABASE_EMULATOR_HOST',
      ],
    ],
    'serve:tenant:emulated': [
      ['FIRESTORE_EMULATOR_HOST', 'NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST'],
      ['FIREBASE_AUTH_EMULATOR_HOST', 'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST'],
    ],
  }

  it('covers every emulated serve script', () => {
    expect(Object.keys(MIRRORS).sort()).toEqual(
      emulatedServeScripts.map(([name]) => name).sort(),
    )
  })

  it.each(Object.entries(MIRRORS))(
    '%s connects the page to the default ports when the caller names none',
    (name, mirrors) => {
      const environment = launchedEnvironment(packageJson.scripts[name])
      for (const [server, page] of mirrors) {
        expect(environment[page]).toBe(environment[server])
      }
      expect(environment['NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST']).toBe(
        'localhost:8082',
      )
      expect(environment['NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST']).toBe(
        'localhost:9099',
      )
    },
  )

  it.each(Object.entries(MIRRORS))(
    '%s moves the server and the page to the port set the caller names',
    (name, mirrors) => {
      const environment = launchedEnvironment(packageJson.scripts[name], PRIVATE)
      for (const [server, page] of mirrors) {
        expect(environment[server]).toBe(PRIVATE[server])
        expect(environment[page]).toBe(PRIVATE[server])
      }
      expect(environment['FIREBASE_STORAGE_EMULATOR_HOST']).toBe(
        PRIVATE.FIREBASE_STORAGE_EMULATOR_HOST,
      )
    },
  )

  it('sets exactly the twins the page reads', () => {
    const reader = readFileSync(
      join(
        repoRoot,
        'libs/tenant/feature/instance/src/lib/constants/firebase-emulator-hosts.ts',
      ),
      'utf8',
    )
    const read = new Set(
      [...reader.matchAll(/process\.env\.(NEXT_PUBLIC_\w+_EMULATOR_HOST)\b/g)].map(
        (match) => match[1],
      ),
    )
    const set = new Set(
      Object.values(MIRRORS)
        .flat()
        .map(([, page]) => page),
    )
    expect(read.size).toBeGreaterThan(0)
    expect([...set].sort()).toEqual([...read].sort())
  })

  it('seeds the stack the caller names, and the default one otherwise', () => {
    expect(
      launchedEnvironment(packageJson.scripts['seed:e2e'], PRIVATE),
    ).toMatchObject({
      FIRESTORE_EMULATOR_HOST: PRIVATE.FIRESTORE_EMULATOR_HOST,
      FIREBASE_AUTH_EMULATOR_HOST: PRIVATE.FIREBASE_AUTH_EMULATOR_HOST,
    })
    expect(launchedEnvironment(packageJson.scripts['seed:e2e'])).toMatchObject({
      FIRESTORE_EMULATOR_HOST: 'localhost:8082',
      FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099',
    })
  })
})
