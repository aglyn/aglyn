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

/**
 * The citation origin is CONFIGURATION, not our infrastructure (AGL-2014).
 *
 * `DOCS_SITE_ORIGIN` was made configurable by AGL-2016, but it read only the
 * canonical `NEXT_PUBLIC_DOCS_ORIGIN` while `constants/docs-links.ts` also
 * honours the older `NEXT_PUBLIC_AGLYN_DOCS_URL`. So AGL-2186's own defect —
 * one value under two env names, honoured on some surfaces and ignored on
 * others — survived inverted in the one file it did not touch: a deployment
 * configured under the older name retargeted every console and besigner help
 * link and left every ASSIST CITATION deep-linking into `docs.aglyn.com`.
 *
 * Nothing covered `DOCS_SITE_ORIGIN` at all before this, which is why the
 * split could sit there after the issue that named it was closed. The suite
 * above asserts the default origin and so would have passed either way.
 *
 * The constant is read at module scope, so each shape needs a fresh module
 * registry — asserting against the already-imported binding would only ever
 * re-test whichever value was set when this file was first loaded.
 */
describe('Assist citations point at the operator\'s docs site (AGL-2014)', () => {
  const ORIGINAL_CANONICAL = process.env.NEXT_PUBLIC_DOCS_ORIGIN
  const ORIGINAL_LEGACY = process.env.NEXT_PUBLIC_AGLYN_DOCS_URL

  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  afterEach(() => {
    restore('NEXT_PUBLIC_DOCS_ORIGIN', ORIGINAL_CANONICAL)
    restore('NEXT_PUBLIC_AGLYN_DOCS_URL', ORIGINAL_LEGACY)
    jest.resetModules()
  })

  /** Re-import under the current env and cite one section. */
  function citationWith(env: Record<string, string | undefined>) {
    for (const [name, value] of Object.entries(env)) restore(name, value)
    jest.resetModules()
    const reloaded =
      require('./assist-retrieval') as typeof import('./assist-retrieval')
    return reloaded.docsGroundingBlock([{ section: CORPUS[0], score: 5 }])
  }

  it('SELF-HOST shape: the canonical name retargets every citation', () => {
    const block = citationWith({
      NEXT_PUBLIC_DOCS_ORIGIN: 'https://docs.example.com',
      NEXT_PUBLIC_AGLYN_DOCS_URL: undefined,
    })
    expect(block).toContain('https://docs.example.com/building-sites/')
    expect(block).not.toContain('aglyn.com')
  })

  it('honours the LEGACY name too — the half AGL-2186 left behind', () => {
    // This is the case that was broken: console help links moved, Assist
    // citations did not.
    const block = citationWith({
      NEXT_PUBLIC_DOCS_ORIGIN: undefined,
      NEXT_PUBLIC_AGLYN_DOCS_URL: 'https://handbook.example.com',
    })
    expect(block).toContain('https://handbook.example.com/building-sites/')
    expect(block).not.toContain('aglyn.com')
  })

  it('prefers the canonical name when both are set', () => {
    const block = citationWith({
      NEXT_PUBLIC_DOCS_ORIGIN: 'https://docs.example.com',
      NEXT_PUBLIC_AGLYN_DOCS_URL: 'https://old.example.com',
    })
    expect(block).toContain('https://docs.example.com/building-sites/')
    expect(block).not.toContain('old.example.com')
  })

  it('trims a trailing slash, which a copied URL carries', () => {
    const block = citationWith({
      NEXT_PUBLIC_DOCS_ORIGIN: 'https://docs.example.com/',
      NEXT_PUBLIC_AGLYN_DOCS_URL: undefined,
    })
    expect(block).toContain('https://docs.example.com/building-sites/')
    expect(block).not.toContain('.com//building-sites')
  })

  it('AGLYN-OPERATED shape: unset is still our docs site', () => {
    // Without this the guard could pass by breaking the default, which would
    // point our own Assist at nothing.
    const block = citationWith({
      NEXT_PUBLIC_DOCS_ORIGIN: undefined,
      NEXT_PUBLIC_AGLYN_DOCS_URL: undefined,
    })
    expect(block).toContain('https://docs.aglyn.com/building-sites/')
  })

  it('is the SAME value the console help links use — one reader, not two', () => {
    // The structural claim behind all of the above: `DOCS_SITE_ORIGIN` is a
    // re-export of `DOCS_BASE_URL`, so the two cannot drift apart again.
    process.env.NEXT_PUBLIC_DOCS_ORIGIN = 'https://docs.example.com'
    jest.resetModules()
    const retrieval =
      require('./assist-retrieval') as typeof import('./assist-retrieval')
    const links =
      require('../../../constants/docs-links') as typeof import('../../../constants/docs-links')
    expect(retrieval.DOCS_SITE_ORIGIN).toBe(links.DOCS_BASE_URL)
  })
})
