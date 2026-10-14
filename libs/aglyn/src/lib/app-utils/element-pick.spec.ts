/**
 * @jest-environment jsdom
 */
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

import {
  ELEMENT_PICK_MESSAGE_TYPE,
  elementPickUrl,
  isElementPickMessage,
} from './element-pick-protocol'
import { elementPickTarget } from './element-pick-target'
import { expandLeafSelector } from './element-ui'
import { LAYOUT_NODE_ID_PREFIXES } from './compose-layout-nodes'

describe('the live-page element picker (AGL-3758)', () => {
  it('resolves a click inside an element to its leaf, in the Besigner form', () => {
    document.body.innerHTML =
      '<section data-aglyn="leaf:hero1"><a data-aglyn="leaf:cta_42" href="/x">' +
      '<span>Get   started</span></a></section>'
    const picked = elementPickTarget(document.querySelector('span'))
    expect(picked?.selector).toBe('[data-aglyn="leaf:cta_42"]')
    expect(picked?.label).toBe('“Get started”')
    // The runtime finds what the picker stored.
    expect(document.querySelector(expandLeafSelector(picked!.selector))).toBe(
      document.querySelector('a'),
    )
  })

  it('stores a layout element by its raw id, which every page matches', () => {
    const composed = `${LAYOUT_NODE_ID_PREFIXES[0]}nav_7`
    document.body.innerHTML = `<nav data-aglyn="leaf:${composed}" aria-label="Main menu"></nav>`
    const picked = elementPickTarget(document.querySelector('nav'))
    expect(picked).toMatchObject({
      selector: '[data-aglyn="leaf:nav_7"]',
      label: '“Main menu”',
    })
    expect(document.querySelector(expandLeafSelector(picked!.selector))).not.toBeNull()
  })

  it('picks nothing outside what Aglyn drew', () => {
    document.body.innerHTML = '<div><p>loose</p></div>'
    expect(elementPickTarget(document.querySelector('p'))).toBeNull()
    expect(elementPickTarget(null)).toBeNull()
  })

  it('reads only well-formed messages', () => {
    const picked = {
      type: ELEMENT_PICK_MESSAGE_TYPE,
      event: 'picked',
      selector: '[data-aglyn="leaf:a"]',
      label: 'A',
    }
    expect(isElementPickMessage(picked)).toBe(true)
    expect(isElementPickMessage({ type: ELEMENT_PICK_MESSAGE_TYPE, event: 'ready' })).toBe(true)
    expect(isElementPickMessage({ ...picked, selector: '' })).toBe(false)
    expect(isElementPickMessage({ ...picked, type: 'other' })).toBe(false)
    expect(isElementPickMessage('aglyn-pick-element')).toBe(false)
  })

  it('arms pick mode on a page URL, keeping its query', () => {
    expect(elementPickUrl('http://localhost:4500/pricing?tenantHost=acme')).toBe(
      'http://localhost:4500/pricing?tenantHost=acme&aglyn-pick=1',
    )
  })
})
