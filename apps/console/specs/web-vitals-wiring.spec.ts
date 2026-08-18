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
 * The console actually MOUNTS the web-vitals reporter (AGL-1642).
 *
 * The behaviour lives in `libs/aglyn` and has its own spec; what nothing
 * else asserts is the wiring — a refactor that drops the mount would leave
 * every behaviour test green while the console silently stops measuring,
 * which in GA reads exactly like fast pages. Source-level assertions, the
 * `site-analytics-independence.spec.ts` shape: the claim is about what the
 * files say, so the check reads the files.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file: string) =>
  readFileSync(resolve(__dirname, file), 'utf8')

describe('console web-vitals wiring (AGL-1642)', () => {
  it('the root layout mounts WebVitalsReporter beside ErrorBeacon — outside every page boundary', () => {
    const layout = read('../app/layout.tsx')
    expect(layout).toMatch(/from '\.\.\/components\/web-vitals-reporter\.component'/)
    expect(layout).toMatch(/<WebVitalsReporter \/>/)
    // Beside the beacon, inside Providers — not under any page subtree.
    expect(layout).toMatch(/<ErrorBeacon \/>[\s\S]*<WebVitalsReporter \/>[\s\S]*<\/Providers>/)
  })

  it('the reporter installs at module scope with the console surface', () => {
    const component = read('../components/web-vitals-reporter.component.tsx')
    // Module scope, not an effect: the ErrorBeacon argument — the thing that
    // reports a wedged page cannot be scheduled by the page.
    expect(component).toMatch(
      /^installWebVitalsReporting\(\{ surface: 'console' \}\)$/m,
    )
    expect(component).not.toMatch(/useEffect/)
  })

  it('the tenant runtime installs the same reporter with the site surface', () => {
    // Cross-app source assertion, matching how the tenant independence spec
    // reads console files: the two surfaces must stay on the same module so
    // the event shape cannot fork.
    const siteAnalytics = read(
      '../../tenant/app/[host]/[[...slug]]/site-analytics.tsx',
    )
    expect(siteAnalytics).toMatch(
      /from '@aglyn\/aglyn\/app-utils\/web-vitals-rum'/,
    )
    expect(siteAnalytics).toMatch(
      /installWebVitalsReporting\(\{ surface: 'site' \}\)/,
    )
  })
})
