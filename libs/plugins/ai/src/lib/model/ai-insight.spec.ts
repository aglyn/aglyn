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

import {
  AI_INSIGHT_ASK_SURFACES,
  AI_INSIGHT_SURFACE_READERS,
  aiInsightSurface,
  aiInsightSurfaceForPath,
  aiInsightSurfaceNeedsSite,
} from './ai-insight'

/**
 * Where an insight may be asked (AGL-2915, widened at AGL-3603), and which
 * readers each place offers by the first word of a reader's id.
 */

describe('the insight surface for a console path', () => {
  it.each([
    ['/acme/hosts/shop/analytics', { surface: 'analytics', host: 'shop' }],
    ['/acme/hosts/shop', { surface: 'analytics', host: 'shop' }],
    ['/acme/hosts/shop/data/orders', { surface: 'datasets', host: 'shop' }],
    ['/acme/hosts/shop/crm/reports', { surface: 'crm-reports', host: 'shop' }],
    ['/acme/hosts/shop/automation/actions', { surface: 'automations', host: 'shop' }],
    ['/acme/hosts/shop/bookings?tab=services', { surface: 'bookings', host: 'shop' }],
    ['/acme/data', { surface: 'datasets', host: null }],
    ['/acme/hosts', { surface: 'workspace', host: null }],
    ['/acme/crm/reports', { surface: 'workspace', host: null }],
  ])('%s', (path, expected) => {
    expect(aiInsightSurfaceForPath(path)).toEqual(expected)
  })

  it('offers none off those pages', () => {
    expect(aiInsightSurfaceForPath('/acme/hosts/shop/screens')).toBeNull()
    expect(aiInsightSurfaceForPath('/acme/billing')).toBeNull()
    expect(aiInsightSurfaceForPath(null)).toBeNull()
  })
})

describe('the readers each surface offers', () => {
  it('reads automation runs and the pipeline on a site’s Analytics, runs alone on Automation, and the pipeline at the workspace', () => {
    expect(AI_INSIGHT_SURFACE_READERS.analytics).toEqual(expect.arrayContaining(['automations', 'crm', 'bookings']))
    expect(AI_INSIGHT_SURFACE_READERS['crm-reports']).toContain('crm')
    expect(AI_INSIGHT_SURFACE_READERS.automations).toEqual(['automations'])
    expect(AI_INSIGHT_SURFACE_READERS.bookings).toEqual(['bookings'])
    expect(AI_INSIGHT_SURFACE_READERS.workspace).toEqual(['crm', 'datasets'])
    // The weekly digest reads what it always read.
    expect(AI_INSIGHT_SURFACE_READERS.digest).not.toContain('crm')
  })

  it('is asked from every surface but the digest, and needs a site except at the workspace', () => {
    expect(AI_INSIGHT_ASK_SURFACES).not.toContain('digest')
    for (const surface of AI_INSIGHT_ASK_SURFACES) expect(aiInsightSurface({ surface })).toBe(surface)
    expect(aiInsightSurfaceNeedsSite('workspace')).toBe(false)
    expect(aiInsightSurfaceNeedsSite('automations')).toBe(true)
  })
})
