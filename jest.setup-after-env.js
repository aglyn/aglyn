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
 * RTL's async budget, which `testTimeout` does not cover (AGL-2382).
 *
 * `waitFor`, `findBy*` and `waitForElementToBeRemoved` carry their OWN
 * timeout — `asyncUtilTimeout`, defaulting to 1,000 ms — and jest's
 * `testTimeout` has no bearing on it. A spec can sit under
 * `jest.setTimeout(30_000)` and still lose at one second, reporting the
 * condition's last value as a mismatch rather than as a timeout, which is
 * how it reads as an assertion bug. This repo has already paid for that
 * confusion twice: see the AGL-1762 note in
 * `libs/plugins/data/src/lib/components/host-datasets-card-head-count.spec.tsx`,
 * which spells out that a trailing `waitFor` "spent RTL's 1,000ms default,
 * not this file's `jest.setTimeout(30_000)`".
 *
 * One second is not a hang; on `ubuntu-latest` it is not even a render. NX
 * CI runs `nx affected --parallel=3` on a 4-vCPU runner and each jest task
 * takes `cores - 1` workers of its own, so up to nine workers and a Next
 * build share four vCPUs. `host-datasets-card-head-count › re-reads the
 * record count after a delete` failed there — and reproduces on a loaded
 * developer box — because one React effect chain after a click did not
 * finish inside that second. 5 s is still a fifth of `testTimeout`, so a
 * condition that will never be satisfied still fails the test rather than
 * hanging it, and it fails with the SAME message it does today.
 *
 * Guarded on `document` because this preset also runs `testEnvironment:
 * 'node'` projects, which have no DOM for `@testing-library/dom` to attach
 * to and no `waitFor` to configure. Resolved from the repo root, which is
 * the single hoisted copy `@testing-library/react` itself resolves (there is
 * no nested `node_modules/@testing-library/react/node_modules`), so this
 * configures the same module-level singleton the specs read.
 */
if (typeof document !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { configure } = require('@testing-library/dom')
  configure({ asyncUtilTimeout: 5000 })
}
