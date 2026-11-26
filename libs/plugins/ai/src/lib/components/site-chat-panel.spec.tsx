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

import { render, screen } from '@testing-library/react'
import { isSitePath, renderSiteChatText } from './site-chat-panel'

describe('the site chat panel (AGL-4250)', () => {
  it('draws a link only to a path of this site', () => {
    render(<div>{renderSiteChatText('See [Camping](/camping), [elsewhere](https://evil.example) and **gates**.')}</div>)
    expect(screen.getByRole('link', { name: 'Camping' }).getAttribute('href')).toBe('/camping')
    expect(screen.queryByRole('link', { name: 'elsewhere' })).toBeNull()
    expect(screen.getByText('gates').tagName).toBe('STRONG')
  })

  it('treats a protocol-relative address as another site', () => {
    expect(isSitePath('/shop/hoodie')).toBe(true)
    expect(isSitePath('//evil.example')).toBe(false)
    expect(isSitePath('javascript:alert(1)')).toBe(false)
  })
})
