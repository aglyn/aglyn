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

jest.mock('@aglyn/tenant-feature-instance', () => ({}))
jest.mock('firebase/firestore', () => ({}))

import { holdsCampaignContainers } from './use-campaign-containers-blocked'

/** The console's half of `cloud/rules-crm-audience-writes.spec.mjs`, row for row (AGL-4047). */
describe('the console reads a campaign container’s key as the rule does', () => {
  it.each([
    ['the owner', { role: 'owner' }, true],
    ['an admin', { role: 'admin' }, true],
    ['an editor', { role: 'editor' }, true],
    ['a viewer', { role: 'viewer' }, false],
    ['an editor stamped before the key existed', { role: 'editor', resolvedPermissions: { 'site.edit': true } }, true],
    ['a viewer stamped before the key existed', { role: 'viewer', resolvedPermissions: { 'site.edit': false } }, false],
    ['a viewer a custom role grants it', { role: 'viewer', resolvedPermissions: { 'marketing.campaigns': true } }, true],
    ['an admin a custom role refuses it', { role: 'admin', resolvedPermissions: { 'marketing.campaigns': false } }, false],
    ['a viewer never stamped, whose override grants it', { role: 'viewer', permissions: { 'marketing.campaigns': true } }, true],
    ['an editor never stamped, whose override refuses it', { role: 'editor', permissions: { 'marketing.campaigns': false } }, false],
    [
      'a stamp ahead of an older override',
      { role: 'editor', resolvedPermissions: { 'marketing.campaigns': true }, permissions: { 'marketing.campaigns': false } },
      true,
    ],
    ['a site collaborator on the editor role', { role: 'editor', allHosts: false }, true],
    ['a site collaborator on the viewer role', { role: 'viewer', allHosts: false }, false],
  ])('%s: %s', (_name, member, held) => {
    expect(holdsCampaignContainers(member)).toBe(held)
  })
})
