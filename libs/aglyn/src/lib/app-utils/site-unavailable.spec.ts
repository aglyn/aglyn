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

import { BANDWIDTH_CAP_RETRY_AFTER_SECONDS } from './bandwidth-cap'
import {
  isHostInMaintenance,
  SITE_UNAVAILABLE_RETRY_AFTER_SECONDS,
  siteUnavailableForRequest,
} from './site-unavailable'

const PUBLIC = { entryPreview: false, teamPreview: false }
const TEAM = { entryPreview: false, teamPreview: true }
const ENTRY = { entryPreview: true, teamPreview: false }

describe('maintenance mode is read as the loader reads it (AGL-4110)', () => {
  it('any truthy field is maintenance, exactly like the loader test it replaces', () => {
    expect(isHostInMaintenance({ maintenance: true })).toBe(true)
    expect(isHostInMaintenance({ maintenance: 1 })).toBe(true)
    for (const maintenance of [undefined, null, false, 0, '']) {
      expect(isHostInMaintenance({ maintenance })).toBe(false)
    }
    expect(isHostInMaintenance(null)).toBe(false)
    expect(isHostInMaintenance(undefined)).toBe(false)
  })
})

describe('which page requests answer 503 (AGL-4110)', () => {
  it('maintenance: everyone, the team included', () => {
    expect(siteUnavailableForRequest({ maintenance: true }, PUBLIC)).toBe(true)
    expect(siteUnavailableForRequest({ maintenance: true }, TEAM)).toBe(true)
    expect(
      siteUnavailableForRequest({ maintenance: true, preview: true }, TEAM),
    ).toBe(true)
  })

  it('a site in preview: the public, never the team routed around the cache', () => {
    expect(siteUnavailableForRequest({ preview: true }, PUBLIC)).toBe(true)
    expect(siteUnavailableForRequest({ preview: true }, TEAM)).toBe(false)
  })

  it('an entry preview link is left to its route, which redirects', () => {
    expect(siteUnavailableForRequest({ maintenance: true }, ENTRY)).toBe(false)
    expect(siteUnavailableForRequest({ preview: true }, ENTRY)).toBe(false)
  })

  it('a site in neither mode, or a verdict that says nothing, is untouched', () => {
    expect(siteUnavailableForRequest({}, PUBLIC)).toBe(false)
    expect(
      siteUnavailableForRequest({ maintenance: false, preview: false }, PUBLIC),
    ).toBe(false)
    expect(siteUnavailableForRequest(null, PUBLIC)).toBe(false)
    expect(siteUnavailableForRequest(undefined, PUBLIC)).toBe(false)
  })

  it('only an explicit true counts: an older verdict cannot take a site down', () => {
    expect(
      siteUnavailableForRequest({ maintenance: 'true' as never }, PUBLIC),
    ).toBe(false)
    expect(siteUnavailableForRequest({ preview: 1 as never }, PUBLIC)).toBe(false)
  })
})

describe('Retry-After (AGL-4110)', () => {
  it('is an hour, the bandwidth cap figure, because both end at a switch', () => {
    expect(SITE_UNAVAILABLE_RETRY_AFTER_SECONDS).toBe(3600)
    expect(SITE_UNAVAILABLE_RETRY_AFTER_SECONDS).toBe(
      BANDWIDTH_CAP_RETRY_AFTER_SECONDS,
    )
  })
})
