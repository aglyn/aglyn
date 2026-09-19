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
  AI_PALETTE_CATALOG_MAX_TOKENS,
  AI_SURFACE_NAMES,
  estimateCatalogTokens,
} from './ai-palette'
import {
  AI_PALETTE,
  AI_PALETTE_CATALOG,
  AI_SURFACES,
  AI_SX_TOKENS,
} from './ai-palette.generated'
import {
  MARKETPLACE_COMPONENT_ID_ALLOWLIST,
  MARKETPLACE_EMAIL_STARTER_COMPONENT_ID_ALLOWLIST,
} from '@aglyn/aglyn/app-utils/node-definition-sanitizer'

/**
 * Every component the palette carries. That the palette agrees with the
 * runtime registry — the ids, each schema's plugin, name, restrictions,
 * child contract and attributes — is `check:ai-palette`'s to prove: the
 * generator walks the real `*_BUNDLE` arrays from `tools/`, and a plugin
 * may not import another plugin's bundle to walk them here.
 */
const REGISTRY = new Set(Object.keys(AI_PALETTE))

/** Elements a model must never be offered, whatever list they sit on. */
const NEVER_OFFERED = [
  'custom-html',
  'functionWidget',
  'div',
  'reusableInstance',
  'marketplacePlugin',
  'emailHtml',
  'emailRichtext',
]

describe('AI_PALETTE agrees with the runtime registry (AGL-2905)', () => {
  it('names, in every surface, only registered components and never the excluded ones', () => {
    for (const surface of AI_SURFACE_NAMES) {
      const { root, allow } = AI_SURFACES[surface]
      expect(REGISTRY.has(root)).toBe(true)
      for (const id of allow) {
        expect(REGISTRY.has(id)).toBe(true)
        expect(NEVER_OFFERED).not.toContain(id)
      }
      expect([...allow]).toEqual([...new Set(allow)].sort())
    }
  })

  it('builds the page palette over the marketplace allowlist', () => {
    for (const id of MARKETPLACE_COMPONENT_ID_ALLOWLIST) {
      expect(AI_SURFACES.screen.allow).toContain(id)
    }
    // A component may also place an Icon, bound to an icon the site owner picks (AGL-3054).
    expect(AI_SURFACES.component.allow).toEqual([...AI_SURFACES.screen.allow, 'icon'].sort())
    expect(AI_SURFACES.screen.allow).not.toContain('icon')
    expect(AI_SURFACES.layout.allow).not.toContain('icon')
    expect(AI_SURFACES.layout.allow).toEqual(
      [...AI_SURFACES.screen.allow, 'layoutSlot'].sort(),
    )
    expect(AI_SURFACES.screen.allow).not.toContain('layoutSlot')
  })

  it('builds the email palette over the starter allowlist', () => {
    expect([...AI_SURFACES.email.allow]).toEqual(
      [...MARKETPLACE_EMAIL_STARTER_COMPONENT_ID_ALLOWLIST].sort(),
    )
  })

  it('offers the form palette as the form components', () => {
    expect(AI_SURFACES.form).toEqual({
      root: 'form',
      allow: ['form', 'formField'],
    })
  })

  it('offers no element whose props carry raw HTML', () => {
    for (const surface of AI_SURFACE_NAMES) {
      for (const id of AI_SURFACES[surface].allow) {
        expect(
          Object.keys(AI_PALETTE[id].propsSchema.properties),
        ).not.toContain('html')
        expect(
          Object.keys(AI_PALETTE[id].propsSchema.properties),
        ).not.toContain('css')
      }
    }
  })

  it('reads its theme vocabulary off the theme sources', () => {
    expect(AI_SX_TOKENS.breakpoints).toEqual(['xs', 'sm', 'md', 'lg', 'xl'])
    expect(AI_SX_TOKENS.palette).toEqual(
      expect.arrayContaining([
        'primary.main',
        'secondary.main',
        'text.primary',
        'background.paper',
      ]),
    )
    expect(AI_SX_TOKENS.typographyVariants).toEqual(
      expect.arrayContaining(['h1', 'body1', 'caption']),
    )
  })
})

describe('AI_PALETTE_CATALOG stays inside its prompt budget (AGL-2905)', () => {
  it.each(AI_SURFACE_NAMES)('%s is under the token ceiling', (surface) => {
    const catalog = AI_PALETTE_CATALOG[surface]
    expect(estimateCatalogTokens(catalog)).toBeLessThanOrEqual(
      AI_PALETTE_CATALOG_MAX_TOKENS,
    )
    for (const id of AI_SURFACES[surface].allow) {
      expect(catalog).toContain(`- ${id} (`)
    }
    expect(catalog).toContain(`Surface: ${surface}.`)
  })
})
