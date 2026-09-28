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

import { outreachSiteHeld } from './host-suspension'

const NOW = 1_755_000_000_000

describe('outreachSiteHeld (AGL-3356)', () => {
  it('holds a site under a staff suspension', () => {
    expect(outreachSiteHeld({ suspendedAt: NOW, suspendedReasonCode: 'security' }, NOW)).toBe(true)
  })

  it('holds a site under a read-only window, which a sweep can wait out', () => {
    expect(outreachSiteHeld({ suspendedAt: NOW, suspendedMode: 'read-only' }, NOW)).toBe(true)
  })

  it('sends for a site whose suspension has expired, or that has none', () => {
    expect(outreachSiteHeld({ suspendedAt: NOW, suspendedUntilMs: NOW - 1 }, NOW)).toBe(false)
    expect(outreachSiteHeld({ name: 'Acme' }, NOW)).toBe(false)
    expect(outreachSiteHeld(null, NOW)).toBe(false)
  })

  it('ignores the customer-writable maintenance flag', () => {
    expect(outreachSiteHeld({ maintenance: true }, NOW)).toBe(false)
  })
})
