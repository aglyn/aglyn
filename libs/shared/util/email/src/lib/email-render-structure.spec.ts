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

/**
 * Where the rendered blocks END UP once an HTML parser has read the markup
 * (AGL-3322).
 *
 * String assertions cannot see this. A `<table>` written straight into a
 * table's rows is legal to emit and reads fine as text, but a parser — every
 * browser, and every mail client built on one — closes the enclosing table at
 * that point and puts the inner one after it. So each case here parses the
 * document the way an inbox does and asks which table a block's text landed
 * in: the 600px column, or somewhere outside it.
 */

import { renderEmailHtml, type EmailRenderOptions } from './email-render'

const SANITIZE = (html: string) => html

/** The text of the 600px column, as a parser builds it. */
function column(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table[width="600"]')
  // Premise: the column exists at all.
  expect(table).not.toBeNull()
  return table?.textContent ?? ''
}

const SECTIONED: EmailRenderOptions['nodes'] = {
  root: { componentId: 'div', nodes: ['s1', 'loose', 's2'] },
  s1: { componentId: 'emailSection', nodes: ['t1', 'inner'] },
  t1: { componentId: 'emailText', props: { children: 'first band' } },
  inner: { componentId: 'emailSection', nodes: ['t2'] },
  t2: { componentId: 'emailText', props: { children: 'nested band' } },
  loose: { componentId: 'emailText', props: { children: 'between bands' } },
  s2: { componentId: 'emailSection', nodes: ['t3'] },
  t3: { componentId: 'emailText', props: { children: 'last band' } },
}

describe('parsed structure', () => {
  it('keeps every section, nested or not, inside the 600px column', () => {
    const { html } = renderEmailHtml({ nodes: SECTIONED, sanitize: SANITIZE })
    const inside = column(html)
    for (const text of ['first band', 'nested band', 'between bands', 'last band']) {
      expect(inside).toContain(text)
    }
    // In order: a section closing the column early would reorder nothing but
    // would empty it, which the containment above already catches.
    expect(inside.indexOf('first band')).toBeLessThan(inside.indexOf('last band'))
  })

  it('keeps the chrome header and footer in the column with the body', () => {
    const { html } = renderEmailHtml({
      nodes: SECTIONED,
      sanitize: SANITIZE,
      chrome: {
        header: { logoAlt: 'Northwind' },
        footer: { reason: 'Why you got this.', legal: '© 2026 Northwind GmbH' },
      },
    })
    const inside = column(html)
    const at = (text: string) => inside.indexOf(text)
    expect(at('Northwind')).toBeGreaterThanOrEqual(0)
    expect(at('Northwind')).toBeLessThan(at('first band'))
    expect(at('last band')).toBeLessThan(at('Why you got this.'))
    expect(at('Why you got this.')).toBeLessThan(at('© 2026 Northwind GmbH'))
  })
})
