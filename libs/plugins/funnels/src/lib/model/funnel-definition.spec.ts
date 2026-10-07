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

import { FUNNEL_MAX_STEPS } from './funnels.types'
import {
  funnelStepTitle,
  normalizeFunnelDefinition,
  normalizeFunnelPath,
  normalizeFunnelStep,
} from './funnel-definition'
import { stepInventoryProblem, type FunnelInventory } from './funnel-inventory'

describe('funnel definitions (AGL-3605)', () => {
  it('cleans a path the way a visit records one', () => {
    expect(normalizeFunnelPath('pricing/?a=1#x')).toBe('/pricing')
    expect(normalizeFunnelPath('//blog//')).toBe('/blog')
    expect(normalizeFunnelPath('/')).toBe('/')
  })

  it('accepts 2 to 8 steps and names the step that fails', () => {
    expect(normalizeFunnelDefinition({ name: 'A', steps: [{ type: 'page', key: '/' }] })).toHaveProperty('error')
    const tooMany = Array.from({ length: FUNNEL_MAX_STEPS + 1 }, () => ({ type: 'order' }))
    expect(normalizeFunnelDefinition({ name: 'A', steps: tooMany })).toHaveProperty('error')
    expect(
      normalizeFunnelDefinition({ name: 'A', steps: [{ type: 'page', key: '/' }, { type: 'event', key: 'Bad Name' }] }),
    ).toEqual({ error: expect.stringMatching(/^Step 2:/) })
    expect(normalizeFunnelDefinition({ name: ' ', steps: [] })).toEqual({ error: 'Name the funnel.' })
  })

  it('keeps only what a step may carry', () => {
    expect(normalizeFunnelStep({ type: 'order', key: 'x', match: 'prefix', extra: 1 })).toEqual({
      step: { type: 'order', key: '' },
    })
    expect(normalizeFunnelStep({ type: 'page', key: '/a', match: 'weird' })).toEqual({
      step: { type: 'page', key: '/a', match: 'exact' },
    })
    expect(normalizeFunnelStep({ type: 'unknown' })).toHaveProperty('error')
  })

  it('titles a step from its label, else from what it names', () => {
    expect(funnelStepTitle({ type: 'form', key: '' })).toBe('Submitted a form (any)')
    expect(funnelStepTitle({ type: 'page', key: '/blog', match: 'prefix' })).toBe('Viewed a page: /blog and below')
    expect(funnelStepTitle({ type: 'form', key: 'f1', label: 'Contact' })).toBe('Contact')
  })
})

describe('steps against the site (AGL-3605)', () => {
  const inventory: FunnelInventory = {
    pages: ['/', '/blog/hello', '/pricing'],
    forms: [{ id: 'f1', name: 'Contact' }],
    services: [],
    products: [{ id: 'p1', name: 'Mug' }],
    overlays: [],
  }

  it('refuses a page the site does not serve and a prefix nothing is under', () => {
    expect(stepInventoryProblem({ type: 'page', key: '/pricing', match: 'exact' }, inventory)).toBeNull()
    expect(stepInventoryProblem({ type: 'page', key: '/nope', match: 'exact' }, inventory)).toMatch(/no page/)
    expect(stepInventoryProblem({ type: 'page', key: '/blog', match: 'prefix' }, inventory)).toBeNull()
    expect(stepInventoryProblem({ type: 'page', key: '/shop', match: 'prefix' }, inventory)).toMatch(/No page/)
  })

  it('refuses a record the site does not have, and allows any and custom events', () => {
    expect(stepInventoryProblem({ type: 'form', key: 'f1' }, inventory)).toBeNull()
    expect(stepInventoryProblem({ type: 'form', key: 'f9' }, inventory)).toMatch(/not on this site/)
    expect(stepInventoryProblem({ type: 'booking', key: '' }, inventory)).toBeNull()
    expect(stepInventoryProblem({ type: 'event', key: 'demo_click' }, inventory)).toBeNull()
  })
})
