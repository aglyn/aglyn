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

// Tests for the dirty-tree deploy refusal (AGL-1489).
//
// The integration suite PLANTS THE VIOLATION: it builds a real git repo,
// commits a rules file, then modifies it uncommitted — the exact state that
// nearly shipped another session's `legalAcceptances` block to production —
// and asserts the guard refuses. Without the guard, every refusal assertion
// here goes red.
//
// The wiring suite asserts the deploy scripts actually CALL the guard,
// before any network write. A guard that exists but is not wired is the
// control we pretend to have (see feedback: verify a control is WIRED).

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertCleanDeploySource,
  evaluateDeploySource,
} from './clean-deploy-source.mjs'

const here = dirname(fileURLToPath(import.meta.url))

describe('evaluateDeploySource (pure)', () => {
  it('a clean file proceeds silently', () => {
    const verdict = evaluateDeploySource({
      porcelain: '',
      allowDirty: false,
      fileLabel: 'rules',
    })
    assert.deepEqual(verdict, { ok: true })
  })

  it('an uncommitted modification refuses, and the message says why', () => {
    const verdict = evaluateDeploySource({
      porcelain: ' M cloud/firebase-firestore.rules\n',
      allowDirty: false,
      fileLabel: 'cloud/firebase-firestore.rules',
    })
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason, /uncommitted modifications/)
    assert.match(verdict.reason, /--allow-dirty/)
    // The message must carry the incident's lesson, not just a refusal.
    assert.match(verdict.reason, /another session/)
  })

  it('--allow-dirty proceeds on a dirty file, but with a warning', () => {
    const verdict = evaluateDeploySource({
      porcelain: ' M cloud/firebase-firestore.rules\n',
      allowDirty: true,
      fileLabel: 'cloud/firebase-firestore.rules',
    })
    assert.equal(verdict.ok, true)
    assert.match(verdict.warning, /--allow-dirty/)
  })

  it('an unverifiable file refuses — cannot-verify is not clean', () => {
    const verdict = evaluateDeploySource({
      porcelain: null,
      allowDirty: false,
      fileLabel: 'rules',
    })
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason, /could not verify/i)
  })

  it('an unverifiable file deploys only under --allow-dirty', () => {
    const verdict = evaluateDeploySource({
      porcelain: null,
      allowDirty: true,
      fileLabel: 'rules',
    })
    assert.equal(verdict.ok, true)
    assert.match(verdict.warning, /--allow-dirty/)
  })
})

describe('assertCleanDeploySource (planted violation, real git repo)', () => {
  function makeRepo() {
    const repo = mkdtempSync(join(tmpdir(), 'agl1489-guard-'))
    const git = (...args) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
    git('init', '--quiet')
    git('config', 'user.email', 'test@aglyn.com')
    git('config', 'user.name', 'Guard Test')
    const rulesPath = join(repo, 'firebase-firestore.rules')
    writeFileSync(rulesPath, 'service cloud.firestore { /* v1 */ }\n')
    git('add', 'firebase-firestore.rules')
    git('commit', '--quiet', '-m', 'committed rules')
    return { repo, rulesPath }
  }

  it('a committed file passes', () => {
    const { repo, rulesPath } = makeRepo()
    try {
      const verdict = assertCleanDeploySource(rulesPath)
      assert.equal(verdict.ok, true)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('an uncommitted edit — the AGL-1489 near-miss state — throws', () => {
    const { repo, rulesPath } = makeRepo()
    try {
      // The planted violation: another session's rule block, present in the
      // worktree, absent from HEAD. Exactly what readFileSync would deploy.
      writeFileSync(
        rulesPath,
        'service cloud.firestore { /* v1 */ }\n' +
          'match /legalAcceptances/{version} { allow write: if false; }\n',
      )
      assert.throws(
        () => assertCleanDeploySource(rulesPath),
        /uncommitted modifications/,
      )
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('the same dirty state deploys under the typed escape hatch', () => {
    const { repo, rulesPath } = makeRepo()
    try {
      writeFileSync(rulesPath, 'service cloud.firestore { /* dirty */ }\n')
      const verdict = assertCleanDeploySource(rulesPath, { allowDirty: true })
      assert.equal(verdict.ok, true)
      assert.match(verdict.warning, /uncommitted/)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('a staged-but-uncommitted edit still refuses', () => {
    const { repo, rulesPath } = makeRepo()
    try {
      writeFileSync(rulesPath, 'service cloud.firestore { /* staged */ }\n')
      execFileSync('git', ['add', 'firebase-firestore.rules'], { cwd: repo })
      assert.throws(
        () => assertCleanDeploySource(rulesPath),
        /uncommitted modifications/,
      )
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('an untracked file refuses — it has no committed state at all', () => {
    const { repo } = makeRepo()
    try {
      const stray = join(repo, 'brand-new.rules')
      writeFileSync(stray, 'service cloud.firestore {}\n')
      assert.throws(() => assertCleanDeploySource(stray))
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('outside any git repo it refuses rather than guessing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agl1489-nogit-'))
    try {
      const stray = join(dir, 'firebase-firestore.rules')
      writeFileSync(stray, 'service cloud.firestore {}\n')
      // tmpdir must genuinely be outside a repo for this to mean anything.
      assert.throws(() =>
        execFileSync('git', ['rev-parse', '--git-dir'], {
          cwd: dir,
          stdio: 'pipe',
        }),
      )
      assert.throws(
        () => assertCleanDeploySource(stray),
        /could not verify/i,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the guard is wired into the deploy scripts', () => {
  // Asserted at the DECLARATION (the script source), because that is the
  // thing a refactor can silently drop. Remove the call — or move it after
  // the network write — and this goes red.
  for (const script of [
    'deploy-firestore-rules.mjs',
    'deploy-storage-rules.mjs',
    'deploy-database-rules.mjs',
  ]) {
    it(`${script} refuses a dirty tree before it deploys`, () => {
      const source = readFileSync(join(here, '..', script), 'utf8')
      const guardAt = source.indexOf('assertCleanDeploySource(')
      assert.notEqual(
        guardAt,
        -1,
        `${script} never calls assertCleanDeploySource — the dirty-tree ` +
          `refusal is not wired and the AGL-1489 near-miss is possible again`,
      )
      // The network write is either a literal fetch or a shared helper from
      // lib/firebase-rules-api.mjs (the database deploy PUTs through
      // databaseRulesRequest since AGL-1509).
      const firstNetworkWrite = ['fetch(', 'databaseRulesRequest(']
        .map((marker) => source.indexOf(marker))
        .filter((at) => at !== -1)
        .reduce((min, at) => Math.min(min, at), Infinity)
      assert.notEqual(
        firstNetworkWrite,
        Infinity,
        `${script} has no network call?`,
      )
      assert.ok(
        guardAt < firstNetworkWrite,
        `${script} calls the guard only after it has already started ` +
          `deploying — the refusal must come first`,
      )
    })
  }
})
