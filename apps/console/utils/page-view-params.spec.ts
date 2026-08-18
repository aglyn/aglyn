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
import { buildConsolePageViewParams } from './page-view-params'

/** The real console title, as the root layout's metadata resolves it. */
const REAL_TITLE = 'Secure Platform Console – Aglyn'

describe('page_title carries no unread badge (AGL-2060)', () => {
  it('strips the badge a console page was fragmenting on', () => {
    const params = buildConsolePageViewParams(
      'https://app.aglyn.com/acme/hosts',
      `(7) ${REAL_TITLE}`,
    )
    expect(params.page_title).toBe(REAL_TITLE)
  })

  it('strips the CAPPED badge the busiest users get', () => {
    // `unreadBadge` caps at `(99+)`, so a regex matching only `\(\d+\)`
    // would leave the badge on exactly the accounts that fragment most.
    expect(unreadBadge(1000)).toBe('(99+)')
    expect(
      buildConsolePageViewParams(
        'https://app.aglyn.com/acme',
        `(99+) ${REAL_TITLE}`,
      ).page_title,
    ).toBe(REAL_TITLE)
    // The shape the issue names, too — any digits followed by an optional `+`.
    expect(
      buildConsolePageViewParams(
        'https://app.aglyn.com/acme',
        `(9+) ${REAL_TITLE}`,
      ).page_title,
    ).toBe(REAL_TITLE)
  })

  it('agrees with the writer for every badge the writer can produce', () => {
    // The writer and the reporter must not drift. Drive the ACTUAL
    // `unreadBadge` across the range rather than restating its output.
    for (const count of [1, 2, 5, 9, 10, 42, 99, 100, 5000]) {
      const badge = unreadBadge(count)
      expect(badge).not.toBe('')
      expect(
        buildConsolePageViewParams(
          'https://app.aglyn.com/acme',
          `${badge} ${REAL_TITLE}`,
        ).page_title,
      ).toBe(REAL_TITLE)
    }
  })

  // NEGATIVE CONTROL. Everything above would also pass if `page_title` were
  // hard-coded to REAL_TITLE, or dropped entirely. These pin that it is not.
  it('reports a real per-route title UNCHANGED, so the assertion is live', () => {
    const params = buildConsolePageViewParams(
      'https://app.aglyn.com/acme/hosts',
      'Sites · Aglyn',
    )
    expect(params.page_title).toBe('Sites · Aglyn')
    // Not the badged form, and not the root default: a stripper that returned
    // a constant, or one that ate more than the badge, fails right here.
    expect(params.page_title).not.toBe(REAL_TITLE)
  })

  it('strips ONLY a leading badge, never a parenthesis inside the title', () => {
    // Over-eager stripping is the other direction of the same bug.
    expect(
      buildConsolePageViewParams(
        'https://app.aglyn.com/acme',
        'Setup (2) · demo · Aglyn',
      ).page_title,
    ).toBe('Setup (2) · demo · Aglyn')
  })

  it('omits page_title entirely when metadata has not streamed in yet', () => {
    // Next 16 streams metadata for a route whose `generateMetadata` awaits
    // I/O — measured on `/{org}/marketplace/{listingId}`, where the shell
    // ships with no `<title>` at all. Sending `''` would report those views
    // under an empty title; the key must simply be absent.
    expect(
      buildConsolePageViewParams(
        'https://app.aglyn.com/acme/marketplace/x',
        '',
      ),
    ).not.toHaveProperty('page_title')
    expect(
      buildConsolePageViewParams('https://app.aglyn.com/acme/marketplace/x'),
    ).not.toHaveProperty('page_title')
  })
})

describe('console page_view params (AGL-1643)', () => {
  it('sends an absolute URL, so GA4 can derive the Hostname dimension', () => {
    const params = buildConsolePageViewParams(
      'https://app.aglyn.com/acme/hosts',
    )
    expect(params.page_location).toBe('https://app.aglyn.com/acme/hosts')
    // The bug: a bare pathname names no host at all, and Hostname is what
    // separates aglyn.com from app.aglyn.com inside the one property.
    expect(params.page_location).not.toBe('/acme/hosts')
    expect(String(params.page_location)).toContain('app.aglyn.com')
  })

  it('keeps marketing and console distinguishable', () => {
    expect(
      buildConsolePageViewParams('https://aglyn.com/pricing').page_location,
    ).toContain('aglyn.com/pricing')
    expect(
      buildConsolePageViewParams('https://app.aglyn.com/pricing').page_location,
    ).toContain('app.aglyn.com/pricing')
  })

  it('drops the query string, which is where an address turns up', () => {
    const params = buildConsolePageViewParams(
      'https://app.aglyn.com/signup?email=someone@example.com&plan=pro',
    )
    expect(params.page_location).toBe('https://app.aglyn.com/signup')
    expect(String(params.page_location)).not.toContain('someone@example.com')
    expect(String(params.page_location)).not.toContain('plan=pro')
  })

  it('drops the param entirely rather than sending an address in the PATH', () => {
    // The reduction keeps the path, so the sanitizer's email test still has
    // to catch one embedded there.
    const params = buildConsolePageViewParams(
      'https://app.aglyn.com/invite/someone@example.com',
    )
    expect(params).not.toHaveProperty('page_location')
  })
})
