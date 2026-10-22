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
 * One owner for GA4 default event parameters (AGL-2087).
 *
 * AGL-2060 fixed the badge on the manual `page_view` by passing the param
 * explicitly. Closing the rest — the two raw `screen_view` calls and the
 * SDK's automatic `session_start` / `first_visit` / `user_engagement` — needs
 * `setDefaultEventParameters`, which is already spoken for by the AGL-1582
 * internal-traffic stamp and, during boot, ASSIGNS rather than merges. A
 * second caller therefore drops the other's parameters silently: the events
 * still ship, GA4's internal-traffic filter just stops matching them, and a
 * data filter is not retroactive.
 *
 * That failure mode is why the central assertion here is "both keys, at
 * once". A test that only checked `page_title` had arrived would have passed
 * throughout the regression it exists to catch.
 *
 * Planted reds, verified: turn the merge in `setAnalyticsDefaultParams` into
 * an assignment (`composed = { ...patch }`) → the coexistence and both
 * survival cases; drop the `\+?` from `UNREAD_BADGE_PREFIX` → the capped
 * `(99+)` case; re-import the raw SDK call into the layout → the sole-owner
 * case.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { execFileSync } from 'child_process'

// `mock`-prefixed so jest's out-of-scope guard allows the factory to close
// over it. This spy IS the SDK for this file: the assertions below read the
// object actually handed to `setDefaultEventParameters`, not a reconstruction
// of it, because the bug being guarded lives in what that one object contains.
const mockSetDefaultEventParameters = jest.fn()
jest.mock('firebase/analytics', () => ({
  setDefaultEventParameters: (...args: unknown[]) =>
    mockSetDefaultEventParameters(...args),
}))

import {
  readAnalyticsDefaultParams,
  resetAnalyticsDefaultParams,
  setAnalyticsDefaultParams,
} from '../utils/analytics-default-params'
import { buildConsolePageTitle } from '../utils/page-view-params'
import { unreadBadge } from '../utils/notification-alerts'
import {
  INTERNAL_TRAFFIC_PARAM,
  INTERNAL_TRAFFIC_VALUE,
} from '../utils/internal-traffic'

const CONSOLE_ROOT = resolve(__dirname, '..')

/**
 * Source only. `.next` carries generated `.ts` route types after a build, and
 * a guard whose expected file list depends on whether someone built first is
 * a guard that fails for the wrong reason.
 */
const GREP_SCOPE = [
  '--include=*.ts',
  '--include=*.tsx',
  '--exclude-dir=node_modules',
  '--exclude-dir=.next',
  '--exclude-dir=dist',
]
const LAYOUT = resolve(
  CONSOLE_ROOT,
  'components/layouts/firebase-app.layout.tsx',
)

/** The file explains all of this in prose; only CODE may be asserted on. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

/** The object handed to the SDK on the most recent update. */
const lastSent = (): Record<string, unknown> =>
  mockSetDefaultEventParameters.mock.calls.at(-1)?.[0] as Record<
    string,
    unknown
  >

/** What the traffic effect patches. */
const stampInternal = () =>
  setAnalyticsDefaultParams({
    [INTERNAL_TRAFFIC_PARAM]: INTERNAL_TRAFFIC_VALUE,
  })

/** What the page_view effect patches, given a live tab title. */
const stampTitle = (documentTitle: string) =>
  setAnalyticsDefaultParams({
    page_title: buildConsolePageTitle(documentTitle) || undefined,
  })

beforeEach(() => {
  resetAnalyticsDefaultParams()
  mockSetDefaultEventParameters.mockClear()
})

