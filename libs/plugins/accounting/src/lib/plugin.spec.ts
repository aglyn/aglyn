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

import { listConsoleExtensions } from '@aglyn/aglyn'
import { registerAccountingConsole } from './plugin'

describe('the accounting console registration (AGL-3614)', () => {
  it('registers one org page behind the release tab, the commerce entitlement and its permission', () => {
    registerAccountingConsole()
    const extension = listConsoleExtensions().find((entry) => entry.pluginId === 'accounting')
    expect(extension).toMatchObject({
      displayName: 'Accounting',
      permission: 'accounting.manage',
      featureFlag: 'commerce',
    })
    expect(extension?.orgNavItems?.[0]).toMatchObject({
      href: '/accounting',
      navTabId: 'nav-tab-org-accounting',
      sections: [{ id: 'connection' }, { id: 'activity' }],
    })
    expect(extension?.navItems ?? []).toEqual([])
  })
})
