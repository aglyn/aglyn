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

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseShard, shardConfigs } from './typecheck-shard.mjs'

const list = (n) => Array.from({ length: n }, (_, i) => `c${String(i).padStart(3, '0')}`)

describe('shardConfigs covers every config exactly once (AGL-2505)', () => {
  // THE property. A shard map that drops a config yields a green typecheck
  // that never compiled it, and nothing downstream can tell that apart from a
  // real pass — so this is asserted over a spread of sizes rather than one.
  for (const count of [0, 1, 2, 3, 7, 145, 146]) {
    for (const total of [1, 2, 3, 4, 8]) {
      it(`${count} configs over ${total} shard(s) is a partition`, () => {
        const configs = list(count)
        const shards = Array.from({ length: total }, (_, i) =>
          shardConfigs(configs, i + 1, total),
        )
        assert.deepEqual(shards.flat(), configs, 'union must be the input, in order')

        const seen = new Set(shards.flat())
        assert.equal(seen.size, count, 'no config may appear in two shards')

        // Balanced to within one, or one runner becomes the critical path
        // again and the split has bought nothing.
        const sizes = shards.map((s) => s.length)
        assert.ok(
          Math.max(...sizes) - Math.min(...sizes) <= 1,
          `shard sizes ${sizes.join(',')} differ by more than one`,
        )
      })
    }
  }

  it('keeps a directory’s sibling configs together', () => {
    // tsconfig.lib.json and tsconfig.spec.json for one project should land on
    // the same runner where possible — contiguous slicing is what does that,
    // and a round-robin rewrite would silently lose it.
    const configs = ['a/lib', 'a/spec', 'b/lib', 'b/spec', 'c/lib', 'c/spec']
    assert.deepEqual(shardConfigs(configs, 1, 3), ['a/lib', 'a/spec'])
    assert.deepEqual(shardConfigs(configs, 2, 3), ['b/lib', 'b/spec'])
    assert.deepEqual(shardConfigs(configs, 3, 3), ['c/lib', 'c/spec'])
  })

  it('refuses a shard index outside the range', () => {
    assert.throws(() => shardConfigs(list(9), 0, 3), /out of range/)
    assert.throws(() => shardConfigs(list(9), 4, 3), /out of range/)
    assert.throws(() => shardConfigs(list(9), 1, 0), /out of range/)
    assert.throws(() => shardConfigs(list(9), 1.5, 3), /whole numbers/)
  })
})

describe('parseShard', () => {
  it('reads i/n and ignores unrelated flags', () => {
    assert.deepEqual(parseShard(['--shard=2/4']), { index: 2, total: 4 })
    assert.deepEqual(parseShard(['libs/aglyn', '--shard=1/3']), { index: 1, total: 3 })
    assert.equal(parseShard(['--changed', 'libs/aglyn']), null)
    assert.equal(parseShard([]), null)
  })

  it('THROWS on a malformed value rather than ignoring it', () => {
    // The failure mode this guards: a dropped sharding flag means every shard
    // compiles everything, four green runners, and no signal that the split
    // never happened.
    assert.throws(() => parseShard(['--shard']), /expects i\/n/)
    assert.throws(() => parseShard(['--shard=1']), /expects i\/n/)
    assert.throws(() => parseShard(['--shard=1of3']), /expects i\/n/)
    assert.throws(() => parseShard(['--shard=a/b']), /expects i\/n/)
  })
})
