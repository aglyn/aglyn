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

/**
 * The names a deleted site stops answering on: its custom domain and its
 * platform subdomain (AGL-3629), and the `www.` twin when the site claimed one.
 */
export function releasedHostNames(
  host: Record<string, unknown> | null | undefined,
): string[] {
  const clean = (value: unknown) =>
    typeof value === 'string' ? value.trim().toLowerCase().replace(/\.+$/, '') : ''
  const names: string[] = []
  const cname = clean(host?.['cname'])
  if (cname) names.push(cname)
  // The twin this site claimed for its domain (AGL-3961), when it has one.
  const twin = clean(host?.['cnameTwin'])
  if (twin && cname) names.push(twin)
  const subdomain = clean(host?.['subdomain'])
  if (subdomain) names.push(`${subdomain}.${TENANT_APEX}`)
  return names
}
