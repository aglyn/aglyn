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

import { chromeForDesign, designChromeRoles } from './email-design-chrome'

const CHROME = {
  header: { logoAlt: 'Northwind Coffee' },
  footer: { reason: 'Why you get this', legal: '© 2026 Northwind Coffee' },
}

/** A design of top-level sections, each given as its children. */
function design(
  ...sections: Array<{ props?: Record<string, unknown>; kids: Array<[string, Record<string, unknown>?]> }>
): Record<string, unknown> {
  const map: Record<string, unknown> = {
    '_@_': { componentId: 'div', nodes: sections.map((_, index) => `s${index}`) },
  }
  sections.forEach((section, index) => {
    map[`s${index}`] = {
      componentId: 'emailSection',
      props: section.props ?? {},
      nodes: section.kids.map((_, kid) => `s${index}k${kid}`),
    }
    section.kids.forEach(([componentId, props], kid) => {
      map[`s${index}k${kid}`] = { componentId, props: props ?? {} }
    })
  })
  return map
}

const BODY = { kids: [['emailText', { children: 'Hello' }]] as Array<[string, Record<string, unknown>?]> }

describe('chromeForDesign (AGL-3372)', () => {
  it('wraps a design that draws neither band in the whole chrome', () => {
    const nodes = design(BODY)
    expect(chromeForDesign({ stored: nodes, composed: nodes, chrome: CHROME })).toEqual(CHROME)
  })

  it('leaves out the header when the design opens with its own marked Header', () => {
    const nodes = design({ props: { emailRole: 'header' }, kids: [['emailImage']] }, BODY)
    expect(chromeForDesign({ stored: nodes, composed: nodes, chrome: CHROME })).toEqual({
      footer: CHROME.footer,
    })
  })

  it('leaves out the footer when the design closes with its own marked Footer', () => {
    const nodes = design(BODY, { props: { emailRole: 'footer' }, kids: [['emailText']] })
    expect(chromeForDesign({ stored: nodes, composed: nodes, chrome: CHROME })).toEqual({
      header: CHROME.header,
    })
  })

  it('leaves out both, and returns none, when the design draws both bands', () => {
    const nodes = design(
      { props: { emailRole: 'header' }, kids: [['emailImage']] },
      BODY,
      { props: { emailRole: 'footer' }, kids: [['emailText']] },
    )
    expect(chromeForDesign({ stored: nodes, composed: nodes, chrome: CHROME })).toBeUndefined()
  })

  it('recognizes the presets as they were before they carried the mark', () => {
    const nodes = design(
      { kids: [['emailImage'], ['emailText', { variant: 'subheading' }]] },
      BODY,
      { kids: [['emailDivider'], ['emailText', { variant: 'caption' }], ['emailText', { variant: 'caption' }]] },
    )
    expect([...designChromeRoles(nodes)].sort()).toEqual(['footer', 'header'])
  })

  it('does not mistake a hero image or a lone caption for a band', () => {
    const nodes = design(
      { kids: [['emailImage'], ['emailText', { variant: 'heading' }], ['emailButton']] },
      { kids: [['emailText', { variant: 'caption' }]] },
    )
    expect(designChromeRoles(nodes).size).toBe(0)
  })

  it('keeps the chrome off a design that places an unmarked reusable block', () => {
    const stored = {
      '_@_': { componentId: 'div', nodes: ['r', 's0'] },
      r: { componentId: 'reusableInstance', props: { refId: 'c1' } },
      s0: { componentId: 'emailSection', nodes: [] },
    }
    const composed = design({ kids: [['emailImage'], ['emailText', { variant: 'body' }]] }, BODY)
    expect(chromeForDesign({ stored, composed, chrome: CHROME })).toBeUndefined()
  })

  it('reads a marked reusable block by its mark once grafted', () => {
    const stored = {
      '_@_': { componentId: 'div', nodes: ['r'] },
      r: { componentId: 'reusableInstance', props: { refId: 'c1' } },
    }
    const composed = design({ props: { emailRole: 'header' }, kids: [['emailImage']] }, BODY)
    expect(chromeForDesign({ stored, composed, chrome: CHROME })).toEqual({ footer: CHROME.footer })
  })

  it('ignores placements that draw nothing in this send', () => {
    const composed = design(BODY)
    expect(chromeForDesign({ stored: null, composed, chrome: CHROME })).toEqual(CHROME)
  })
})
