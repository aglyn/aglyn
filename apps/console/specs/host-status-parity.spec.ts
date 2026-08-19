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
 * AGL-2166 — the Sites screen the console mockup advertises: a `Live` /
 * `Draft` pill on every card and a `6 of 10 hosts · Business plan` meta
 * line. Neither existed.
 */

import {
  describeHostStatus,
  describeSiteAllowance,
} from '../utils/host-status'

describe('describeHostStatus', () => {
  it('calls a site with published screens Live', () => {
    // `host.screens` is the routing map publishing writes; the tenant reads
    // the same field to resolve a request, so an entry means a visitor can
    // reach a page.
    const status = describeHostStatus({ screens: { s1: '/', s2: '/about' } })
    expect(status.label).toBe('Live')
    expect(status.color).toBe('success')
    expect(status.detail).toContain('2 published pages')
  })

  it('singularises one page', () => {
    expect(describeHostStatus({ screens: { s1: '/' } }).detail).toContain(
      '1 published page.',
    )
  })

  it('calls a site with nothing published Draft', () => {
    expect(describeHostStatus({}).label).toBe('Draft')
    expect(describeHostStatus({ screens: {} }).label).toBe('Draft')
  })

  it('does NOT call a site in maintenance Live, whatever it has published', () => {
    // Every path is serving the 503 screen. A `Live` pill here would be the
    // console agreeing with a customer who thinks their site is up.
    const status = describeHostStatus({
      screens: { s1: '/' },
      maintenance: true,
    })
    expect(status.label).toBe('Maintenance')
    expect(status.color).toBe('warning')
  })

  it('reports a staff suspension above everything else', () => {
    const status = describeHostStatus({
      screens: { s1: '/' },
      maintenance: true,
      suspendedAt: 1,
    })
    expect(status.label).toBe('Suspended')
    expect(status.color).toBe('error')
  })

  it('treats an ELAPSED timed suspension as over', () => {
    // The fields stay on the document after the window passes, and the
    // tenant makes exactly this check before serving the lockdown notice.
    const status = describeHostStatus({
      screens: { s1: '/' },
      suspendedAt: 1,
      suspendedUntilMs: Date.now() - 1000,
    })
    expect(status.label).toBe('Live')
  })

  it('honours a suspension that has not yet elapsed', () => {
    const status = describeHostStatus({
      screens: { s1: '/' },
      suspendedAt: 1,
      suspendedUntilMs: Date.now() + 60_000,
    })
    expect(status.label).toBe('Suspended')
  })
})

describe('describeSiteAllowance', () => {
  it('reads as the mockup shows it', () => {
    expect(
      describeSiteAllowance({
        used: 6,
        limit: 10,
        planLabel: 'Business',
        ready: true,
      }),
    ).toBe('6 of 10 sites · Business plan')
  })

  it('says NOTHING until the org has resolved', () => {
    // An unresolved org resolves the FREE tier, and telling a Business
    // customer they are at "1 of 1 sites" is a correct-looking page
    // delivering a false upgrade prompt.
    expect(
      describeSiteAllowance({
        used: 6,
        limit: 1,
        planLabel: 'Free',
        ready: false,
      }),
    ).toBeUndefined()
    expect(
      describeSiteAllowance({
        used: 6,
        limit: 10,
        planLabel: undefined,
        ready: true,
      }),
    ).toBeUndefined()
  })

  it('handles an unlimited and an unknown cap', () => {
    expect(
      describeSiteAllowance({
        used: 3,
        limit: -1,
        planLabel: 'Enterprise',
        ready: true,
      }),
    ).toBe('3 of Unlimited sites · Enterprise plan')
    expect(
      describeSiteAllowance({
        used: 1,
        limit: undefined,
        planLabel: 'Free',
        ready: true,
      }),
    ).toBe('1 site · Free plan')
  })

  it('singularises against a cap of one', () => {
    expect(
      describeSiteAllowance({
        used: 1,
        limit: 1,
        planLabel: 'Free',
        ready: true,
      }),
    ).toBe('1 of 1 site · Free plan')
  })
})
