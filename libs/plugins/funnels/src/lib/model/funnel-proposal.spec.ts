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

import type { FunnelInventory } from './funnel-inventory'
import {
  checkFunnelProposal,
  extractJsonObject,
  FUNNEL_PROPOSAL_SYSTEM,
  funnelProposalPrompt,
} from './funnel-proposal'

const INVENTORY: FunnelInventory = {
  pages: ['/', '/blog/post', '/pricing'],
  forms: [{ id: 'f1', name: 'Contact us' }],
  services: [{ id: 's1', name: 'Consultation' }],
  products: [],
  overlays: [],
}

describe('Create with AI for a funnel (AGL-3605)', () => {
  it('lists the site’s own inventory in the prompt, and keeps the instructions fixed', () => {
    const prompt = funnelProposalPrompt('blog readers who book', INVENTORY)
    expect(prompt).toContain('/pricing')
    expect(prompt).toContain('f1 — Contact us')
    expect(prompt).toContain('s1 — Consultation')
    expect(prompt).toContain('PRODUCTS: (none)')
    expect(FUNNEL_PROPOSAL_SYSTEM).not.toContain('blog readers')
  })

  it('reads the JSON out of an answer with prose around it', () => {
    expect(extractJsonObject('Sure! {"a": 1} hope that helps')).toEqual({ a: 1 })
    expect(extractJsonObject('no json')).toBeNull()
  })

  it('keeps only steps the site has, labels them from the inventory and says what it dropped', () => {
    const answer = JSON.stringify({
      name: 'Blog to booking',
      steps: [
        { type: 'page', key: '/blog', match: 'prefix', label: 'Read the blog' },
        { type: 'page', key: '/made-up' },
        { type: 'form', key: 'f404' },
        { type: 'booking', key: 's1' },
      ],
    })
    const checked = checkFunnelProposal(answer, INVENTORY)
    expect(checked).toHaveProperty('proposal')
    if (!('proposal' in checked)) return
    expect(checked.proposal.draft).toEqual({
      name: 'Blog to booking',
      steps: [
        { type: 'page', key: '/blog', match: 'prefix', label: 'Read the blog' },
        { type: 'booking', key: 's1', label: 'Consultation' },
      ],
    })
    expect(checked.proposal.dropped).toHaveLength(2)
  })

  it('is no draft when fewer than two real steps survive, or the answer is unreadable', () => {
    expect(
      checkFunnelProposal(JSON.stringify({ steps: [{ type: 'page', key: '/pricing' }, { type: 'page', key: '/x' }] }), INVENTORY),
    ).toHaveProperty('error')
    expect(checkFunnelProposal('I cannot help with that', INVENTORY)).toHaveProperty('error')
  })

  it('caps a draft at eight steps', () => {
    const steps = Array.from({ length: 12 }, () => ({ type: 'page', key: '/pricing' }))
    const checked = checkFunnelProposal(JSON.stringify({ name: 'Long', steps }), INVENTORY)
    expect('proposal' in checked && checked.proposal.draft.steps).toHaveLength(8)
  })
})
