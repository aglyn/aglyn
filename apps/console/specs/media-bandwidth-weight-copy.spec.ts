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
 * THE WEIGHT IS STATED WHERE IT IS BILLED (AGL-3474).
 *
 * Video, audio and files count `ORIGIN_MEDIA_BANDWIDTH_WEIGHT`× toward
 * bandwidth, and that weight is derived — a cost basis or a rate that moves
 * re-derives it. A weight is a price, and a price rises on the page before it
 * reaches an invoice, so every surface that states it is held here to the
 * code's sentence: the docs that explain bandwidth, billing and the media
 * library, and the `/pricing` copy the generator emits. A weight that moves
 * turns this red until each of them says the new figure.
 *
 * Whitespace is collapsed before matching: the docs wrap their prose, and a
 * line break is not a different sentence.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ORIGIN_MEDIA_BANDWIDTH_SENTENCE,
  ORIGIN_MEDIA_BANDWIDTH_WEIGHT,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

const REPO_ROOT = join(__dirname, '..', '..', '..')

const prose = (relativePath: string) =>
  readFileSync(join(REPO_ROOT, relativePath), 'utf8').replace(/\s+/g, ' ')

describe('the origin-media weight is stated where it is billed (AGL-3474)', () => {
  it('names the derived weight', () => {
    expect(ORIGIN_MEDIA_BANDWIDTH_SENTENCE).toContain(
      `count ${ORIGIN_MEDIA_BANDWIDTH_WEIGHT}× toward bandwidth`,
    )
  })

  it.each([
    'apps/docs/docs/workspace-and-billing/billing-and-plans/bandwidth.md',
    'apps/docs/docs/workspace-and-billing/billing-and-plans/overview.md',
    'apps/docs/docs/content-and-data/media/overview.md',
  ])('%s states it', (relativePath) => {
    expect(prose(relativePath)).toContain(ORIGIN_MEDIA_BANDWIDTH_SENTENCE)
  })

  it('the /pricing copy the generator emits states it', () => {
    const tables = JSON.parse(
      readFileSync(join(REPO_ROOT, 'tools/marketing/pricing-copy/tables.json'), 'utf8'),
    )
    expect(tables.metered.mediaNote).toBe(ORIGIN_MEDIA_BANDWIDTH_SENTENCE)
  })

  it('no doc states a different weight', () => {
    for (const relativePath of [
      'apps/docs/docs/workspace-and-billing/billing-and-plans/bandwidth.md',
      'apps/docs/docs/workspace-and-billing/billing-and-plans/overview.md',
      'apps/docs/docs/content-and-data/media/overview.md',
    ]) {
      // Every decimal multiple the page prints is this weight; the integer
      // ones (the abuse ceiling's 3×) are other rules.
      const stated = [...prose(relativePath).matchAll(/(\d+\.\d+)\**×/g)].map((match) =>
        Number(match[1]),
      )
      expect(stated.length).toBeGreaterThan(0)
      expect(new Set(stated)).toEqual(new Set([ORIGIN_MEDIA_BANDWIDTH_WEIGHT]))
    }
  })
})
