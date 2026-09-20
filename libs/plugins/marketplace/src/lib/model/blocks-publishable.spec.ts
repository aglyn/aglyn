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

import { sanitizeMarketplaceDefinition } from './marketplace'

describe('empty definitions are refused (AGL-1033)', () => {
  /**
   * This used to SUCCEED: the root wrapper alone sanitizes cleanly, so a
   * component whose content had never been published to its document shipped a
   * blank version to every installer and said nothing about it.
   */
  it('refuses a definition that is only the root wrapper', () => {
    const result = sanitizeMarketplaceDefinition({
      rootId: '_@_',
      nodes: { '_@_': { $id: '_@_', componentId: 'div', nodes: [] } as never },
    })
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.error).toMatch(/nothing to publish/i)
    }
  })
})
