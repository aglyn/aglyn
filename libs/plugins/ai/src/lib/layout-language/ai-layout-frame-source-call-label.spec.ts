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

/**
 * A footer's phone link says its number as a page's call button does
 * (AGL-4152): a contractor's site wrote "Call- 346-303-4246", and v1.22.3
 * tidied the call button on its pages while the footer it brought in still
 * said "Call- ".
 */

import { aiLayoutCallLabel, aiLayoutSourceFooter, type AiLayoutFrameSourceFooter } from './ai-layout-frame-source'
import { AiLayoutTreeBuilder } from './ai-layout-tree'

const footer = (phone: string): AiLayoutFrameSourceFooter => ({
  columns: [{ heading: 'Work', links: [{ label: 'Commercial work', to: '/commercial-work' }] }],
  links: [],
  text: [],
  social: [],
  address: null,
  phone,
  email: null,
  copyright: '© 2026 Example Concrete',
})

const phoneLink = (phone: string) => {
  const tree = new AiLayoutTreeBuilder()
  aiLayoutSourceFooter(tree, footer(phone), { name: 'Example Concrete' })
  return Object.values(tree.nodes).find((node) => node.componentId === 'muiScreenLink' && String(node.props?.['href'] ?? '').startsWith('tel:'))
}

describe('a footer phone link says its number as a call button does (AGL-4152)', () => {
  it('drops the stray mark after the verb, linking the same number', () => {
    const link = phoneLink('Call- 555-010-0142')
    expect(link?.props?.['children']).toBe('Call 555-010-0142')
    expect(link?.props?.['href']).toBe('tel:5550100142')
  })

  it('leaves a number with no verb, and every other word, as written', () => {
    expect(phoneLink('(555) 010-0142')?.props?.['children']).toBe('(555) 010-0142')
    expect(aiLayoutCallLabel('Text: (555) 010-0200')).toBe('Text (555) 010-0200')
    expect(aiLayoutCallLabel('Call us')).toBe('Call us')
    expect(aiLayoutCallLabel('Call-backs welcome')).toBe('Call-backs welcome')
  })
})
