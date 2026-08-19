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
import { join, resolve } from 'node:path'
import { isDeployedRuntime, isProductionDeployment } from './deployment-shape'

/**
 * The self-host images must set `AGLYN_STANDALONE` in the stage that RUNS
 * (AGL-2221).
 *
 * `deployment-shape.ts` reads it at request time, and both Dockerfiles set it —
 * in the **build** stage. Docker `ENV` does not cross a stage boundary, and the
 * runner starts from a fresh `FROM node:24-slim`, so every shipped container
 * ran with the variable unset. `isDeployedRuntime()` was therefore false in
 * production, which made AGL-2177's whole point inert: host resolution fell
 * through to the `default:` branch and a visitor to a self-hosted site was
 * redirected to the console instead of being served the site.
 *
 * Nothing caught it, and three things that look like they should have did not:
 *
 *  - `apps/tenant/specs/selfhost-host-resolution.spec.ts` sets
 *    `AGLYN_STANDALONE=1` in its own setup and describes that as "exactly what
 *    docker/tenant.Dockerfile and .env.selfhost produce". It tested an
 *    environment the image does not have.
 *  - `apps/tenant/middleware.ts` carries a comment asserting the Dockerfile
 *    sets it — true of the file, false of the process.
 *  - The variable is in neither `.env.selfhost.example` nor `docker-compose.yml`,
 *    so nothing at the compose layer supplied it either.
 *
 * A unit test of the predicate cannot see any of that, because the predicate
 * was correct. What was wrong was the environment it would be evaluated in, so
 * this guard reads the Dockerfiles.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..')

/** The `FROM … AS runner` stage of a Dockerfile, to its end. */
function runnerStage(dockerfile: string): string {
  const source = readFileSync(join(REPO_ROOT, dockerfile), 'utf8')
  const start = source.search(/^FROM .+ AS runner$/m)
  if (start < 0) {
    throw new Error(
      `${dockerfile} has no \`FROM … AS runner\` stage any more. If the stage was renamed, re-point this guard — it is checking the environment the container actually runs with.`,
    )
  }
  const rest = source.slice(start + 1)
  const next = rest.search(/^FROM /m)
  return next < 0 ? rest : rest.slice(0, next)
}

const IMAGES = ['docker/tenant.Dockerfile', 'docker/console.Dockerfile']

describe('self-host container runtime environment (AGL-2221)', () => {
  // Anti-vacuity: a renamed stage or a moved Dockerfile would otherwise make
  // every assertion below pass over an empty string.
  it.each(IMAGES)('%s has a runner stage with real content', (dockerfile) => {
    const stage = runnerStage(dockerfile)
    expect(stage.length).toBeGreaterThan(100)
    expect(stage).toMatch(/^ENV /m)
  })

  it.each(IMAGES)(
    '%s sets AGLYN_STANDALONE in the stage that runs, not only the one that builds',
    (dockerfile) => {
      const stage = runnerStage(dockerfile)
      if (!/AGLYN_STANDALONE=1/.test(stage)) {
        throw new Error(
          `${dockerfile}'s runner stage does not set AGLYN_STANDALONE=1. Setting it in the build stage does not carry over — Docker ENV does not cross a stage boundary, and this variable is read at REQUEST time. Without it isDeployedRuntime() is false in production and a self-hosted site redirects its visitors to the console instead of serving them.`,
        )
      }
    },
  )

  it.each(IMAGES)('%s still sets NODE_ENV=production', (dockerfile) => {
    // `isProductionDeployment()` needs BOTH, and `isDevelopmentRuntime()` — the
    // only predicate a security relaxation may key on — needs this one alone.
    expect(runnerStage(dockerfile)).toMatch(/NODE_ENV=production/)
  })

  it('the two predicates agree with what the runner stage now provides', () => {
    const container = { AGLYN_STANDALONE: '1', NODE_ENV: 'production' }
    expect(isDeployedRuntime(container)).toBe(true)
    expect(isProductionDeployment(container)).toBe(true)
    // And the negative control: the state every shipped image was actually in.
    expect(isDeployedRuntime({ NODE_ENV: 'production' })).toBe(false)
  })
})
