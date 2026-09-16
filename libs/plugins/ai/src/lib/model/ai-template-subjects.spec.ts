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
 * What a generated page template may bind (AGL-2909), held to the lists the
 * platform already keeps for each page, in both directions:
 *
 *  - AN ENTRY OR AUTHOR PAGE binds exactly the besigner insert picker's
 *    catalogs, which the core catalog spec holds to the resolvers.
 *  - A PRODUCT PAGE binds exactly what the commerce product page resolver
 *    fills. No catalog names those tokens and a plugin never imports another
 *    plugin, so the resolver's SOURCE is read: a token it adds, renames or
 *    drops fails here until this list says the same.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUTHOR_TOKEN_CATALOG,
  COLLECTION_TOKEN_CATALOG,
  ENTRY_TOKEN_CATALOG,
} from '@aglyn/aglyn/app-utils/binding-token-catalog'
import { AI_PALETTE, AI_SURFACES } from '../runtime/ai-palette.generated'
import {
  AI_PRODUCT_TEMPLATE_TOKENS,
  AI_TEMPLATE_SUBJECT_DEFINITIONS,
  AI_TEMPLATE_SUBJECTS,
  aiBindingTokensIn,
  aiTemplateAddressTokens,
  isAiAddressToken,
  parseAiTemplateJobInputs,
} from './ai-template-subjects'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const PRODUCT_RESOLVER = 'libs/plugins/commerce/src/lib/server/site-page-resolver.ts'

const tokensOf = (entries: ReadonlyArray<{ token: string }>) => entries.map((entry) => entry.token)

describe('template subjects (AGL-2909)', () => {
  it('binds an entry page to the Entry and Collection catalogs the insert picker offers', () => {
    expect(tokensOf(AI_TEMPLATE_SUBJECT_DEFINITIONS.entry.tokens)).toEqual([
      ...tokensOf(ENTRY_TOKEN_CATALOG),
      ...tokensOf(COLLECTION_TOKEN_CATALOG),
    ])
  })

  it('binds an author page to the Author catalog and the pager that resolves over their archive', () => {
    expect(tokensOf(AI_TEMPLATE_SUBJECT_DEFINITIONS.author.tokens)).toEqual([
      ...tokensOf(AUTHOR_TOKEN_CATALOG),
      '{{pagination.page}}',
      '{{pagination.totalPages}}',
      '{{pagination.prevUrl}}',
      '{{pagination.nextUrl}}',
    ])
  })

  it('binds a product page to exactly what the commerce product page resolver fills', () => {
    const source = readFileSync(join(REPO_ROOT, PRODUCT_RESOLVER), 'utf8')
    const filled = [...new Set([...source.matchAll(/'(product\.[A-Za-z]+)'\s*:/g)].map((match) => match[1]))]
    // A scan that matched nothing would pass forever.
    expect(filled.length).toBeGreaterThanOrEqual(5)
    expect(
      AI_PRODUCT_TEMPLATE_TOKENS.map((entry) => entry.token.slice(2, -2)).sort(),
    ).toEqual(filled.sort())
    for (const entry of AI_PRODUCT_TEMPLATE_TOKENS) {
      expect(entry.label).not.toContain('product.')
      expect(entry.description?.length).toBeGreaterThan(0)
    }
    expect(tokensOf(AI_TEMPLATE_SUBJECT_DEFINITIONS.product.tokens)).toEqual(
      tokensOf(AI_PRODUCT_TEMPLATE_TOKENS),
    )
  })

  it('titles each page with a token it fills, and names blocks the page surface places', () => {
    for (const subject of AI_TEMPLATE_SUBJECTS) {
      const definition = AI_TEMPLATE_SUBJECT_DEFINITIONS[subject]
      expect(definition.subject).toBe(subject)
      expect(tokensOf(definition.tokens)).toContain(definition.titleToken)
      for (const block of definition.blocks) {
        expect([block, AI_SURFACES.screen.allow.includes(block)]).toEqual([block, true])
        expect(AI_PALETTE[block]).toBeDefined()
      }
    }
    // A block belongs to one subject's page, or the foreign-block check cannot say whose.
    const blocks = AI_TEMPLATE_SUBJECTS.flatMap((subject) => AI_TEMPLATE_SUBJECT_DEFINITIONS[subject].blocks)
    expect(new Set(blocks).size).toBe(blocks.length)
  })

  it('lets a link or media prop hold only the address and picture tokens', () => {
    expect(aiTemplateAddressTokens(AI_TEMPLATE_SUBJECT_DEFINITIONS.entry)).toEqual([
      '{{entry.url}}',
      '{{entry.authorImage}}',
      '{{entry.authorUrl}}',
      '{{entry.authorPageUrl}}',
      '{{entry.collectionUrl}}',
      '{{entry.coverImage}}',
      '{{entry.coverVideo}}',
      '{{pagination.prevUrl}}',
      '{{pagination.nextUrl}}',
    ])
    expect(aiTemplateAddressTokens(AI_TEMPLATE_SUBJECT_DEFINITIONS.product)).toEqual([
      '{{product.image}}',
    ])
    expect(aiTemplateAddressTokens(AI_TEMPLATE_SUBJECT_DEFINITIONS.author)).toEqual([
      '{{author.image}}',
      '{{author.url}}',
      '{{author.pageUrl}}',
      '{{pagination.prevUrl}}',
      '{{pagination.nextUrl}}',
    ])
    expect(isAiAddressToken('{{entry.title}}')).toBe(false)
    expect(isAiAddressToken('{{entry.slug}}')).toBe(false)
    expect(isAiAddressToken('{{product.price}}')).toBe(false)
  })

  it('reads every token a string holds, spelled without inner whitespace', () => {
    expect(aiBindingTokensIn('By {{ entry.author }} on {{entry.date}}, see {{var:abc}}')).toEqual([
      '{{entry.author}}',
      '{{entry.date}}',
      '{{var:abc}}',
    ])
    expect(aiBindingTokensIn('No tokens, and {{ }} is not one')).toEqual([])
  })

  it('reads a template job’s inputs, and names what is missing', () => {
    expect(parseAiTemplateJobInputs({})).toEqual(expect.stringContaining('inputs.subject'))
    expect(parseAiTemplateJobInputs({ subject: 'event' })).toEqual(
      expect.stringContaining('entry, product, author'),
    )
    expect(parseAiTemplateJobInputs({ subject: 'entry' })).toEqual(
      expect.stringContaining('inputs.collectionId'),
    )
    expect(parseAiTemplateJobInputs({ subject: 'entry', collectionId: 'blog posts' })).toEqual(
      expect.stringContaining('inputs.collectionId'),
    )
    expect(parseAiTemplateJobInputs({ subject: 'entry', collectionId: ' col-blog ' })).toEqual({
      subject: 'entry',
      collectionId: 'col-blog',
    })
    expect(parseAiTemplateJobInputs({ subject: 'product', collectionId: 'col-blog' })).toEqual({
      subject: 'product',
      collectionId: null,
    })
    expect(parseAiTemplateJobInputs({ subject: 'author' })).toEqual({
      subject: 'author',
      collectionId: null,
    })
  })
})
