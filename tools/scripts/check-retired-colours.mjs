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
 * Fail when a published marketing page reintroduces a retired colour
 * (AGL-1431). The detector and its rationale live in
 * `lib/retired-colours.mjs`; this file is the fetching half.
 *
 * ```
 * npm run check:retired-colours
 * node tools/scripts/check-retired-colours.mjs --refresh
 * node tools/scripts/check-retired-colours.mjs --base=https://aglyn.com /pricing
 * node tools/scripts/check-retired-colours.mjs --require-fresh --json
 * ```
 *
 * ## Why this runs against production on a schedule
 *
 * The regression it exists for arrived with NO COMMIT. `/pricing` was
 * re-authored in the besigner between 2026-08-08 and 08-11 and the retired
 * colours came back with the node data. Nothing in CI can see that, because
 * CI only ever sees code. The published site is the only place the defect is
 * observable, so the published site is what gets measured — the same argument
 * that puts `probe-uptime.mjs` on GitHub's runners rather than in a build.
 *
 * ## Why only a handful of routes
 *
 * Sweeping every marketing route costs ~40 Firestore reads per render and has
 * burned this project before. The named set below is the three surfaces the
 * AGL-1431 census covered: the page that regressed, and two that held. Two
 * clean routes are not padding — they are what proves a green run means the
 * detector still works, rather than that the fetch quietly returned nothing.
 *
 * ## ISR
 *
 * Marketing routes are ISR at 300s and the cache CANNOT be defeated from
 * outside: measured 2026-08-11, neither a cache-busting query string nor a
 * `Cache-Control: no-cache` request header changes `x-vercel-cache` (both
 * still served `HIT`, `age: 56`). So the check does not pretend to read live
 * content. It reads the cache state and lets the verdict inherit it, which is
 * asymmetric and in our favour:
 *
 *   * A VIOLATION is definitive regardless of cache state. Something was
 *     published that served the retired colour to real visitors. A stale read
 *     cannot manufacture a hex that was never rendered.
 *   * A CLEAN result is provisional. It describes a render up to `age`
 *     seconds old; anything published inside that window is not covered.
 *
 * `--refresh` narrows the window: a `STALE` read is itself what triggers
 * regeneration, so the check waits and re-reads to pick up the fresh render.
 * `--require-fresh` refuses to report a provisional pass as success (exit 2),
 * so a scheduled run can never bank a green off an old render.
 *
 * Exit codes: 0 clean · 1 retired colours found · 2 operational (unreachable,
 * or a provisional pass under `--require-fresh`).
 */

import {
  RETIRED_COLOURS,
  auditRenderedPage,
  describeFinding,
} from './lib/retired-colours.mjs'

const DEFAULT_BASE = 'https://aglyn.com'

/**
 * `/pricing` is the surface that regressed. `/` and `/product/media` are the
 * controls from the AGL-1431 census — they carry the AA token and must stay
 * at zero, which is what keeps a green run meaningful.
 */
const DEFAULT_ROUTES = ['/', '/pricing', '/product/media']

/** `revalidate` on the marketing screens. A clean read is stale up to this. */
const ISR_WINDOW_S = 300

const TIMEOUT_MS = 30_000
const REFRESH_WAIT_MS = Number(process.env.COLOUR_CHECK_REFRESH_MS ?? 9_000)

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const refresh = args.includes('--refresh')
const requireFresh = args.includes('--require-fresh')
// `??` is not enough here: an unset GitHub Actions `vars.*` arrives as an
// EMPTY STRING, not undefined, which would silently make every request a
// relative URL and fail the run for a reason that has nothing to do with
// colours. Take the first non-empty candidate.
const base = [
  args.find((arg) => arg.startsWith('--base='))?.slice('--base='.length),
  process.env.MARKETING_BASE_URL,
  DEFAULT_BASE,
]
  .find((candidate) => candidate?.trim())
  .trim()
  .replace(/\/$/, '')
