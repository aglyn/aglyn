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
 * AGL-1468: a total variant-generation failure must reach a surface.
 *
 * Measured on production 2026-08-13: **1 of 180 media documents has a
 * non-empty `variants` array**, and the last success was 2026-07-19. Every
 * upload since produced `variants: []`, a 200, and a `console.error` in a
 * serverless log with roughly an hour of retention. By the time anyone looked
 * for the cause there was nothing left to look at.
 *
 * So the assertion is not "variants are generated" — `media-variants.spec.ts`
 * in `tenant-data-admin` owns that, against real `sharp`, in bytes. The
 * assertion here is that the two routes which call it **write the outcome
 * down**: a `variantsError` on the document and a `variantFailures` counter.
 * Those two are what turn "why are thumbnails full-size?" into one query.
 *
 * A SOURCE guard rather than a route render, deliberately, and for the same
 * reason the bug survived three weeks: what went wrong is not the response —
 * the response was a correct 200 with a correct asset — it is which fields the
 * handler chose to persist. A test that drives the route with a mocked bucket
 * and asserts `status === 200` passes identically before and after the fix.
 * The regression is legible in the source and nowhere else.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(__dirname, '..', 'app', 'api', 'media')
const UPLOAD = join(API, 'upload', 'route.ts')
const REPLACE = join(API, 'replace', 'route.ts')
const HEALTH = join(__dirname, '..', 'app', 'api', 'health', 'route.ts')

/** Comments stripped — the rule has to be in the CODE, not the prose. */
const code = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const upload = code(UPLOAD)
const replace = code(REPLACE)
const health = code(HEALTH)

describe.each([
  ['upload', upload],
  ['replace', replace],
])('/api/media/%s records the variant outcome (AGL-1468)', (_name, source) => {
  it('generates through the shared helper, not a private sharp loop', () => {
    expect(source).toMatch(/generateMediaVariants\(/)
    // The exact regression: an inline `await import('sharp')` inside a catch
    // that returns nothing. Two copies is how the second one rots.
    expect(source).not.toMatch(/import\(['"]sharp['"]\)/)
  })

  it('persists the failure on the media document', () => {
    expect(source).toMatch(/variantsError/)
  })

  it('counts the failure, so the population can be asked', () => {
    expect(source).toMatch(/variantFailures/)
  })
})

describe('the deployment can say whether it can encode at all (AGL-1468)', () => {
  it('probes variant support from the health endpoint', () => {
    // The failure this issue is about is environmental: the same source
    // produced variants on 2026-07-19 and stopped. An upload is a poor probe
    // for that — it needs a session, a bucket write and a customer. This one
    // needs a GET.
    expect(health).toMatch(/probeMediaVariantSupport/)
  })

  it('does not let a thumbnail encoder decide the console is DOWN', () => {
    // `healthStatus` is "degraded if ANY check failed" and drives a 503.
    // Variant generation being unavailable is a degraded optimization, not an
    // outage, and paging for it would train everyone to ignore the endpoint.
    expect(health).not.toMatch(/checks\s*=\s*\{[^}]*imaging/)
  })
})
