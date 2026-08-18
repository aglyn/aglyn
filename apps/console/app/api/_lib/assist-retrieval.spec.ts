/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * Aglyn Assist docs retrieval (AGL-1860): the lexical scorer must surface
 * the section that actually answers the question, refuse to cite when
 * nothing matches, and build citable grounding blocks. Runs against a
 * hand-seeded corpus (deterministic) plus one smoke pass over the real
 * generated index.
 */

import {
  docsGroundingBlock,
  retrieveDocsSections,
  tokenize,
} from './assist-retrieval'
import type { AssistDocsSection } from '../../../constants/assist-docs-index.generated'

const CORPUS: AssistDocsSection[] = [
  {
    path: '/building-sites/domains/connect-a-domain',
    title: 'Connect a custom domain',
    heading: 'Point your DNS',
    anchor: '#point-your-dns',
    text: 'Add the CNAME record at your registrar, then verify the domain from Site Settings. Propagation can take up to an hour.',
  },
  {
    path: '/commerce-and-bookings/commerce/shipping',
    title: 'Shipping',
    heading: 'Flat-rate shipping',
    anchor: '#flat-rate-shipping',
    text: 'Create a flat-rate shipping zone and attach it to your products. Rates apply at checkout.',
  },
  {
    path: '/workspace-and-billing/billing-and-plans/overview',
    title: 'Billing & plans',
    heading: '',
    anchor: '',
    text: 'Plans bill monthly or annually. Upgrade or downgrade any time from the Billing page.',
  },
]

describe('tokenize', () => {
  it('lowercases, drops stop words, keeps meaningful terms', () => {
    expect(tokenize('How do I connect a custom domain?')).toEqual([
      'connect',
      'custom',
      'domain',
    ])
  })

  it('returns nothing for pure stop-word input', () => {
    expect(tokenize('how do you do that')).toEqual([])
  })
})

describe('retrieveDocsSections', () => {
  it('ranks the section that answers the question first', () => {
    const results = retrieveDocsSections(
      'how do I connect my custom domain DNS',
      3,
      CORPUS,
    )
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].section.path).toBe(
      '/building-sites/domains/connect-a-domain',
    )
  })

  it('returns [] when nothing scores — no forced citation', () => {
    expect(retrieveDocsSections('quantum entanglement', 3, CORPUS)).toEqual([])
  })

  it('returns [] for a stop-word-only question', () => {
    expect(retrieveDocsSections('how do you do', 3, CORPUS)).toEqual([])
  })

  it('caps results at the limit', () => {
    const results = retrieveDocsSections('shipping billing domain', 2, CORPUS)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('finds real sections in the generated index (smoke)', () => {
    const results = retrieveDocsSections('publish my first screen')
    expect(results.length).toBeGreaterThan(0)
    for (const { section } of results) {
      expect(section.path.startsWith('/')).toBe(true)
    }
  })
})

describe('docsGroundingBlock', () => {
  it('is empty for no sections', () => {
    expect(docsGroundingBlock([])).toBe('')
  })

  it('wraps each section with its citable docs URL', () => {
    const block = docsGroundingBlock([
      { section: CORPUS[0], score: 5 },
    ])
    expect(block).toContain(
      'https://docs.aglyn.com/building-sites/domains/connect-a-domain#point-your-dns',
    )
    expect(block).toContain('Connect a custom domain — Point your DNS')
    expect(block).toContain('Add the CNAME record')
  })
})
