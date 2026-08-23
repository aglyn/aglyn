/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import Box from '@mui/material/Box'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
import React from 'react'

import MuiShadowDom, { MuiShadowDomRenderer } from './mui-shadow-dom'

describe('MuiShadowDom', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<MuiShadowDom.div />)
    expect(baseElement).toBeTruthy()
  })

  it('renders children through the client (non-ssr) emotion cache path', () => {
    render(
      <MuiShadowDomRenderer container={document.createElement('div')}>
        <span>shadow-child</span>
      </MuiShadowDomRenderer>,
    )
    expect(screen.getByText('shadow-child')).toBeTruthy()
  })

  /**
   * AGL-2486 — the canvas must resolve the cascade the way the published page
   * does. The tenant renders through `AppRouterCacheProvider`, whose
   * `enableCssLayer` wraps every emotion rule in `@layer mui`; this renderer
   * builds its own cache for the shadow root and used to leave it unlayered.
   * Measured before the fix: the published tenant carried 72 `@layer mui`
   * blocks and zero unlayered `.mui-*` rules, while the canvas shadow root
   * carried zero layer blocks and 183 unlayered `.msd-*` rules. An author's
   * raw `<style>` — a Custom HTML `css` block — therefore beat every component
   * and `sx` rule on the live site regardless of specificity, and merely
   * competed on specificity in the editor.
   *
   * This asserts on the RULE TEXT the cache emits, not on rendered markup:
   * the emotion class names are byte-identical layered or not, so a markup
   * assertion goes green against the unlayered build.
   */
  it('renders the shadow root through a LAYERED cache, as the tenant does', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    render(
      <MuiShadowDomRenderer container={container}>
        <Box sx={{ color: 'rgb(1, 2, 3)' }}>layer-probe</Box>
      </MuiShadowDomRenderer>,
    )
    const emitted = Array.from(container.querySelectorAll('style'))
      .map((tag) => Array.from(tag.sheet?.cssRules ?? []))
      .flat()
    const ours = emitted.filter((rule) => rule.cssText.includes('rgb(1, 2, 3)'))
    expect(ours.length).toBeGreaterThan(0)
    // Every one of them is a layer BLOCK, i.e. the declaration sits inside
    // `@layer mui { … }` rather than at the top level of the sheet.
    expect(
      ours.filter((rule) => /^@layer\s+mui[\s{]/.test(rule.cssText)),
    ).toHaveLength(ours.length)
  })

  // AGL-1316: a static `react-dom/server` import here ships the full server
  // renderer in the shared client chunk. Keep the module free of it.
  it('does not import react-dom/server (keeps the server renderer out of client bundles)', () => {
    const source = readFileSync(join(__dirname, 'mui-shadow-dom.tsx'), 'utf8')
    expect(source).not.toMatch(/from 'react-dom\/server'|require\('react-dom\/server'\)/)
  })
})
