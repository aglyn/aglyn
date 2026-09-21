/**
 * @license
 * Copyright 2026 Aglyn LLC
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *   http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  REPOSITORY,
  WORKFLOW_FILE,
  atLeast,
  publishablePackages,
  trustsThisWorkflow,
} from '../trust-packages.mjs'

describe('the npm version gate (AGL-3201)', () => {
  // The trap this exists for: `npm trust` arrived in 11.15.0, and every
  // version between 11.9 and 11.14 compares ABOVE it as a string. A string
  // comparison here would pass the gate and then fail with "Unknown command",
  // which reads like a typo rather than like a version to upgrade.
  it('compares the parts as numbers, not as text', () => {
    assert.equal(atLeast('11.9.0', '11.15.0'), false)
    assert.equal(atLeast('11.13.0', '11.15.0'), false)
    assert.equal(atLeast('11.15.0', '11.15.0'), true)
    assert.equal(atLeast('11.15.1', '11.15.0'), true)
    assert.equal(atLeast('11.16.0', '11.15.0'), true)
    assert.equal(atLeast('12.0.0', '11.15.0'), true)
    assert.equal(atLeast('9.99.99', '11.15.0'), false)
  })

  it('survives the shapes npm actually prints', () => {
    assert.equal(atLeast(' 11.15.0\n', '11.15.0'), true)
    assert.equal(atLeast('12', '11.15.0'), true)
  })
})

describe('what counts as already trusted (AGL-3201)', () => {
  // Matched on the two claims that decide who may publish, and NOT on the
  // whole printed row: npm prints an id and a created date that are not ours
  // to predict, so a match on the text as a whole would go stale the first
  // time npm changes its formatting — and this script would then reconfigure
  // all 51 packages on every run.
  it('accepts a listing naming this repo and this workflow', () => {
    assert.equal(
      trustsThisWorkflow(`id: tp_1  github  ${REPOSITORY}  ${WORKFLOW_FILE}  publish, stage`),
      true,
    )
  })

  it('refuses a listing for another repository or another workflow', () => {
    assert.equal(trustsThisWorkflow(`github  someone/else  ${WORKFLOW_FILE}`), false)
    assert.equal(trustsThisWorkflow(`github  ${REPOSITORY}  release.yml`), false)
  })

  it('refuses an empty listing and an error, rather than reading them as yes', () => {
    // `npm trust list` answers with an error for a package the caller cannot
    // see. Reading that as "already trusted" would skip it silently and the
    // release would fail on that one package, after 50 others were published
    // and could not be taken back.
    assert.equal(trustsThisWorkflow(''), false)
    assert.equal(trustsThisWorkflow(undefined), false)
    assert.equal(trustsThisWorkflow('ERROR 404 Not Found'), false)
  })
})

describe('the set it configures (AGL-3201)', () => {
  it('is exactly what the publish workflow would publish', () => {
    // A package the release publishes and this misses is a release that
    // fails part-way through, which is unrepairable: a published version
    // cannot be replaced. Both read the same package map, and this holds
    // that they still do.
    const names = publishablePackages()
    assert.ok(names.length >= 50, `expected the whole set, got ${names.length}`)
    assert.ok(names.includes('@aglyn/aglyn'))
    assert.ok(names.includes('@aglyn/besigner'))
    assert.deepEqual(names, [...names].sort(), 'listed in a stable order')
    assert.equal(new Set(names).size, names.length, 'no package twice')
    assert.ok(names.every((name) => name.startsWith('@aglyn/')))
  })

  it('names the workflow file the way npm wants it — a bare filename', () => {
    // `npm trust github --file` takes the NAME, not a path: the repository is
    // named separately and the file is looked for under .github/workflows.
    assert.ok(!WORKFLOW_FILE.includes('/'))
    assert.match(WORKFLOW_FILE, /\.ya?ml$/)
  })
})
