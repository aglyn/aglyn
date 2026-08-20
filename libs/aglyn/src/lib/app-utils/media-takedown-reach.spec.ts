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
 * What a media takedown reaches, and what it does not (AGL-1615).
 *
 * This file exists because the gap it guards is not a bug in code — it is a
 * gap between what the console TELLS an operator and what the mechanism can
 * actually do. The staff quarantine page said a takedown "takes ONE uploaded
 * file off the CDN worldwide". A rights-holder or a merchant reading that
 * reasonably concludes the file is gone. It is not: it stops at our origin,
 * and every copy a cache already holds keeps serving out its own window.
 *
 * Two properties, and the second is the one that rots:
 *
 *  1. **The claims are complete and honest.** Every delivery surface an
 *     asset can be served from appears, including the ones a takedown cannot
 *     touch at all, and the unreachable ones are named rather than omitted.
 *     An omitted surface is indistinguishable from a covered one.
 *  2. **The numbers are the REAL numbers.** These windows are `max-age` and
 *     `s-maxage` values that live in `serve-media-cdn.ts`. Copy that quotes
 *     them is copy that goes stale the first time someone tunes a header —
 *     and stale copy here is worse than none, because it is specific and
 *     wrong. So the drift guard below reads those constants out of the
 *     source and fails when they move.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import {
  MEDIA_TAKEDOWN_BROWSER_IMMUTABLE_MS,
  MEDIA_TAKEDOWN_BROWSER_STABLE_MS,
  MEDIA_TAKEDOWN_EDGE_IMAGE_MS,
  MEDIA_TAKEDOWN_ORIGIN_MS,
  MEDIA_TAKEDOWN_REACH,
  mediaTakedownReachLines,
  mediaTakedownUnreachableLine,
} from './media-takedown-reach'

const cdnSource = () =>
  readFileSync(
    join(
      process.cwd(),
      'libs/tenant/data/admin/src/lib/server/serve-media-cdn.ts',
    ),
    'utf8',
  )

const directive = (constant: string, name: string): number => {
  const source = cdnSource()
  const block = source.slice(source.indexOf(`export const ${constant} =`))
  const value = block.slice(0, 400).match(new RegExp(`${name}=(\\d+)`))
  if (!value) throw new Error(`no ${name} in ${constant}`)
  return Number(value[1]) * 1000
}

describe('the windows are the ones the CDN actually sends', () => {
  it('the browser window on the stable URL matches its max-age', () => {
    expect(MEDIA_TAKEDOWN_BROWSER_STABLE_MS).toBe(
      directive('MEDIA_CDN_STABLE_CACHE_CONTROL', 'max-age'),
    )
  })

  it('the edge window on an image matches its s-maxage', () => {
    expect(MEDIA_TAKEDOWN_EDGE_IMAGE_MS).toBe(
      directive('MEDIA_CDN_STABLE_CACHE_CONTROL', 's-maxage'),
    )
  })

  it('the immutable browser pin matches its max-age', () => {
    expect(MEDIA_TAKEDOWN_BROWSER_IMMUTABLE_MS).toBe(
      directive('MEDIA_CDN_IMMUTABLE_CACHE_CONTROL', 'max-age'),
    )
  })

  it('the origin lag matches the deny list and lock TTLs, which agree', () => {
    const source = cdnSource()
    const lock = source.match(/MEDIA_CDN_LOCK_TTL_MS = (\d+)_?(\d*)/)
    expect(lock).toBeTruthy()
    expect(MEDIA_TAKEDOWN_ORIGIN_MS).toBe(Number(`${lock?.[1]}${lock?.[2]}`))
  })
})

describe('the reach model refuses to flatter the mechanism', () => {
  it('names a surface a takedown CANNOT reach', () => {
    // The whole point. A model in which everything is `stopped: true` is a
    // model that would let the old "off the CDN worldwide" copy stand.
    expect(MEDIA_TAKEDOWN_REACH.some((entry) => !entry.stopped)).toBe(true)
  })

  it('covers the immutable URL, which is out of reach by design', () => {
    const immutable = MEDIA_TAKEDOWN_REACH.find(
      (entry) => entry.surface === 'browser-immutable',
    )
    expect(immutable).toBeTruthy()
    expect(immutable?.stopped).toBe(false)
  })

  it('covers the raw Storage URL, which no code of ours serves', () => {
    // AGL-1526's territory, and the reason quarantine needed a lever of its
    // own: a free-tier or pre-AGL-829 asset is delivered from Google's edge,
    // where our deny list is not consulted at all.
    const raw = MEDIA_TAKEDOWN_REACH.find((entry) => entry.surface === 'raw-url')
    expect(raw).toBeTruthy()
  })

  it('gives every stoppable surface a bounded worst case', () => {
    for (const entry of MEDIA_TAKEDOWN_REACH) {
      if (!entry.stopped) continue
      expect(typeof entry.worstCaseMs).toBe('number')
      expect(entry.worstCaseMs).toBeGreaterThan(0)
    }
  })

  it('gives every UNstoppable surface no window at all, rather than a big one', () => {
    // `worstCaseMs: 31536000000` would read as "a year and then it is fine",
    // which is a different and false claim: a copy on a scraper's disk has
    // no expiry.
    for (const entry of MEDIA_TAKEDOWN_REACH) {
      if (entry.stopped) continue
      expect(entry.worstCaseMs).toBeNull()
    }
  })

  it('states the residual in words an operator can act on', () => {
    const lines = mediaTakedownReachLines()
    expect(lines.length).toBe(MEDIA_TAKEDOWN_REACH.length)
    for (const line of lines) expect(line.length).toBeGreaterThan(20)
  })

  it('never claims a takedown is a recall', () => {
    const everything = [
      ...mediaTakedownReachLines(),
      mediaTakedownUnreachableLine(),
    ]
      .join(' ')
      .toLowerCase()
    expect(everything).toContain('not a recall')
    // The four places bytes go that we have no lever over at all. Naming
    // them is the difference between an honest limit and a vague hedge.
    for (const place of ['browser', 'cdn', 'scraper', 'archive']) {
      expect(everything).toContain(place)
    }
  })
})