describe('the composed default parameter set (AGL-2087)', () => {
  it('carries traffic_type AND a stripped page_title in ONE call', () => {
    // The regression this whole issue is about. Both owners write, and the
    // single object the SDK is handed has to hold both — with the badge gone
    // from the title, which is the other half of the point.
    stampInternal()
    stampTitle('(4) Secure Platform Console – Aglyn')

    expect(lastSent()).toEqual({
      [INTERNAL_TRAFFIC_PARAM]: INTERNAL_TRAFFIC_VALUE,
      page_title: 'Secure Platform Console – Aglyn',
    })
    // And it is one call, not two objects the SDK has to reconcile.
    expect(mockSetDefaultEventParameters).toHaveBeenCalledTimes(2)
    expect(lastSent()).toEqual(readAnalyticsDefaultParams())
  })

  it('holds both when the page_view effect writes FIRST', () => {
    // Order is not guaranteed in the direction that matters: the traffic
    // effect's token branch resolves asynchronously and lands after any
    // number of route changes.
    stampTitle('(4) Secure Platform Console – Aglyn')
    stampInternal()

    expect(lastSent()).toEqual({
      page_title: 'Secure Platform Console – Aglyn',
      [INTERNAL_TRAFFIC_PARAM]: INTERNAL_TRAFFIC_VALUE,
    })
  })

  it('keeps traffic_type across a page_title update', () => {
    // A route change re-runs the page_view effect. Under the pre-fix shape
    // this is precisely where the stamp disappeared — silently, with the
    // events still shipping.
    stampInternal()
    stampTitle('Hosts – Aglyn')
    stampTitle('Billing – Aglyn')

    expect(lastSent()).toEqual({
      [INTERNAL_TRAFFIC_PARAM]: INTERNAL_TRAFFIC_VALUE,
      page_title: 'Billing – Aglyn',
    })
  })

  it('keeps page_title across a traffic_type update, and across its CLEAR', () => {
    // The clear is not optional: the console does not remount across a
    // re-auth (AGL-664), so a customer signing in after a staff session must
    // actively lose the stamp. It must not take the title with it.
    stampTitle('Hosts – Aglyn')
    stampInternal()
    setAnalyticsDefaultParams({ [INTERNAL_TRAFFIC_PARAM]: undefined })

    expect(lastSent()).toEqual({
      page_title: 'Hosts – Aglyn',
      [INTERNAL_TRAFFIC_PARAM]: undefined,
    })
    // Cleared, not merely absent — an omitted key would leave the previous
    // value standing in gtag.
    expect(INTERNAL_TRAFFIC_PARAM in lastSent()).toBe(true)
  })

  it('strips the badge in every form the writer can produce, capped one included', () => {
    // ⚠️ `unreadBadge` caps at `(99+)`, not `(9+)`. A pattern without the
    // `\+?` leaves the badge on exactly the busiest accounts — the ones that
    // fragment a page's rows the most.
    const title = 'Secure Platform Console – Aglyn'
    for (const count of [1, 4, 12, 99, 100, 4321]) {
      stampTitle(`${unreadBadge(count)} ${title}`)
      expect([count, lastSent().page_title]).toEqual([count, title])
    }
    // Named explicitly so the capped form cannot fall out of the loop above.
    expect(unreadBadge(100)).toBe('(99+)')
    stampTitle(`(99+) ${title}`)
    expect(lastSent().page_title).toBe(title)
  })

  it('clears page_title rather than pinning an empty string', () => {
    // Next 16 streams metadata for a route whose `generateMetadata` awaits
    // I/O, so this effect can beat the real `<title>`. GA4 falling back to
    // its own reading beats an empty dimension value.
    stampInternal()
    stampTitle('')

    expect(lastSent()).toEqual({
      [INTERNAL_TRAFFIC_PARAM]: INTERNAL_TRAFFIC_VALUE,
      page_title: undefined,
    })
  })
})

describe('the single owner is structurally the only one (AGL-2087)', () => {
  it('is the only place in apps/console that CALLS the raw SDK API', () => {
    // The guard that makes the design hold for a third contributor, who will
    // not have read any of the prose above. Grepping the tree rather than
    // trusting a comment: the naive second caller is the shape this fix was
    // deferred over once already.
    //
    // Comments are stripped before the check. Several files legitimately
    // EXPLAIN the API — that is the point of the explanation — and a guard
    // that fired on prose would be paid for by deleting the prose.
    const named = execFileSync(
      'grep',
      ['-rl', ...GREP_SCOPE, 'setDefaultEventParameters', '.'],
      { cwd: CONSOLE_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .filter((file) => !file.includes('node_modules'))

    // Sanity: the grep has to be finding things, or this guard cannot fail.
    expect(named.length).toBeGreaterThan(1)

    const callers = named
      // Specs may name the API freely; only product code can race.
      .filter((file) => !/\.spec\.tsx?$/.test(file))
      .filter((file) =>
        stripComments(
          readFileSync(resolve(CONSOLE_ROOT, file), 'utf8'),
        ).includes('setDefaultEventParameters'),
      )
      .sort()

    expect(callers).toEqual(['./utils/analytics-default-params.ts'])
  })

  it('the layout writes both keys, each through the owner', () => {
    const source = stripComments(readFileSync(LAYOUT, 'utf8'))

    expect(source).toContain('setAnalyticsDefaultParams')
    expect(source).not.toContain('setDefaultEventParameters')
    // page_title, from the shared helper rather than a second regex.
    expect(source).toMatch(
      /setAnalyticsDefaultParams\(\{\s*page_title:\s*buildConsolePageTitle\(/,
    )
    // traffic_type, still via the named constant.
    expect(source).toMatch(
      /setAnalyticsDefaultParams\(\{\s*\[INTERNAL_TRAFFIC_PARAM\]/,
    )
  })

  it('reuses stripUnreadBadge rather than restating the pattern', () => {
    // AGL-2060's whole point: the writer of the badge and every reader that
    // removes it share ONE definition, so they cannot drift on `\d+\+?`.
    // A second regex somewhere else is how the capped `(99+)` form survives
    // a fix that looked complete.
    const builder = readFileSync(
      resolve(CONSOLE_ROOT, 'utils/page-view-params.ts'),
      'utf8',
    )
    expect(builder).toContain('stripUnreadBadge')

    const restated = execFileSync(
      'grep',
      ['-rlE', ...GREP_SCOPE, String.raw`\\\(\\d\+`, '.'],
      { cwd: CONSOLE_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .filter((file) => !/\.spec\.tsx?$/.test(file))
      .filter((file) => !file.includes('node_modules'))

    // Exactly one definition, next to the `unreadBadge` that writes it.
    expect(restated).toEqual(['./utils/notification-alerts.ts'])
  })
})
