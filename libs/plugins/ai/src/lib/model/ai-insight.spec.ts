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
} from './ai-insight'

/**
 * Where an insight is asked from (AGL-2915, AGL-3603): the console paths whose
 * Assist panel offers "Ask about your numbers", and the Marketing page's own
 * surface, which reads its campaigns' figures beside the traffic and sales.
 */
describe('the surface a console path asks from', () => {
  it.each([
    ['/acme/hosts/shop/analytics', { surface: 'analytics', host: 'shop' }],
    ['/acme/hosts/shop/crm/reports', { surface: 'crm-reports', host: 'shop' }],
    ['/acme/hosts/shop/marketing', { surface: 'marketing', host: 'shop' }],
    ['/acme/hosts/shop/marketing/conversions', { surface: 'marketing', host: 'shop' }],
    ['/acme/hosts/shop/marketing/campaigns/send-1?tab=report', { surface: 'marketing', host: 'shop' }],
    ['/acme/data', { surface: 'datasets', host: null }],
  ])('%s', (path, expected) => {
    expect(aiInsightSurfaceForPath(path)).toEqual(expected)
  })

  it.each(['/acme/marketing', '/acme/marketing/conversions', '/acme/hosts/shop/screens', '/acme'])(
    'offers none on %s, whose figures are no one site’s or no figures at all',
    (path) => {
      expect(aiInsightSurfaceForPath(path)).toBeNull()
    },
  )
})

describe('the Marketing surface', () => {
  it('is one a person asks from, and a job may name', () => {
    expect(AI_INSIGHT_ASK_SURFACES).toContain('marketing')
    expect(aiInsightSurface({ surface: 'marketing' })).toBe('marketing')
  })

  it('reads its campaigns’ figures and what they drove, and nothing about bookings or datasets', () => {
    expect([...AI_INSIGHT_SURFACE_READERS.marketing].sort()).toEqual(['commerce', 'forms', 'marketing', 'traffic'])
  })
})
