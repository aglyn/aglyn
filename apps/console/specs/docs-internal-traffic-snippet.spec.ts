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
 * The docs site's copy of the internal-traffic snippet cannot drift
 * (AGL-2064).
 *
 * `apps/docs` is a Docusaurus app in its own Vercel project and cannot import
 * from `libs/` (AGL-1595) — the same constraint that puts the measurement id
 * in its source. So the snippet is duplicated there, and a duplicate that is
 * merely intended to match is exactly the kind of check that quietly stops
 * being true: a stale copy still reads as a working stamp, still runs without
 * error, and stamps a parameter nobody is filtering on. Nothing in any GA
 * report would show it.
 *
 * `docs.aglyn.com` matters here more than its traffic volume suggests. We read
 * our own docs constantly while building, logged out, on the surface the
 * September activation funnel treats as the top of the path — and the console's
 * AGL-1582 stamp cannot reach a logged-out reader on another origin.
 *
 * Planted red (verified): change one character of either copy.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  INTERNAL_TRAFFIC_GTAG_SNIPPET,
  INTERNAL_TRAFFIC_PARAM,
  INTERNAL_TRAFFIC_VALUE,
} from '@aglyn/aglyn/app-utils/internal-traffic'

const DOCS_CONFIG = resolve(__dirname, '../../docs/docusaurus.config.ts')

describe('the docs internal-traffic snippet (AGL-2064)', () => {
  const source = readFileSync(DOCS_CONFIG, 'utf8')

  it('is character-for-character the shared constant', () => {
    expect(source).toContain(INTERNAL_TRAFFIC_GTAG_SNIPPET)
  })

  it('is queued INTO the head snippet that defines gtag', () => {
    // The snippet assumes a `gtag` function exists and pushes into the same
    // dataLayer the preset's own script later reads. In a headTag of its own
    // it would throw on an undefined `gtag` and take `content_group` with it.
    const head = source.slice(source.indexOf('headTags:'))
    const shim = head.indexOf("function gtag(){dataLayer.push(arguments);}")
    const stamp = head.indexOf(INTERNAL_TRAFFIC_GTAG_SNIPPET)
    expect(shim).toBeGreaterThan(-1)
    expect(stamp).toBeGreaterThan(shim)
  })

  it('still carries content_group, which it must not have displaced', () => {
    // Both are `set` calls into one queue and the obvious edit replaces one
    // with the other. Losing `content_group` would silently merge docs into
    // the marketing and console reports.
    expect(source).toContain("gtag('set',{'content_group':'docs'});")
    expect(source).toContain(
      `gtag('set',{'${INTERNAL_TRAFFIC_PARAM}':'${INTERNAL_TRAFFIC_VALUE}'});`,
    )
  })
})
