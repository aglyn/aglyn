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
 * The tab strip on a page that no tab owns (AGL-3596). A site's Dashboard
 * href is the site's own address, so it is a prefix of every path beneath the
 * site: a strip that chose from the pathname alone selected the Dashboard on
 * an unlisted page such as `/ai-jobs/{jobId}`. `activeTab={null}` is the
 * resolver's "no tab", and the strip draws nothing selected.
 */

let mockPathname = '/acme/hosts/shop/ai-jobs/job-1'
jest.mock('next/navigation', () => ({
  __esModule: true,
  usePathname: () => mockPathname,
}))

import { render, screen } from '@testing-library/react'
import { AppLinkTabsComponent } from '../components/app-link-tabs.component'

const BASE = '/acme/hosts/shop'
const items = [
  { id: 'dashboard', label: 'Dashboard', href: BASE },
  { id: 'screens', label: 'Pages', href: `${BASE}/screens` },
]

const selected = () =>
  screen
    .getAllByRole('tab')
    .filter((tab) => tab.getAttribute('aria-selected') === 'true')
    .map((tab) => tab.textContent)

beforeAll(() => {
  // jsdom has neither; the strip observes its own width to keep the selected
  // tab in view.
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

describe('a page no tab owns', () => {
  it('selects no tab when the resolver answers null', () => {
    mockPathname = `${BASE}/ai-jobs/job-1`
    render(<AppLinkTabsComponent items={items} activeTab={null} />)
    expect(selected()).toEqual([])
  })

  it('is the Dashboard by prefix when nothing was resolved — the bug a null answer prevents', () => {
    mockPathname = `${BASE}/ai-jobs/job-1`
    render(<AppLinkTabsComponent items={items} />)
    expect(selected()).toEqual(['Dashboard'])
  })

  it('still selects the resolved tab', () => {
    mockPathname = `${BASE}/screens/abc`
    render(<AppLinkTabsComponent items={items} activeTab={`${BASE}/screens`} />)
    expect(selected()).toEqual(['Pages'])
  })
})
