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

import { aiSiteInventoryBlock } from '../runtime/ai-doctrine'
import {
  AI_INVENTORY_KINDS,
  AI_SITE_INVENTORY_LISTED_PER_KIND,
  AI_SITE_INVENTORY_MAX_PER_KIND,
  emptyAiSiteInventory,
  type AiSiteInventory,
} from '../model/ai-site-inventory'
import {
  AI_INVENTORY_LOOKUP_MAX_CHARS,
  AI_INVENTORY_LOOKUP_MAX_ROWS,
  AI_INVENTORY_LOOKUP_TOOL_NAME,
  aiInventoryLookupTool,
  answerAiInventoryLookup,
  readAiInventoryLookup,
} from './ai-inventory-lookup-tool'

/**
 * "More on request" (AGL-2937). The prompt lists the first records of each
 * kind; this tool answers for the rest, out of the window already in memory.
 *
 * What the tests here are for: that a record past the listing cap can still
 * be found (the reuse rule turns on it), that a lookup cannot reach past the
 * window it was handed, that "none match" is told apart from "there are
 * none", and that the tool's schema names nothing of the site — the last is
 * what keeps the platform on one cached prefix, and the ledger spec holds the
 * measured half of it.
 */

const COMPONENTS = 120

function site(): AiSiteInventory {
  return {
    ...emptyAiSiteInventory('host-a'),
    components: Array.from({ length: COMPONENTS }, (_, index) => ({
      id: `cmp-${index}`,
      name: index === 99 ? 'Pricing card' : `Block ${index}`,
      props: { title: 'text' },
    })),
    forms: [{ id: 'frm-contact', name: 'Contact', fields: ['email', 'message'] }],
    screens: [
      { id: 'scr-home', name: 'Home', slug: '/', layoutId: null, template: false },
    ],
  }
}

describe('the lookup tool', () => {
  it('names a kind and a search text, and nothing of any site', () => {
    const tool = aiInventoryLookupTool()
    expect(tool.name).toBe(AI_INVENTORY_LOOKUP_TOOL_NAME)
    expect(tool.strict).toBe(true)
    const schema = tool.inputSchema as Record<string, any>
    expect(schema['additionalProperties']).toBe(false)
    expect(schema['required']).toEqual(['kind', 'query'])
    expect(schema['properties']['kind']['enum']).toEqual([...AI_INVENTORY_KINDS])
    // A schema built per site would front every cached prefix with a byte of
    // that site's, which is the one thing a tool in the prefix may not do.
    expect(JSON.stringify(aiInventoryLookupTool())).toBe(JSON.stringify(aiInventoryLookupTool()))
  })

  it('reads a kind and a query, and refuses a kind the site has no such thing of', () => {
    expect(readAiInventoryLookup({ kind: 'components', query: '  Pricing  card ' })).toEqual({
      kind: 'components',
      query: 'Pricing card',
    })
    expect(readAiInventoryLookup({ kind: 'components', query: null })).toEqual({
      kind: 'components',
      query: null,
    })
    expect(readAiInventoryLookup({ kind: 'widgets', query: null })).toBeNull()
  })
})

describe('what a lookup answers', () => {
  it('finds a record the prompt did not list, in the line shape the prompt uses', () => {
    const inventory = site()
    // The premise: the record is past the listing cap, so the block cannot
    // name it and only a lookup can.
    expect(aiSiteInventoryBlock(inventory)).not.toContain('cmp-99')
    const answer = answerAiInventoryLookup(inventory, { kind: 'components', query: 'pricing' })
    expect(answer).toContain('cmp-99 · Pricing card · title:text')
    expect(answer).toContain(`${COMPONENTS} components`)
  })

  it('matches any word of a record, whatever its case', () => {
    const inventory = site()
    expect(answerAiInventoryLookup(inventory, { kind: 'forms', query: 'MESSAGE' })).toContain(
      'frm-contact',
    )
    expect(answerAiInventoryLookup(inventory, { kind: 'screens', query: 'scr-home' })).toContain(
      'scr-home · Home · /',
    )
  })

  it('lists the records the prompt left out when the query is null', () => {
    const answer = answerAiInventoryLookup(site(), { kind: 'components', query: null })
    expect(answer).toContain(
      `${COMPONENTS - AI_SITE_INVENTORY_LISTED_PER_KIND} of this site's ${COMPONENTS} components were not listed above.`,
    )
    expect(answer).not.toContain('cmp-0 ·')
    expect(answer).toContain(`cmp-${AI_SITE_INVENTORY_LISTED_PER_KIND} ·`)
  })

  it('tells "none match" apart from "there are none"', () => {
    const inventory = site()
    expect(answerAiInventoryLookup(inventory, { kind: 'components', query: 'carousel' })).toBe(
      `None of this site's ${COMPONENTS} components matches "carousel".`,
    )
    expect(answerAiInventoryLookup(inventory, { kind: 'datasets', query: 'anything' })).toBe(
      "None of this site's 0 datasets matches \"anything\".",
    )
    // A kind the reader itself cut is never answered as settled: the model is
    // told the search was not exhaustive, so rule 7 is not decided on it.
    expect(
      answerAiInventoryLookup(
        { ...inventory, truncated: ['components'] },
        { kind: 'components', query: 'carousel' },
      ),
    ).toContain('More exist than were read')
  })

  it('caps one answer by rows and by characters, and says it capped it', () => {
    const answer = answerAiInventoryLookup(site(), { kind: 'components', query: 'block' })
    expect(answer.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(
      AI_INVENTORY_LOOKUP_MAX_ROWS,
    )
    expect(answer).toContain('Narrow the query')
    expect(answer.length).toBeLessThanOrEqual(AI_INVENTORY_LOOKUP_MAX_CHARS + 300)
  })

  it('reaches no further than the window the request was built from', () => {
    // A lookup answers from memory rather than from Firestore, so the scope
    // check `readSiteInventory` made before it read anything is the only one
    // needed: there is no query here to widen.
    const inventory = site()
    const answer = answerAiInventoryLookup(inventory, { kind: 'components', query: 'cmp-500' })
    expect(answer).toContain('None of')
    expect(AI_SITE_INVENTORY_MAX_PER_KIND).toBeGreaterThan(AI_SITE_INVENTORY_LISTED_PER_KIND)
  })

  it('answers a site with no inventory, and a kind it has never heard of', () => {
    expect(answerAiInventoryLookup(null, { kind: 'components', query: 'card' })).toContain(
      'No site inventory was read',
    )
    expect(answerAiInventoryLookup(site(), { kind: 'widgets', query: null })).toContain(
      'not a kind of record this site has',
    )
  })
})
