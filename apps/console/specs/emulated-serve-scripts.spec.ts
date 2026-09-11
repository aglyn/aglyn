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
 */
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
) as { scripts: Record<string, string> }

const emulatedServeScripts = Object.entries(packageJson.scripts).filter(
  ([name]) => /^serve:[^:]+:emulated$/.test(name),
)

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
      expect(command).toMatch(/\bFIRESTORE_EMULATOR_HOST=/)
      expect(command).toMatch(/\bFIREBASE_STORAGE_EMULATOR_HOST=localhost:9199\b/)
    },
  )

  it('the emulator recipe starts the Storage emulator those scripts point at', () => {
    expect(packageJson.scripts['firebase:emulate']).toMatch(
      /--only\s+\S*\bstorage\b/,
    )
  })
})

/**
 * Nor may an "emulated" server hold the keys for services the emulators do
 * not stand in for (AGL-2828). `nx serve` cannot give that: its task runner
 * loads the env files through dotenv-expand, which writes a file's value over
 * an empty variable, so a credential blanked in the script comes back. The
 * scripts start `next dev` through `tools/scripts/serve-emulated.mjs`, which
 * assembles the environment without that refill and sets every outbound
 * credential to ''.
 */
describe('emulated serve scripts hold no outbound credential (AGL-2828)', () => {
  it.each(emulatedServeScripts)(
    '%s serves through serve-emulated.mjs, not the nx task runner',
    (name, command) => {
      const app = name.split(':')[1]
      expect(command).toMatch(
        new RegExp(`\\bnode tools/scripts/serve-emulated\\.mjs ${app}$`),
      )
      expect(command).not.toMatch(/\bnx\s/)
    },
  )
})
