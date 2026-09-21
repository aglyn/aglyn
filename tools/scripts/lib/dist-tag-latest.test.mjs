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

import { TAG, readTags, repoVersion, verdictFor } from '../dist-tag-latest.mjs'

/** What `npm view <pkg> dist-tags versions --json` actually answers. */
const viewJson = (body) => () => JSON.stringify([body])

describe('reading the registry answer (AGL-3201)', () => {
  it('unwraps the ARRAY npm returns for a multi-field view', () => {
    // The trap: `npm view` wraps the object in an array when more than one
    // field is asked for, and answers bare for one. Reading the multi-field
    // answer as an object gives `undefined` for every field — which reads as
    // "this package has no tags", and would move `latest` on a package whose
    // tags were simply never read.
    const answer = readTags(
      '@aglyn/aglyn',
      viewJson({ 'dist-tags': { latest: '1.0.0-beta.143' }, versions: ['1.0.0-beta.143'] }),
    )
    assert.equal(answer.tags.latest, '1.0.0-beta.143')
    assert.deepEqual(answer.versions, ['1.0.0-beta.143'])
  })

  it('reads a bare object too, in case npm ever stops wrapping', () => {
    const answer = readTags('@aglyn/aglyn', () =>
      JSON.stringify({ 'dist-tags': { latest: '2.0.0' }, versions: ['2.0.0'] }),
    )
    assert.equal(answer.tags.latest, '2.0.0')
  })

  it('reports an unreadable answer as an error, never as empty tags', () => {
    assert.ok(readTags('x', () => 'not json').error)
    assert.ok(readTags('x', viewJson({ error: { code: 'E404', summary: 'Not found' } })).error)
  })
})

describe('what to do about one package (AGL-3201)', () => {
  const V = '1.0.0-beta.146'

  it('moves a package whose latest is behind', () => {
    const v = verdictFor(
      { tags: { latest: '1.0.0-beta.143', beta: V }, versions: ['1.0.0-beta.143', V] },
      V,
    )
    assert.equal(v.state, 'move')
    assert.match(v.why, /1\.0\.0-beta\.143/)
  })

  it('leaves one that is already there', () => {
    assert.equal(
      verdictFor({ tags: { latest: V }, versions: [V] }, V).state,
      'ok',
    )
  })

  it('SKIPS a package the version was never published for', () => {
    // `@aglyn/cli` carries its own number, so the repo's version means
    // nothing to it. Moving `latest` there would point at a version that
    // does not exist — npm refuses, and counting that refusal as a failure
    // would make every run of this red.
    const v = verdictFor({ tags: { latest: '0.1.2' }, versions: ['0.1.2'] }, V)
    assert.equal(v.state, 'skip')
    assert.match(v.why, /not published/)
  })

  it('moves a package that has the version but NO latest at all', () => {
    assert.equal(verdictFor({ tags: {}, versions: [V] }, V).state, 'move')
  })

  it('never decides anything from an unread answer', () => {
    // The failure mode has to be "say so", not "move it anyway".
    assert.equal(verdictFor({ error: 'could not read the registry' }, V).state, 'error')
  })
})

describe('the version it targets (AGL-3201)', () => {
  it('is the one the repo carries, which is what release:prepare wrote', () => {
    const version = repoVersion()
    assert.match(version, /^\d+\.\d+\.\d+/)
  })

  it('names the tag a plain `npm install` reads', () => {
    assert.equal(TAG, 'latest')
  })
})
