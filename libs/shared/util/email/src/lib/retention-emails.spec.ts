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

import { EMAIL_NODE_ROOT_ID, renderEmailHtml, substituteMergeTokens } from './email-render'
import {
  PRODUCT_TIP_RETENTION_EMAILS,
  RETENTION_VERIFY_REMINDER_EMAIL,
} from './retention-emails'
import {
  SYSTEM_EMAIL_TEMPLATES,
  buildDefaultEmailNodeMap,
  getSystemEmailTemplate,
} from './system-email-catalog'

const RETENTION_SYSTEM_EMAIL_TEMPLATES = SYSTEM_EMAIL_TEMPLATES.filter((entry) =>
  entry.key.startsWith('retention-'),
)

/**
 * The getting-started emails' copy (AGL-3692), held to the house rules a
 * reviewer would otherwise have to remember: they are in the catalog, they
 * render, the heading states the topic, pages are "pages", nothing quotes a
 * price, nothing sounds unfinished, and every product tip carries its way out.
 */

const SAMPLE = (key: string): Record<string, string> =>
  Object.fromEntries(
    getSystemEmailTemplate(key)!.mergeTokens.map((token) => [token.name, token.sample]),
  )

function render(key: string) {
  const definition = getSystemEmailTemplate(key)!
  return renderEmailHtml({
    nodes: buildDefaultEmailNodeMap(definition) as never,
    rootId: EMAIL_NODE_ROOT_ID,
    merge: SAMPLE(key),
    sanitize: (value) => value,
  })
}

describe('RETENTION_SYSTEM_EMAIL_TEMPLATES', () => {
  const keys = RETENTION_SYSTEM_EMAIL_TEMPLATES.map((entry) => entry.key)

  it('are all in the catalog, so staff can send each by hand', () => {
    expect(keys).toHaveLength(5)
    for (const key of keys) expect(getSystemEmailTemplate(key)?.deliveredBy).toBe('resend')
  })

  it('render to html that opens with their topic', () => {
    for (const key of keys) {
      const definition = getSystemEmailTemplate(key)!
      const heading = definition.defaultBody?.[0]
      expect(heading).toMatchObject({ block: 'text', variant: 'heading' })
      const { html } = render(key)
      const topic = substituteMergeTokens((heading as { text: string }).text, SAMPLE(key))
      expect(html).toContain(topic)
    }
  })

  it('follow the copy rules: pages not screens, no prices, nothing unfinished', () => {
    for (const entry of RETENTION_SYSTEM_EMAIL_TEMPLATES) {
      const copy = [
        entry.defaultSubject,
        ...(entry.defaultBody ?? []).map((block) =>
          block.block === 'text' ? block.text : block.label,
        ),
      ].join('\n')
      expect(copy).not.toMatch(/screen/i)
      expect(copy).not.toMatch(/[$€£]\s?\d|\d+\s?%|per month|\/mo\b/i)
      expect(copy).not.toMatch(/beta|I'm building|we're building/i)
    }
  })

  it('gives every product tip the product-email switch, and the verification reminder none', () => {
    for (const entry of RETENTION_SYSTEM_EMAIL_TEMPLATES) {
      const tokens = entry.mergeTokens.map((token) => token.name)
      const tip = PRODUCT_TIP_RETENTION_EMAILS.has(entry.key)
      expect(tip).toBe(entry.key !== RETENTION_VERIFY_REMINDER_EMAIL)
      expect(tokens.includes('preferencesUrl')).toBe(tip)
      if (tip) expect(render(entry.key).html).toContain('/manage/user/emails')
    }
  })
})
