/**
 * @license
 * Copyright 2022 Aglyn LLC
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

export type TenantSite = {
  name: string
  description: string
  subdomain: string
  cname?: string
  paths: string[]
}
export const mockDB: TenantSite[] = [
  {
    name: 'Site 1',
    description: 'Subdomain + custom domain',
    subdomain: 'myhost-1',
    cname: 'custom-domain-1.com',
    paths: ['/index', '/aa'],
  },
  {
    name: 'Site 2',
    description: 'Subdomain only',
    subdomain: 'myhost-2',
    cname: null,
    paths: ['/index', '/aa'],
  },
  {
    name: 'Site 3',
    description: 'Subdomain only',
    subdomain: 'myhost-3',
    cname: null,
    paths: ['/index', '/aa'],
  },
]
