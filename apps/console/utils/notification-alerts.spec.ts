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

import { unreadBadge } from './notification-alerts'

describe('unreadBadge', () => {
  it('renders a count', () => {
    expect(unreadBadge(1)).toBe('(1)')
    expect(unreadBadge(12)).toBe('(12)')
    expect(unreadBadge(99)).toBe('(99)')
  })

  it('caps so the title stays readable', () => {
    expect(unreadBadge(100)).toBe('(99+)')
    expect(unreadBadge(5000)).toBe('(99+)')
  })

  it('is empty when there is nothing unread', () => {
    // An empty string is what clears the title prefix, so this matters.
    expect(unreadBadge(0)).toBe('')
    expect(unreadBadge(-1)).toBe('')
    expect(unreadBadge(undefined as unknown as number)).toBe('')
  })
})
