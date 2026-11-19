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

import { INSTALLED_TEMPLATE_SOURCE_TYPES } from '../plugin-manager/plugin-template-sources'
import {
  LIBRARY_TEMPLATE_SOURCE_TYPES,
  resolveTemplateNodes,
  templateFillablePlaceholders,
  templatePlaceholderValues,
} from './page-template-use'
import { encodeStoredNodes } from './stored-nodes'

const tree = {
  _: { $id: '_', componentId: 'div', nodes: ['h'] },
  h: { $id: 'h', componentId: 'h1', props: { text: 'Welcome to {{business}}, {{prop.city}}' }, nodes: [] as string[] },
}
const textOf = (nodes: Record<string, unknown>) => (nodes['h'] as { props: { text: string } }).props.text

describe('using a template, the pure part (AGL-4235)', () => {
  it('names the site’s own library: saved here, then every installer', () => {
    expect(LIBRARY_TEMPLATE_SOURCE_TYPES).toEqual(['authored', ...INSTALLED_TEMPLATE_SOURCE_TYPES])
    expect(LIBRARY_TEMPLATE_SOURCE_TYPES).not.toContain('starter')
  })

  it('asks for every placeholder but a property binding, and nothing that is not one', () => {
    expect(
      templateFillablePlaceholders([
        { name: 'business', label: 'Business name', defaultValue: 'Acme' },
        { name: 'prop.city' },
        { name: '' },
        null,
        { label: 'no name' },
      ]),
    ).toEqual([{ name: 'business', label: 'Business name', defaultValue: 'Acme' }])
    expect(templateFillablePlaceholders(undefined)).toEqual([])
    expect(templateFillablePlaceholders('business')).toEqual([])
  })

  it('fills a placeholder with the typed value, else its default, else nothing', () => {
    const asked = [{ name: 'business', defaultValue: 'Acme' }, { name: 'phone' }, { name: 'city', defaultValue: 'Austin' }]
    expect(templatePlaceholderValues(asked, { city: '' })).toEqual({ business: 'Acme', phone: '', city: '' })
    expect(templatePlaceholderValues(asked)).toEqual({ business: 'Acme', phone: '', city: 'Austin' })
    // A template that asks for nothing leaves its tree as it is.
    expect(templatePlaceholderValues([], { business: 'X' })).toBeNull()
  })

  it('fills the tree in from either stored form, and leaves a property binding alone', () => {
    const values = { business: 'Bakery' }
    const expected = 'Welcome to Bakery, {{prop.city}}'
    expect(textOf(resolveTemplateNodes(tree, values))).toBe(expected)
    const packed = encodeStoredNodes(tree)
    expect(textOf(resolveTemplateNodes(packed, values))).toBe(expected)
    expect(resolveTemplateNodes(tree, null)).toEqual(tree)
    expect(resolveTemplateNodes(undefined, values)).toEqual({})
  })
})
