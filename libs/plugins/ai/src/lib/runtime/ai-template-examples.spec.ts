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
 * The starter examples a template generation is shown (AGL-2909).
 *
 *  - WHAT IT SHOWS IS WHAT IT ENFORCES. Every example is a tree the doctrine
 *    accepts as a template with no violation and no repair, so the model is
 *    never shown something the loop would refuse.
 *  - IT COMES FROM THE STARTERS. The pages shown are pinned by name, so a
 *    starter edit that makes one break a rule drops it here, visibly, rather
 *    than quietly shrinking what every template generation is shown.
 *  - ONE CACHE ENTRY. The block is the same bytes on every call, holds no
 *    per-org byte, and stays inside its ceiling.
 */

import { STARTER_TEMPLATES } from '@aglyn/aglyn/app-utils/starter-templates'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { validateAiDoctrineTree } from './ai-doctrine-validators'
import {
  AI_TEMPLATE_EXAMPLES_MAX_CHARS,
  AI_TEMPLATE_EXAMPLES_PREAMBLE,
  aiStarterExampleTree,
  aiStarterTemplateExamples,
  aiTemplateExamplesBlock,
  aiTemplateExamplesSystemBlock,
} from './ai-template-examples'

const ROOT = CANVAS_ROOT_ELEMENT_ID

describe('the starter template examples (AGL-2909)', () => {
  const examples = aiStarterTemplateExamples()

  it('shows the starter pages the doctrine accepts exactly as they are shown, pinned by name', () => {
    expect(examples.map((example) => `${example.starter} / ${example.page}`)).toEqual([
      'Business / About Us',
      'Portfolio / Portfolio',
    ])
    for (const example of examples) {
      const report = validateAiDoctrineTree(example.tree, 'template')
      expect([example.page, report.violations]).toEqual([example.page, []])
      expect([example.page, report.tree?.repairs]).toEqual([example.page, []])
    }
  })

  it('brings a starter page up to the rules the same way every time', () => {
    const tree = aiStarterExampleTree({
      [ROOT]: { componentId: 'div', nodes: ['band'] },
      band: {
        componentId: 'muiContainer',
        props: { maxWidth: 'md' },
        sx: { paddingTop: 6 },
        nodes: ['stack'],
      },
      stack: {
        componentId: 'muiStack',
        props: { spacing: 2, notAProp: 'dropped' },
        nodes: ['title', 'subtitle', 'heading', 'picture', 'form'],
      },
      title: { componentId: 'muiTypography', props: { variant: 'h2', children: 'Our story' } },
      subtitle: { componentId: 'muiTypography', props: { variant: 'h6', children: 'Since 1998' } },
      heading: { componentId: 'muiTypography', props: { variant: 'h4', children: 'What we do' } },
      picture: { componentId: 'image', props: { alt: 'The shop', height: '220px', objectFit: 'cover' } },
      form: { componentId: 'form', props: { formName: 'Contact' }, nodes: ['field'] },
      field: { componentId: 'formField', props: { fieldName: 'email' } },
    })
    expect(tree).toEqual({
      rootId: ROOT,
      nodes: {
        [ROOT]: { componentId: 'div', nodes: ['band'] },
        band: {
          componentId: 'muiContainer',
          props: { maxWidth: 'md' },
          sx: { paddingTop: 6 },
          nodes: ['stack'],
        },
        // A prop the palette does not declare, and the inline form, are left out.
        stack: {
          componentId: 'muiStack',
          props: { spacing: 2 },
          nodes: ['title', 'subtitle', 'heading', 'picture'],
        },
        // The first heading is the page's h1, a later one an h2, a subtitle a paragraph.
        title: {
          componentId: 'muiTypography',
          props: { variant: 'h2', children: 'Our story', component: 'h1' },
        },
        subtitle: {
          componentId: 'muiTypography',
          props: { variant: 'h6', children: 'Since 1998', component: 'p' },
        },
        heading: {
          componentId: 'muiTypography',
          props: { variant: 'h4', children: 'What we do', component: 'h2' },
        },
        // Rule 5 names no px length, so the example carries none.
        picture: { componentId: 'image', props: { alt: 'The shop', objectFit: 'cover' } },
      },
    })
  })

  it('shows no page that places an element the page surface does not offer', () => {
    expect(
      aiStarterExampleTree({
        [ROOT]: { componentId: 'div', nodes: ['grid'] },
        grid: { componentId: 'product-grid', props: { columns: 3 } },
      }),
    ).toBeNull()
    expect(aiStarterExampleTree({ grid: { componentId: 'muiStack' } })).toBeNull()
    expect(examples.some((example) => example.starter.startsWith('Shop'))).toBe(false)
  })

  it('shows one page of each shape: a page built like one already shown is left out', () => {
    const business = STARTER_TEMPLATES.find((starter) => starter.id === 'business')
    const contact = business?.screens.find((screen) => screen.key === 'contact-us')
    const tree = contact ? aiStarterExampleTree(contact.nodes) : null
    // Its form left out, the contact page is the about page's shape: accepted, and not shown twice.
    expect(tree && validateAiDoctrineTree(tree, 'template').violations).toEqual([])
    expect(examples.map((example) => example.page)).not.toContain('Contact Us')
  })

  it('is one cached block of the same bytes on every call, inside its ceiling', () => {
    const block = aiTemplateExamplesBlock(examples)
    expect(block.cacheBreakpoint).toBe(true)
    expect(block.volatile).toBeUndefined()
    expect(block.text.startsWith(AI_TEMPLATE_EXAMPLES_PREAMBLE)).toBe(true)
    expect(block.text.length).toBeLessThanOrEqual(AI_TEMPLATE_EXAMPLES_MAX_CHARS)
    for (const example of examples) {
      expect(block.text).toContain(
        `Starter "${example.starter}", page "${example.page}":\n${JSON.stringify(example.tree)}`,
      )
    }
    expect(aiTemplateExamplesBlock(aiStarterTemplateExamples()).text).toBe(block.text)
    expect(aiTemplateExamplesSystemBlock()).toBe(aiTemplateExamplesSystemBlock())
    expect(aiTemplateExamplesSystemBlock().text).toBe(block.text)
  })

  it('holds the block to its ceiling an example at a time', () => {
    const block = aiTemplateExamplesBlock(Array.from({ length: 12 }, () => examples[1]))
    expect(block.text.length).toBeLessThanOrEqual(AI_TEMPLATE_EXAMPLES_MAX_CHARS)
    expect(block.text).toContain(`page "${examples[1].page}"`)
  })
})
