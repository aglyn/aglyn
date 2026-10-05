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

import {
  crmEmailTemplateDependencies,
  crmEmailTemplatePackageContent,
  crmEmailTemplatePackageProblems,
  remapCrmEmailTemplateIds,
} from './email-templates-package'

describe('an email template as a package item (AGL-3535)', () => {
  it('carries what a person reads, never who wrote it, and no subject on a snippet', () => {
    const content = crmEmailTemplatePackageContent({
      name: 'Intro',
      kind: 'snippet',
      visibility: 'personal',
      ownerUid: 'someone',
      subject: 'ignored',
      body: 'Hello {{contact.firstName}}',
      hostId: 'host-1',
      createdByUid: 'someone',
      createdAtMs: 5,
    })
    expect(content).toEqual({ name: 'Intro', kind: 'snippet', visibility: 'personal', subject: '', body: 'Hello {{contact.firstName}}', hostId: 'host-1' })
  })

  it('names its site, and becomes the organization’s own when the site is dropped', () => {
    const content = crmEmailTemplatePackageContent({ name: 'Intro', body: 'x', hostId: 'host-1' })
    expect(crmEmailTemplateDependencies(content)).toEqual([{ kind: 'site', id: 'host-1' }])
    expect(remapCrmEmailTemplateIds(content, new Map([['site/host-1', '']])).hostId).toBeNull()
    expect(remapCrmEmailTemplateIds(content, new Map([['site/host-1', 'host-2']])).hostId).toBe('host-2')
  })

  it('refuses a template with no name or no text', () => {
    expect(crmEmailTemplatePackageProblems(crmEmailTemplatePackageContent({ name: ' ', body: '' }))).toEqual([
      'Name the template.',
      'A template needs its text.',
    ])
  })
})
