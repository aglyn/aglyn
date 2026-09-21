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
  TAG,
  probeWriteAccess,
  readTags,
  repoVersion,
  tagsFor,
  verdictFor,
} from '../dist-tags.mjs'

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
    assert.deepEqual(v.tags, ['latest'])
    assert.match(v.why, /1\.0\.0-beta\.143/)
  })

  it('leaves one whose every tag is already there', () => {
    assert.equal(
      verdictFor({ tags: { latest: V, beta: V }, versions: [V] }, V).state,
      'ok',
    )
  })

  it("moves the prerelease's OWN label too, which the publish could not set", () => {
    // `npm publish --tag` takes ONE tag. While no release exists the publish
    // spends it on `latest`, so `beta` is the one left behind — and after a
    // release ships the job runs the other way round. Either way a second tag
    // exists that nothing set, which is the whole reason this script does.
    const v = verdictFor({ tags: { latest: V, beta: '1.0.0-beta.143' }, versions: [V] }, V)
    assert.equal(v.state, 'move')
    assert.deepEqual(v.tags, ['beta'])
  })

  it('moves BOTH when neither is there', () => {
    const v = verdictFor({ tags: {}, versions: [V] }, V)
    assert.deepEqual(v.tags, ['latest', 'beta'])
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

  it('agrees with the publish about which tag a version belongs on', () => {
    /*
     * The two must never disagree, or every run would move a tag the publish
     * had just set the other way. `tagsFor` asks `distTagFor` rather than
     * repeating its rule.
     */
    assert.deepEqual(tagsFor(V, ['1.0.0-beta.1', V]), ['latest', 'beta'])
    // A release owns `latest` and has no second tag at all.
    assert.deepEqual(tagsFor('1.0.0', ['1.0.0']), ['latest'])
  })

  it('NEVER drags `latest` onto a beta once a release exists', () => {
    /*
     * The load-bearing one. While nothing stable has shipped a beta takes
     * `latest`, because the alternative is a default install that does not
     * work. The moment `1.0.0` exists that stops being true — `latest` is the
     * release's, and a run of this script must not walk it back onto a
     * prerelease. So a beta then owns `beta` and nothing else.
     */
    assert.deepEqual(tagsFor(V, ['1.0.0', V]), ['beta'])
    const v = verdictFor({ tags: { latest: '1.0.0', beta: V }, versions: ['1.0.0', V] }, V)
    assert.equal(v.state, 'ok')
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

describe('proving this runner may move a tag at all (AGL-3201)', () => {
  const TAGS = { latest: '1.0.0-beta.146', beta: '1.0.0-beta.146' }

  it('rewrites an EXISTING tag to the value it already has', () => {
    const calls = []
    const answer = probeWriteAccess('@aglyn/x', TAGS, (args) => {
      calls.push(args.join(' '))
      return ''
    })
    assert.equal(answer.ok, true)
    assert.deepEqual(calls, ['dist-tag add @aglyn/x@1.0.0-beta.146 latest'])
  })

  it('writes NOTHING that would have to be undone', () => {
    /*
     * The first version of this wrote a throwaway tag and deleted it, and the
     * publish token is allowed to ADD a dist-tag and refused (403) on DELETE
     * — so it proved write access and then could not clean up after itself,
     * leaving `ci-auth-probe` on a real package. A probe that needs a second
     * permission to undo its own first one is not a probe.
     *
     * So the only call it makes sets a tag to what it already was: a real
     * authenticated write, and a no-op in its effect, with nothing left
     * behind even if the run is killed immediately after.
     */
    const calls = []
    probeWriteAccess('@aglyn/x', TAGS, (args) => {
      calls.push(args)
      return ''
    })
    assert.equal(calls.length, 1)
    assert.ok(!calls.some((args) => args.includes('rm')))
    const [, , spec, tag] = calls[0]
    assert.equal(spec, `@aglyn/x@${TAGS[tag]}`, 'the tag is set to its own current value')
  })

  it('reports NO when the write is refused', () => {
    const answer = probeWriteAccess('@aglyn/x', TAGS, () => {
      throw new Error('E403 Forbidden')
    })
    assert.equal(answer.ok, false)
    assert.match(answer.why, /E403/)
  })

  it('says so rather than guessing when there is no tag to rewrite', () => {
    assert.equal(probeWriteAccess('@aglyn/x', {}, () => '').ok, false)
    assert.equal(probeWriteAccess('@aglyn/x', undefined, () => '').ok, false)
  })
})
