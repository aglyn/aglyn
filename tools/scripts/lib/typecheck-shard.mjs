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

// The pure half of typecheck sharding (AGL-2505).
//
// `npm run typecheck` compiles 145 tsconfigs and was 5m49s of CI — the single
// longest thing left once the jest suite was sharded, and therefore the floor
// on how fast a promotion can be verified. The script already parallelises
// internally, but a GitHub runner has 4 vCPU, so the only way further down is
// more machines.
//
// Splitting a gate is the kind of change that fails SILENTLY: a shard map that
// drops a config produces a green typecheck that never compiled it, which is
// indistinguishable from a real pass. So the map is pure, exported and tested
// here, separately from the script that runs the compiler.

/**
 * Take one shard's contiguous slice of a sorted config list.
 *
 * Contiguous rather than round-robin on purpose: sibling configs in one
 * directory (`tsconfig.lib.json` next to `tsconfig.spec.json`) then land on
 * the same runner, which is where the compiler's own caching helps most.
 *
 * The first `configs.length % total` shards take one extra config, so slice
 * sizes differ by at most one and the union over `i in 1..total` is exactly
 * the input — no config compiled twice, none skipped.
 *
 * @param {string[]} configs Sorted config paths.
 * @param {number} index 1-based shard number.
 * @param {number} total Shard count.
 * @returns {string[]} This shard's slice.
 */
export function shardConfigs(configs, index, total) {
  if (!Number.isInteger(index) || !Number.isInteger(total)) {
    throw new Error(`--shard needs whole numbers, got ${index}/${total}`)
  }
  if (total < 1 || index < 1 || index > total) {
    throw new Error(`--shard=${index}/${total} is out of range`)
  }
  const size = Math.floor(configs.length / total)
  const extra = configs.length % total
  const start = (index - 1) * size + Math.min(index - 1, extra)
  const end = start + size + (index - 1 < extra ? 1 : 0)
  return configs.slice(start, end)
}

/**
 * Parse `--shard=i/n` out of argv, or null when it is absent.
 *
 * Throws on a malformed value rather than ignoring it. An unrecognised
 * sharding flag that is silently dropped is the failure this whole module
 * exists to prevent: every shard would compile everything and still be green.
 *
 * @param {string[]} args
 * @returns {{index: number, total: number} | null}
 */
export function parseShard(args) {
  const raw = args.find((a) => a.startsWith('--shard'))
  if (!raw) return null
  const match = /^--shard=(\d+)\/(\d+)$/.exec(raw)
  if (!match) {
    throw new Error(`--shard expects i/n (e.g. --shard=1/3), got "${raw}"`)
  }
  return { index: Number(match[1]), total: Number(match[2]) }
}
