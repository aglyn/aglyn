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

import * as Aglyn from '@aglyn/aglyn'
import { BUNDLE_ID } from '../constants/bundle-common'
import { renderEmailHtml } from '../model'
import { EMAIL_BUNDLE } from '../site'
import { generatePresetId } from '../utils/generate-preset-id'
import {
  EMAIL_FOOTER_PRESET,
  EMAIL_HEADER_PRESET,
  emailPresets,
  SECTION_ID,
} from './email-blocks'

/** Every element a nested preset tree places, outermost first. */
function placed(node: Aglyn.NodeSchemaNested<any>): Aglyn.NodeSchemaNested<any>[] {
  return [node, ...(node.nodes ?? []).flatMap((child) => placed(child))]
}

/** A starter as the Components page seeds it, rendered the way a send renders it. */
function sent(preset: Aglyn.PresetSchema) {
  let next = 0
  const definition = Aglyn.nestedToDefinition(preset.data, () => `n${++next}`)
  return renderEmailHtml({
    rootId: 'root',
    sanitize: (value) => value,
    nodes: {
      root: { componentId: 'div', nodes: [definition.rootId] },
      ...definition.nodes,
    },
  })
}

/**
 * The Header and Footer an email can start with (AGL-3287): presets an author
 * drops into any email, and the trees the Components page starts a reusable
 * Header or Footer email block from.
 */
describe('the Header and Footer email starters (AGL-3287)', () => {
  const STARTERS = [EMAIL_HEADER_PRESET, EMAIL_FOOTER_PRESET]

  it('are offered in the email drawer with the other email blocks', () => {
    expect(emailPresets).toEqual(expect.arrayContaining(STARTERS))
    expect(STARTERS.map((preset) => preset.displayName)).toEqual([
      'Header',
      'Footer',
    ])
    for (const preset of STARTERS) {
      // The email view offers an entry only when it is filed under this
      // bundle; anything else would never reach an email's drawer.
      expect(preset.pluginId).toBe(Aglyn.EMAIL_VIEW_BUNDLE_ID)
      expect(preset.pluginId).toBe(BUNDLE_ID)
    }
  })

  it('carry the ids the Components page looks them up by', () => {
    expect(EMAIL_HEADER_PRESET.$id).toBe(
      Aglyn.REUSABLE_EMAIL_BLOCK_STARTER_PRESET_IDS.header,
    )
    expect(EMAIL_FOOTER_PRESET.$id).toBe(
      Aglyn.REUSABLE_EMAIL_BLOCK_STARTER_PRESET_IDS.footer,
    )
    // And those ids are this plugin's own scheme, not a second one.
    expect(EMAIL_HEADER_PRESET.$id).toBe(generatePresetId(SECTION_ID, 'header'))
    expect(EMAIL_FOOTER_PRESET.$id).toBe(generatePresetId(SECTION_ID, 'footer'))
  })

  it('place only blocks the email bundle registers, each under its own bundle', () => {
    const registered = new Set(EMAIL_BUNDLE.map((entry) => entry.schema.$id))
    for (const preset of STARTERS) {
      for (const node of placed(preset.data)) {
        expect([preset.displayName, node.componentId, registered.has(String(node.componentId))]).toEqual([
          preset.displayName,
          node.componentId,
          true,
        ])
        expect(node.pluginId).toBe(BUNDLE_ID)
      }
      // One outer section, so a block saved from it has a single root to
      // graft — the shape a component definition needs.
      expect(preset.data.componentId).toBe(SECTION_ID)
    }
  })

  it('send a header with the company name, and no picture until a logo is picked', () => {
    const { html, text } = sent(EMAIL_HEADER_PRESET)
    expect(text).toContain('Your company')
    expect(html).toContain('Your company')
    // An empty image renders nothing rather than a broken picture.
    expect(html).not.toContain('<img')
  })

  it('send a footer with the address and the reason, and no unsubscribe link of its own', () => {
    const { html, text } = sent(EMAIL_FOOTER_PRESET)
    expect(text).toContain('Your company · 123 Main St, City')
    expect(text).toContain(
      "You're receiving this because you're a customer of Your company.",
    )
    // A campaign send appends its own; a second would be a duplicate.
    expect(html.toLowerCase()).not.toContain('unsubscribe')
  })
})
