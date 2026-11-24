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
 *
 * @jest-environment node
 */

import { readMarketingChoice } from './marketing-choice'

describe('a file’s marketing choice (AGL-4245)', () => {
  it('reads each store’s words, case-insensitively', () => {
    expect(readMarketingChoice('YES').choice).toBe('optIn')
    expect(readMarketingChoice('Subscribed').choice).toBe('optIn')
    expect(readMarketingChoice('no').choice).toBe('optOut')
    expect(readMarketingChoice('False').choice).toBe('optOut')
    expect(readMarketingChoice('Unsubscribed').choice).toBe('optOut')
    expect(readMarketingChoice(false).choice).toBe('optOut')
  })

  it('reads no choice for Never subscribed, Pending, a blank and an unknown word', () => {
    expect(readMarketingChoice('Never subscribed')).toEqual({ choice: 'none', read: true })
    expect(readMarketingChoice('Pending')).toEqual({ choice: 'none', read: true })
    expect(readMarketingChoice(undefined)).toEqual({ choice: 'none', read: true })
    expect(readMarketingChoice('maybe')).toEqual({ choice: 'none', read: false })
  })
})
