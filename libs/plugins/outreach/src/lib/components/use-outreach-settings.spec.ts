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
 * THE SETTINGS READ MAY NOT BE THE REASON IT RUNS AGAIN (AGL-3279).
 *
 * Compliance reported React's "Maximum update depth exceeded" once, and
 * the mechanism this hook offered was a `setState` that stored a fresh
 * object on every run of its effect whether or not anything had changed.
 * With a stable `api` that is a wasted render; with an unstable one it is a
 * loop, because the render remakes the dependency that runs the effect.
 *
 * So the contract is measured as the number of RENDERS a mount costs when
 * the api identity changes underneath it — not as "the state looks right",
 * which it always did.
 */

import { act, renderHook } from '@testing-library/react'
import type { OutreachApi } from './use-outreach-api'
import { useOutreachComplianceSettings } from './use-outreach-settings'

const SETTINGS = {
  legalName: 'Aglyn LLC',
  brandName: 'Aglyn',
  postalAddress: '1 Example St',
  allowedCountries: ['US'],
}

/** An api whose identity is FRESH every render — the unstable case. */
function freshApi(): OutreachApi {
  return {
    readSettings: () => Promise.resolve({ settings: SETTINGS }),
  } as unknown as OutreachApi
}

it('settles rather than re-rendering itself while the api identity churns', async () => {
  let renders = 0
  const view = renderHook(() => {
    renders += 1
    return useOutreachComplianceSettings(freshApi(), 'org-1')
  })

  // Let the read resolve, then push a render from the outside: every one of
  // these hands the effect a brand-new `api`, so the effect runs again.
  await act(async () => undefined)
  const settled = renders
  view.rerender()
  await act(async () => undefined)

  expect(view.result.current.settings).toEqual(SETTINGS)
  // One render for the rerender itself, and one for the resolved read that
  // the fresh api issued — never a cascade. Before the guard the effect's
  // own `setState` added one more on every pass, which is what turns an
  // unstable dependency into "Maximum update depth exceeded".
  expect(renders - settled).toBeLessThanOrEqual(2)
})