const routes = args.filter((arg) => arg.startsWith('/'))
const targets = routes.length ? routes : DEFAULT_ROUTES

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One read, plus the cache facts the verdict depends on.
 *
 * `redirect: 'manual'` for the reason `probe-uptime.mjs` gives: a base that
 * 3xxes elsewhere would otherwise be measured under the wrong name, and this
 * repo has already shipped that misconfiguration once (AGL-786).
 */
async function read(path) {
  const response = await fetch(`${base}${path}`, {
    redirect: 'manual',
    headers: { 'user-agent': 'aglyn-retired-colour-check' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const age = Number(response.headers.get('age') ?? 0)
  return {
    status: response.status,
    location: response.headers.get('location'),
    cache: (response.headers.get('x-vercel-cache') ?? 'unknown').toUpperCase(),
    age: Number.isFinite(age) ? age : 0,
    html: response.status === 200 ? await response.text() : '',
  }
}

async function check(path) {
  let result
  try {
    result = await read(path)
    // A STALE read is the request that triggers regeneration. Waiting and
    // re-reading is the only way to narrow the window from out here.
    if (refresh && result.cache === 'STALE') {
      await wait(REFRESH_WAIT_MS)
      result = await read(path)
    }
  } catch (error) {
    return { path, error: String(error?.message ?? error) }
  }

  if (result.status >= 300 && result.status < 400)
    return {
      path,
      error: `redirects to ${result.location ?? '?'} — measure the host that SERVES it`,
    }
  if (result.status !== 200) return { path, error: `HTTP ${result.status}` }

  const { clean, findings } = auditRenderedPage(result.html, RETIRED_COLOURS)
  return {
    path,
    clean,
    findings,
    bytes: result.html.length,
    cache: result.cache,
    age: result.age,
    // A MISS is a render made for this request. Anything else describes a
    // render up to `age` seconds old.
    fresh: result.cache === 'MISS' || result.age === 0,
  }
}

const results = []
for (const path of targets) results.push(await check(path))

const failed = results.filter((r) => r.clean === false)
const errored = results.filter((r) => r.error)
const provisional = results.filter((r) => r.clean === true && !r.fresh)

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({ base, isrWindowSeconds: ISR_WINDOW_S, results }, null, 2)}\n`,
  )
} else {
  console.log(`retired colour census · ${base} · ${new Date().toISOString()}`)
  for (const result of results) {
    if (result.error) {
      console.log(`  ERROR ${result.path.padEnd(16)} ${result.error}`)
      continue
    }
    const provenance = `${result.cache.toLowerCase()}, age ${result.age}s`
    console.log(
      `  ${result.clean ? 'CLEAN' : 'FAIL '} ${result.path.padEnd(16)} ` +
        `${String(result.bytes).padStart(7)} bytes · ${provenance}`,
    )
    for (const finding of result.findings) {
      if (finding.violations === 0) continue
      console.log(`          ${describeFinding(finding)}`)
      console.log(
        `          retired by ${finding.retiredBy} — use ${finding.replacement}`,
      )
      console.log(`          ${finding.why}`)
    }
  }

  console.log('')
  if (failed.length) {
    // Say this plainly. The counts look absurd, and the instinct on seeing
    // "176" is to assume the measurement is wrong — it is not. One authored
    // decision was duplicated across 163 ✓ glyphs in the compare table.
    console.log(
      `${failed.length}/${results.length} route(s) serve a retired colour. ` +
        'This verdict does NOT depend on cache state: the bytes were ' +
        'published and real visitors received them.',
    )
  } else if (provisional.length) {
    console.log(
      `${results.length - errored.length} route(s) clean, but ` +
        `${provisional.length} read from cache — PROVISIONAL. Covers renders ` +
        `up to their reported age; the ISR window is ${ISR_WINDOW_S}s. ` +
        'Re-run with --refresh to narrow it.',
    )
  } else if (!errored.length) {
    console.log(`${results.length} route(s) clean on a fresh read.`)
  }
}

if (failed.length) process.exit(1)
if (errored.length) process.exit(2)
if (requireFresh && provisional.length) {
  console.error(
    'FAIL --require-fresh: a pass was only available from a cached render.',
  )
  process.exit(2)
}
process.exit(0)
