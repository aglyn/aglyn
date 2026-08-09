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
 * The "sx literal after a props spread" defect class (AGL-1240/1284): a
 * component spreads the node's props and then writes its own `sx`, which
 * REPLACES the author's styles instead of merging with them. The failure is
 * completely silent — the styles are authored in the editor, saved to the
 * document, present in the JSON, and simply never render.
 *
 * `aglyn/no-sx-after-spread` is the tree-wide guard and catches the shape
 * statically. These cases prove the composition ORDER at runtime for the
 * branches a lint rule cannot reason about: placeholder/empty states, which
 * is where most of the instances lived, and the one element whose own value
 * must legitimately win.
 */

import CustomHtml from './custom-html'
import Icon from './icon'
import PluginFrame from './plugin-frame'
import Video from './video'
import { render } from '@testing-library/react'

/** The element the node's props (and so its `sx`) landed on. */
const styled = (container: HTMLElement, selector: string): CSSStyleDeclaration =>
  getComputedStyle(container.querySelector(selector) as HTMLElement)

describe('authored sx survives the component literal (AGL-1240/1284)', () => {
  it('Custom HTML placeholder: the author overrides the dashed frame', () => {
    // Every empty-state placeholder in the plugin components had this shape.
    const { container } = render(
      <CustomHtml sx={{ padding: '40px', borderRadius: '12px' }} />,
    )
    const box = styled(container, '.MuiBox-root')
    expect(box.padding).toBe('40px')
    expect(box.borderRadius).toBe('12px')
  })

  it('Custom HTML placeholder: unstyled nodes keep the default look', () => {
    // The merge must not change what an author who set nothing sees.
    const { container } = render(<CustomHtml />)
    const box = styled(container, '.MuiBox-root')
    expect(box.borderStyle).toBe('dashed')
  })

  it('Icon placeholder: the author overrides the 48px box', () => {
    const { container } = render(<Icon sx={{ width: '96px' }} />)
    expect(styled(container, '.MuiBox-root').width).toBe('96px')
  })

  it('Video placeholder: the author overrides the fallback height', () => {
    const { container } = render(<Video sx={{ height: '400px' }} />)
    expect(styled(container, '.MuiBox-root').height).toBe('400px')
  })

  it('Plugin Frame: the author styles the frame itself', () => {
    // The old literal carried a spread that LOOKED like a merge — it folded
    // in a local conditional, never the node's `sx`.
    const { container } = render(
      <PluginFrame
        pluginOrigin="https://plugins.example.com"
        listingId="listing"
        version="1.0.0"
        sha256="abc"
        sx={{ borderRadius: '16px' }}
      />,
    )
    expect(styled(container, 'iframe').borderRadius).toBe('16px')
  })

  it('Plugin Frame: an authored `visibility` cannot reveal an unloaded frame', () => {
    // The one value that must win over the author, so it stays LAST — the
    // same carve-out the Tab panel's hide rule gets (AGL-1284).
    const { container } = render(
      <PluginFrame
        pluginOrigin="https://plugins.example.com"
        listingId="listing"
        version="1.0.0"
        sha256="abc"
        sx={{ visibility: 'visible' }}
      />,
    )
    expect(styled(container, 'iframe').visibility).toBe('hidden')
  })
})
