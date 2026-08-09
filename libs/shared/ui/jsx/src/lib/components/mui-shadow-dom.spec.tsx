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

  // AGL-1316: a static `react-dom/server` import here ships the full server
  // renderer in the shared client chunk. Keep the module free of it.
  it('does not import react-dom/server (keeps the server renderer out of client bundles)', () => {
    const source = readFileSync(join(__dirname, 'mui-shadow-dom.tsx'), 'utf8')
    expect(source).not.toMatch(/from 'react-dom\/server'|require\('react-dom\/server'\)/)
  })
})
