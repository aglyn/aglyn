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
 * The CI consumer for `tools/marketing/build-pricing-tables.mts` (AGL-1278).
 *
 * The generator shipped with ZERO consumers: not in an nx target, not in a CI
 * path, not in a package script. It wrote `pricing-copy/tables.json` and
 * nothing ever read it, regenerated it or diffed it — so when AGL-2133
 * retired the `totalSiteSizeMb` entitlement and removed the row from the
 * generator, the committed output went on publishing a storage cap for an
 * entitlement that no longer exists, and no check in the repo could fail on
 * it. It sat there for weeks.
 *
 * This runs the generator in `--check` mode, which reconciles the code
 * against the Figma extraction, refuses to write, and exits non-zero when the
 * committed file no longer matches what the code produces.
 *
 * A thin wrapper rather than a reimplementation, deliberately: the comparison
 * has to be the SAME code path that writes the file, or it is checking its own
 * opinion of what the file should contain. It exists at all because the
 * generator is a `.mts` needing the swc ESM register hook, and a CI step
 * should be `npm run check:pricing-tables`, not four environment variables
 * somebody has to remember.
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const result = spawnSync(
  process.execPath,
  [
    '--import',
    '@swc-node/register/esm-register',
    join('tools', 'marketing', 'build-pricing-tables.mts'),
    '--check',
    ...process.argv.slice(2),
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      SWC_NODE_PROJECT: join('tools', 'marketing', 'tsconfig.tables.json'),
    },
  },
)

if (result.error) {
  console.error(`could not run the pricing-tables generator: ${result.error.message}`)
  process.exit(2)
}
// A signal death is not a clean verdict — surface it rather than letting a
// null status coerce to a passing 0.
if (result.status === null) {
  console.error(`the pricing-tables generator was killed by ${result.signal}`)
  process.exit(2)
}
process.exit(result.status)
