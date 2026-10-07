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

import type { AiDoctrineTree } from '../runtime/ai-doctrine-validators'
import { AI_SITE_NAME_TOKEN, aiLayoutInventedContactViolations, aiLayoutWithSiteName } from './ai-layout-site-facts'

/** The production guided start's brief (job 0lHliWvNpD): it gives no contact detail at all. */
const GUIDED_BRIEF = [
  'A 2-page website for A dog groomer in Austin. It is for Local dog owners. Follow the shape of the Business starter: a home page led by what you do, an about page and a contact page.',
  'Site — name: Hillside Dog Grooming; business: A dog groomer in Austin; for: Local dog owners.',
].join('\n')

const footer = (...lines: string[]): AiDoctrineTree => ({
  rootId: 'root',
  nodes: {
    root: { componentId: 'div', nodes: ['brand', 'foot'] },
    brand: { componentId: 'muiTypography', props: { variant: 'h6', children: 'Hillside Dog Grooming' } },
    foot: { componentId: 'section', props: { element: 'footer' }, nodes: lines.map((_, index) => `line${index}`) },
    ...Object.fromEntries(
      lines.map((children, index) => [`line${index}`, { componentId: 'muiTypography', props: { variant: 'body2', children } }]),
    ),
  },
})

describe('what a layout may say about its business (AGL-3596)', () => {
  describe('the contact details', () => {
    it('refuses an email or a phone number the guided start’s brief never gave', () => {
      const violations = aiLayoutInventedContactViolations(
        footer('hello@hillsidegrooming.com', 'Call (512) 555-0142', 'Serving Austin since 2019'),
        GUIDED_BRIEF,
      )
      expect(violations).toEqual([
        expect.objectContaining({ rule: 14, code: 'contact-not-in-brief', nodeIds: ['line0', 'line1'] }),
      ])
      expect(violations[0].message).toContain('"hello@hillsidegrooming.com", "(512) 555-0142"')
    })

    it('keeps the ones the brief gives, a phone number read by its digits', () => {
      const brief = `${GUIDED_BRIEF}\nReach us at Hello@HillsideGrooming.com or 512.555.0142.`
      expect(
        aiLayoutInventedContactViolations(footer('hello@hillsidegrooming.com', '(512) 555-0142'), brief),
      ).toEqual([])
    })

    it('reads no year, price or bracketed placeholder as a phone number', () => {
      expect(
        aiLayoutInventedContactViolations(footer('© 2026', 'From $45', 'Call [Office phone number]'), GUIDED_BRIEF),
      ).toEqual([])
    })
  })

  describe('the site’s name', () => {
    it('writes the brand and the copyright line as the token that reads the site’s name', () => {
      const tree = aiLayoutWithSiteName(
        {
          rootId: 'root',
          nodes: {
            root: { componentId: 'div', nodes: ['brand', 'copy', 'line'] },
            brand: { componentId: 'muiScreenLink', props: { children: 'Hillside  Dog Grooming', screenId: 'pgHome' } },
            copy: { componentId: 'muiTypography', props: { children: '© hillside dog grooming. All rights reserved.' } },
            line: { componentId: 'muiTypography', props: { children: 'Grooming for Hillside dogs.' } },
          },
        },
        'Hillside Dog Grooming',
      ) as { nodes: Record<string, { props: Record<string, unknown> }> }
      expect(tree.nodes['brand'].props).toEqual({ children: AI_SITE_NAME_TOKEN, screenId: 'pgHome' })
      expect(tree.nodes['copy'].props['children']).toBe(`© ${AI_SITE_NAME_TOKEN}. All rights reserved.`)
      expect(tree.nodes['line'].props['children']).toBe('Grooming for Hillside dogs.')
    })

    it('leaves a tree with no name, or no node map, as it came', () => {
      const tree = { rootId: 'root', nodes: { root: { componentId: 'div' } } }
      expect(aiLayoutWithSiteName(tree, '')).toBe(tree)
      expect(aiLayoutWithSiteName(tree, 'Hillside Dog Grooming')).toBe(tree)
      expect(aiLayoutWithSiteName('not a tree', 'Hillside')).toBe('not a tree')
    })
  })
})
