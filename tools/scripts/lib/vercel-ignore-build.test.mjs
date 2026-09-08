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
 * Pins `tools/scripts/vercel-ignore-build.sh` (AGL-1187, AGL-2688).
 *
 *   node --test tools/scripts/lib/vercel-ignore-build.test.mjs
 *
 * Runs the real script against a throwaway git repo, because the two failures
 * that matter are both about the DIFF RANGE and neither is visible from
 * reading the path rules:
 *
 *   1. A docs change in a multi-commit push judged by the tip alone — the
 *      AGL-2688 defect, which is silent: the site keeps serving old content
 *      while the merged PR says shipped.
 *   2. Any error path resolving to IGNORE rather than BUILD. Every unknown —
 *      a bad app name, an unreachable base sha, a failed diff — must build.
 *
 * ⚠️ The exit codes read backwards, and the script's header says why:
 *      exit 0 -> IGNORE (Vercel cancels the build)
 *      exit 1 -> BUILD
 */

import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../vercel-ignore-build.sh',
)

const IGNORE = 'IGNORE'
const BUILD = 'BUILD'

let repo

const git = (...args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

/** Commit `files` ({path: contents}) and answer the new sha. */
function commit(message, files) {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), contents)
  }
  git('add', '-A')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message)
  return git('rev-parse', 'HEAD')
}

/**
 * The script's verdict for `app` over `base..head`.
 *
 * `VERCEL_ENV=production` because the script short-circuits to IGNORE on
 * anything else, which would make every case below pass for the wrong reason.
 */
function run(args, env = {}) {
  try {
    execFileSync('bash', [SCRIPT, ...args], {
      cwd: repo,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, VERCEL_ENV: 'production', ...env },
    })
    return IGNORE
  } catch {
    return BUILD
  }
}

const verdict = (app, base, head, env = {}) => run([app, base, head], env)

/** No positional range — the shape Vercel invokes, driven by env alone. */
const verdictFromEnv = (app, env) => run([app], env)

before(() => {
  repo = mkdtempSync(join(tmpdir(), 'ignore-build-'))
  git('init', '-q', '-b', 'main')
  commit('root', { 'README.md': 'seed\n' })
})

after(() => rmSync(repo, { recursive: true, force: true }))

describe('who builds for a change to each tree', () => {
  /**
   * Written out per app rather than derived from "is it mine", because the
   * table is not symmetric and the asymmetry is the interesting part:
   * `tools/` is deliberately NOT ignorable for console and tenant — the
   * next.config files reach into it — so a plugin-loader edit builds three
   * projects, not one. Deriving the expectation would have hidden that.
   */
  const cases = [
    [
      'apps/docs/src/pages/status.tsx',
      { docs: BUILD, plugins: IGNORE, console: IGNORE, tenant: IGNORE },
    ],
    [
      'tools/plugin-loader/origin/api/load.mjs',
      { docs: IGNORE, plugins: BUILD, console: BUILD, tenant: BUILD },
    ],
    [
      'apps/console/app/page.tsx',
      { docs: IGNORE, plugins: IGNORE, console: BUILD, tenant: IGNORE },
    ],
    [
      'apps/tenant/app/page.tsx',
      { docs: IGNORE, plugins: IGNORE, console: IGNORE, tenant: BUILD },
    ],
    [
      'cloud/functions/src/index.ts',
      { docs: IGNORE, plugins: IGNORE, console: IGNORE, tenant: IGNORE },
    ],
  ]

  for (const [path, expected] of cases) {
    it(`a change to ${path}`, () => {
      const base = git('rev-parse', 'HEAD')
      const head = commit(`touch ${path}`, { [path]: `// ${Date.now()}\n` })
      for (const [app, want] of Object.entries(expected)) {
        assert.equal(verdict(app, base, head), want, `${app} over ${path}`)
      }
    })
  }
})

describe('libs/ always builds console and tenant, never docs or plugins', () => {
  // The asymmetry is deliberate and is the whole reason docs and plugins may
  // invert: they have their own package.json and import no shared library, so
  // a leaf change under libs/ cannot reach them.
  it('splits on the same commit', () => {
    const base = git('rev-parse', 'HEAD')
    const head = commit('touch libs', {
      'libs/tenant/runtime/src/lib/get-screen.ts': 'export {}\n',
    })
    assert.equal(verdict('console', base, head), BUILD)
    assert.equal(verdict('tenant', base, head), BUILD)
    assert.equal(verdict('docs', base, head), IGNORE)
    assert.equal(verdict('plugins', base, head), IGNORE)
  })
})

describe('the AGL-2688 defect: a push judged by its tip alone', () => {
  /**
   * The regression that motivated giving docs this script. `aglyn-docs` ran
   * `git diff --quiet HEAD^ HEAD -- apps/docs`, so a docs edit anywhere but
   * the last commit of a push was invisible and the build was skipped.
   */
  it('builds docs when the docs edit is NOT the tip commit', () => {
    const base = git('rev-parse', 'HEAD')
    commit('docs edit, early in the push', {
      'apps/docs/docs/guide.md': '# guide\n',
    })
    const tip = commit('unrelated console work, later in the push', {
      'apps/console/app/other.tsx': 'export {}\n',
    })

    // What the old inline command measured — one commit — and why it was wrong.
    assert.equal(
      verdict('docs', `${tip}^`, tip),
      IGNORE,
      'tip-only range still hides the docs edit; this asserts the defect, not the fix',
    )
    // What the script measures: the whole push.
    assert.equal(verdict('docs', base, tip), BUILD)
  })

  it('prefers VERCEL_GIT_PREVIOUS_SHA over HEAD^ when no base is passed', () => {
    // The environment Vercel actually supplies: no positional arguments, and a
    // previous-sha spanning several commits — including pushes that were
    // themselves skipped, which `HEAD^` cannot see at all.
    const base = git('rev-parse', 'HEAD')
    commit('docs edit', { 'apps/docs/docs/two.md': '# two\n' })
    commit('unrelated', { 'apps/console/a.tsx': 'export {}\n' })
    const tip = commit('unrelated again', { 'apps/console/b.tsx': 'export {}\n' })

    assert.equal(
      verdictFromEnv('docs', {
        VERCEL_GIT_PREVIOUS_SHA: base,
        VERCEL_GIT_COMMIT_SHA: tip,
      }),
      BUILD,
      'a docs edit two commits back must still build',
    )
    // The control: with the previous sha at the tip's parent — i.e. what
    // `HEAD^` would have measured — the same tree ignores.
    assert.equal(
      verdictFromEnv('docs', {
        VERCEL_GIT_PREVIOUS_SHA: `${tip}^`,
        VERCEL_GIT_COMMIT_SHA: tip,
      }),
      IGNORE,
    )
  })
})

describe('every unknown resolves to BUILD', () => {
  it('rejects an app name it does not know', () => {
    const head = git('rev-parse', 'HEAD')
    assert.equal(verdict('website', `${head}^`, head), BUILD)
  })

  it('builds when the base sha is unreachable', () => {
    const head = git('rev-parse', 'HEAD')
    assert.equal(verdict('docs', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', head), BUILD)
  })

  it('builds when the range is empty', () => {
    const head = git('rev-parse', 'HEAD')
    assert.equal(verdict('docs', head, head), BUILD)
  })

  it('ignores a non-production environment, which is the one exception', () => {
    const head = git('rev-parse', 'HEAD')
    assert.equal(
      verdict('docs', `${head}^`, head, { VERCEL_ENV: 'preview' }),
      IGNORE,
    )
  })
})
