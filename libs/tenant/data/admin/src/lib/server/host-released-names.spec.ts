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

import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import { releasedHostNames } from './host-released-names'

describe('releasedHostNames (AGL-3629)', () => {
  it('names the custom domain and the platform subdomain a deleted site leaves', () => {
    expect(releasedHostNames({ cname: ' Shop.Example.com. ', subdomain: 'Shop' })).toEqual([
      'shop.example.com',
      `shop.${TENANT_APEX}`,
    ])
  })

  it('names only what the site had', () => {
    expect(releasedHostNames({ subdomain: 'shop' })).toEqual([`shop.${TENANT_APEX}`])
    expect(releasedHostNames({ cname: 'example.com' })).toEqual(['example.com'])
    expect(releasedHostNames(undefined)).toEqual([])
    expect(releasedHostNames({ cname: 42, subdomain: null })).toEqual([])
  })
})
