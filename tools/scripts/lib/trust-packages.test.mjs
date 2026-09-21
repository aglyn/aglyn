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
  PUBLISH_PERMISSION,
  REPOSITORY,
  WORKFLOW_FILE,
  atLeast,
  publishablePackages,
  readTrust,
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
  it('accepts a listing naming this repo, this workflow and publish rights', () => {
    assert.equal(
      trustsThisWorkflow(
        `id: tp_1  github  ${REPOSITORY}  ${WORKFLOW_FILE}  ${PUBLISH_PERMISSION}`,
      ),
      true,
    )
  })

  it('REFUSES a stage-only configuration, which otherwise looks configured', () => {
    // The trap: a row created after 2026-09-03 permits staged publishing
    // only unless publishing was asked for explicitly. It appears on every
    // listing and refuses the release — and a version that failed to publish
    // cannot be published again under the same number.
    assert.equal(
      trustsThisWorkflow(
        JSON.stringify({
          repository: REPOSITORY,
          file: WORKFLOW_FILE,
          permissions: ['createStagedPackage'],
        }),
      ),
      false,
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

describe('telling "not signed in" from "configured nothing" (AGL-3201)', () => {
  // `npm trust list` is NOT public — it answers EOTP to anyone not signed in
  // with the account's second factor, even for a public package. Reading that
  // as an empty listing would report all 51 packages as missing, and send
  // somebody to reconfigure 51 that are already correct.
  const eotp = JSON.stringify({
    error: { code: 'EOTP', summary: 'This operation requires a one-time password.' },
  })

  it('reports a signed-out read as unauthenticated, not as empty', () => {
    const answer = readTrust('@aglyn/aglyn', () => eotp)
    assert.equal(answer.unauthenticated, true)
    assert.equal(trustsThisWorkflow(answer.listing), false)
  })

  for (const code of ['ENEEDAUTH', 'E401']) {
    it(`treats ${code} the same way`, () => {
      const body = JSON.stringify({ error: { code, summary: code } })
      assert.equal(readTrust('@aglyn/aglyn', () => body).unauthenticated, true)
    })
  }

  it('a real error is NOT unauthenticated — it is a package that failed', () => {
    const body = JSON.stringify({ error: { code: 'E404', summary: 'Not found' } })
    const answer = readTrust('@aglyn/nope', () => body)
    assert.notEqual(answer.unauthenticated, true)
    assert.equal(answer.error, 'Not found')
    assert.equal(trustsThisWorkflow(answer.listing), false)
  })

  it('finds this workflow in a real listing shape', () => {
    const body = JSON.stringify([
      {
        id: 'tp_abc',
        type: 'github',
        claims: { repository: REPOSITORY, workflow_filename: WORKFLOW_FILE },
        permissions: [PUBLISH_PERMISSION, 'createStagedPackage'],
      },
    ])
    assert.equal(trustsThisWorkflow(readTrust('x', () => body).listing), true)
  })

  it('does not find it in a listing for another repository', () => {
    const body = JSON.stringify([
      {
        id: 'tp_abc',
        type: 'github',
        claims: { repository: 'someone/else', workflow_filename: WORKFLOW_FILE },
        permissions: [PUBLISH_PERMISSION],
      },
    ])
    assert.equal(trustsThisWorkflow(readTrust('x', () => body).listing), false)
  })

  it('survives output that is not JSON at all', () => {
    // An npm too old for `--json` on this subcommand, or a crash. The text
    // is taken as the listing, and the claim match refuses anything that
    // does not name both of them.
    assert.equal(trustsThisWorkflow(readTrust('x', () => 'whatever').listing), false)
    assert.equal(
      trustsThisWorkflow(
        readTrust('x', () => `github ${REPOSITORY} ${WORKFLOW_FILE} ${PUBLISH_PERMISSION}`)
          .listing,
      ),
      true,
    )
  })
})
