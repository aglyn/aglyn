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
 * EVERY health route says which build answered, on every deployment shape
 * (AGL-2091).
 *
 * The defect this exists to prevent is not a wrong value, it is an omission
 * repeated nine times. Nine separate `/api/health*` routes each wrote
 * `process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? null` by hand, so a
 * self-hosted install got `"commit": null` from all nine and had no version
 * anywhere — and the tenth route, whenever it is added, would have been
 * written by copying the ninth.
 *
 * `deploymentCommitRef()` and `platformVersion()` make the right answer a
 * one-liner; this makes forgetting them a failing build. It reads the route
 * SOURCES rather than invoking the routes, because invoking them needs
 * Firestore, a service account and a network — which is exactly the cost that
 * left nine copies of one expression unexamined.
 */

import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const REPO_ROOT = resolve(__dirname, '../../../../..')

/**
 * The routes, found rather than listed. A hand-maintained list is the same
 * failure mode one level up: the route that forgets the version is exactly
 * the route nobody remembered to add here.
 */
function healthRoutes(): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', 'apps/*/app/api/health/**/route.ts', 'apps/*/app/api/health/route.ts'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  return listed.split('\n').filter(Boolean).sort()
}

function source(file: string): string {
  return readFileSync(resolve(REPO_ROOT, file), 'utf8')
}

describe('health routes report the running build (AGL-2091)', () => {
  const routes = healthRoutes()

  it('finds every health route', () => {
    // Vacuity guard. A glob that stops matching would make every assertion
    // below pass over an empty list, which is the failure mode that lets a
    // green check prove nothing.
    expect(routes.length).toBeGreaterThanOrEqual(9)
    expect(routes.some((file) => file.startsWith('apps/console/'))).toBe(true)
    expect(routes.some((file) => file.startsWith('apps/tenant/'))).toBe(true)
  })

  it.each(routes)('%s reports a version', (file) => {
    expect(source(file)).toContain('version: platformVersion()')
  })

  it.each(routes)('%s resolves the commit on every deployment shape', (file) => {
    expect(source(file)).toContain('commit: deploymentCommitRef()')
  })

  it.each(routes)('%s does not read the Vercel commit variable directly', (file) => {
    // The specific expression that produced `"commit": null` on every
    // self-hosted install. `deploymentCommitRef()` still reads it — third, and
    // in one place.
    expect(source(file)).not.toContain('VERCEL_GIT_COMMIT_SHA')
  })
})

/**
 * The build metadata is read where a BUNDLER can see it (AGL-2091).
 *
 * `PACKAGE_VERSION`, `BUILD_ID` and `COMMIT_REF` are build-time defines, not
 * runtime environment variables — nothing sets them in the process. So the
 * resolvers only work if the literal `process.env.NAME` text survives into the
 * module for the bundler to replace, and they silently return null the moment
 * someone "tidies" them into a parameterised read of `process.env`.
 *
 * That failure is invisible to every unit test in this repo, because a unit
 * test passes its own environment object and never exercises the default. It
 * is only visible in a deployed build, as a health body reporting
 * `"version": null` — which is the exact symptom AGL-2091 exists to remove.
 * Hence a source assertion.
 */
describe('build metadata is read as a literal, not through an alias', () => {
  const source = readFileSync(
    resolve(REPO_ROOT, 'libs/aglyn/src/lib/app-utils/deployment-shape.ts'),
    'utf8',
  )

  it.each(['PACKAGE_VERSION', 'BUILD_ID', 'COMMIT_REF'])(
    'reads process.env.%s literally',
    (name) => {
      expect(source).toContain(`process.env.${name}`)
    },
  )

  it('does not default the build-metadata readers to process.env', () => {
    // `deploymentEnvironmentLabel` legitimately does, because the variables it
    // reads are real at runtime. These two are not, so the same default would
    // be a resolver that cannot resolve.
    for (const fn of ['deploymentCommitRef', 'platformVersion']) {
      const declaration = source.slice(
        source.indexOf(`export function ${fn}(`),
        source.indexOf(`export function ${fn}(`) + 200,
      )
      expect(declaration).not.toContain('= process.env')
    }
  })
})
