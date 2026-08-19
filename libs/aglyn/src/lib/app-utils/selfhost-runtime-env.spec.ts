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

/**
 * The `deps` stage must copy everything `npm ci` reads, not only the manifest
 * and the lockfile (AGL-2423).
 *
 * The repo's tracked `.npmrc` carries `legacy-peer-deps=true`. Without it npm
 * resolves a peer-inclusive ideal tree that `package-lock.json` — generated
 * WITH the flag — does not encode, and `npm ci` refuses with EUSAGE. Both
 * Dockerfiles copied only `package.json package-lock.json`, so every
 * `docker compose up --build` died 20 seconds in, before a line of application
 * code was compiled. The build stage's `COPY . .` does bring `.npmrc`, two
 * stages too late.
 *
 * A workstation never shows it: `npm ci` there reads the repo `.npmrc` out of
 * the working directory. The container was the one environment nobody ran, and
 * the failure looks like lockfile drift — pinning the workstation's exact npm
 * version inside the image still fails, which is how the file was identified.
 *
 * The required set is DERIVED from `git ls-files`, not written down here, so a
 * sibling config file added later is covered by construction.
 */
const NPM_CONFIG_AT_ROOT = /^(\.npmrc|npm-shrinkwrap\.json)$/

function trackedRootFiles(): string[] {
  return execFileSync('git', ['ls-files', '--', ':(top,glob)*'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.includes('/'))
}

/** Every tracked root file `npm ci` consults, manifest and lockfile included. */
function npmInstallInputs(): string[] {
  return trackedRootFiles()
    .filter(
      (file) =>
        NPM_CONFIG_AT_ROOT.test(file) ||
        file === 'package.json' ||
        file === 'package-lock.json',
    )
    .sort()
}

/**
 * The paths named by the last `COPY … ./` before `RUN npm ci`, which is the
 * only material that install can see.
 */
function depsStageCopySources(dockerfile: string): string[] {
  const source = readFileSync(join(REPO_ROOT, dockerfile), 'utf8')
  const install = source.search(/^RUN npm ci\b/m)
  if (install < 0) {
    throw new Error(
      `${dockerfile} no longer runs \`npm ci\`. If the install changed shape, re-point this guard — it is checking that the install can see the repo's npm configuration.`,
    )
  }
  const copies = [...source.slice(0, install).matchAll(/^COPY ([^\n]+)$/gm)]
  const last = copies.at(-1)
  if (!last) {
    throw new Error(
      `${dockerfile} has no COPY before \`RUN npm ci\`, so the install runs against an empty context.`,
    )
  }
  // `COPY a b c ./` — the final token is the destination.
  return last[1].trim().split(/\s+/).slice(0, -1)
}

describe('self-host image build inputs (AGL-2423)', () => {
  const required = npmInstallInputs()

  // Anti-vacuity: if `git ls-files` ever returns nothing — a moved REPO_ROOT,
  // a pathspec that stops matching — every assertion below would pass over an
  // empty list and certify an install that copies nothing.
  it('the derived input set is real', () => {
    expect(required).toContain('package.json')
    expect(required).toContain('package-lock.json')
    expect(required).toContain('.npmrc')
  })

  it.each(IMAGES)(
    '%s copies every npm config file into the deps stage before `npm ci`',
    (dockerfile) => {
      const copied = depsStageCopySources(dockerfile)
      const missing = required.filter((file) => !copied.includes(file))
      if (missing.length) {
        throw new Error(
          `${dockerfile}'s deps stage runs \`npm ci\` without ${missing.join(', ')}. ` +
            `It copies: ${copied.join(', ')}. ` +
            `npm reads .npmrc from the working directory, and this repo's sets legacy-peer-deps=true; ` +
            `without it \`npm ci\` rejects the lockfile as out of sync (EUSAGE) and the image cannot build at all.`,
        )
      }
    },
  )
})
