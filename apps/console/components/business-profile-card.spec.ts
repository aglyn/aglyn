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

jest.mock('../constants/docs-links', () => ({ docsHelp: () => ({ title: '', excerpt: '', href: '' }) }))

import {
  businessProfileOwnerWrite,
  resolveBusinessProfile,
  type BusinessProfileDoc,
} from '@aglyn/aglyn/app-utils/business-profile'
import { fromForm, originLine, toForm } from './business-profile-card.component'

/**
 * The Business profile card's own logic (AGL-3661): services as one per
 * line, a cleared tone as no tone, and the line under each field that says
 * whose words Aglyn AI reads.
 */
describe('the business profile form', () => {
  const stored: BusinessProfileDoc = {
    services: ['Full groom', 'Nail trim'],
    tone: 'friendly',
    audience: 'Busy dog owners',
    sources: { services: 'start', tone: 'ai', audience: 'owner' },
  }

  it('puts services one per line and reads them back as a list', () => {
    expect(toForm(stored).services).toBe('Full groom\nNail trim')
    expect(fromForm({ services: 'Full groom\n\nBath and brush\n' }).services).toEqual([
      'Full groom',
      '',
      'Bath and brush',
      '',
    ])
    expect(businessProfileOwnerWrite(stored, fromForm({ ...toForm(stored), services: 'Full groom\n\nBath and brush\n' })).services).toEqual([
      'Full groom',
      'Bath and brush',
    ])
  })

  it('reads a cleared tone as none, and a save of an untouched form claims nothing', () => {
    expect(fromForm({ tone: '' }).tone).toBeNull()
    const next = businessProfileOwnerWrite(stored, fromForm(toForm(stored)))
    expect(next.sources).toEqual({ services: 'start', tone: 'ai', audience: 'owner' })
  })

  it('says a suggestion is one, and what fills an empty field', () => {
    const resolved = resolveBusinessProfile({
      host: { seo: { entity: { description: 'Mobile grooming in Austin' } as never } },
      site: stored,
      workspace: { serviceArea: 'Austin', sources: {} },
    })
    expect(originLine('services', stored, resolved, 'site', 'fallback')).toBe(
      'Your answers when the site was started. Edit it and it becomes yours.',
    )
    expect(originLine('tone', stored, resolved, 'site', 'fallback')).toBe(
      'Suggested by Aglyn AI. Edit it and it becomes yours.',
    )
    expect(originLine('audience', stored, resolved, 'site', 'fallback')).toBe('fallback')
    expect(originLine('whatYouDo', stored, resolved, 'site', 'fallback')).toBe(
      'Empty here, so Aglyn AI uses “Mobile grooming in Austin” from your SEO settings.',
    )
    expect(originLine('serviceArea', stored, resolved, 'site', 'fallback')).toBe(
      'Empty here, so Aglyn AI uses “Austin” from the workspace defaults.',
    )
    expect(originLine('serviceArea', stored, resolved, 'workspace', 'fallback')).toBe('fallback')
  })
})
