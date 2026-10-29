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
 * "PUBLISH AS A STARTER", BESIDE "PUBLISH AS TEMPLATE" (AGL-4049).
 *
 * Setup → Backup & restore's Site template card offers the whole site as a
 * site starter too: the same `hostArtifactPublish` zone, handed a
 * `siteStarter` artifact with the site's name and description to seed the
 * listing. Site starters are released behind `release_site_starters`, so the
 * offer is there while the flag is on or the reader is staff (with the staff
 * marker), and absent otherwise: a release flag is a platform gate, not a
 * step the workspace can take.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const zone: { artifact: unknown } = { artifact: null }
const flag = { released: true, isStaff: false, ready: true }

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header }: { children: ReactNode; header: ReactNode }) => (
    <section aria-label={String(header)}>{children}</section>
  ),
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => undefined }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ orgId: 'org-1' }),
}))
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlag: () => ({
    ...flag,
    visible: flag.released || flag.isStaff,
    staffPreview: flag.isStaff && !flag.released,
  }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHost: () => ({
    doc: {
      data: {
        displayName: 'Corner bistro',
        seo: { description: 'A warm neighborhood restaurant' },
      },
    },
  }),
}))
jest.mock('../components/plugin-widget-slot.component', () => ({
  __esModule: true,
  useSlotWidgets: () => ({ widgets: [{ widgetId: 'marketplace-publish-artifact' }], ready: true }),
  default: (props: { artifact: unknown }) => {
    zone.artifact = props.artifact
    return null
  },
}))

import SiteTemplateCard from '../components/site-template-card.component'

beforeEach(() => {
  zone.artifact = null
  flag.released = true
  flag.isStaff = false
  flag.ready = true
})

describe('the Site template card offers the site as a starter', () => {
  it('offers Publish as a starter beside Publish as template', () => {
    render(<SiteTemplateCard hostId="h1" />)
    expect(screen.getByRole('button', { name: 'Publish as template' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Publish as a starter' })).toBeTruthy()
  })

  it('hands the publish zone the site as a starter, its name and description seeding the listing', () => {
    render(<SiteTemplateCard hostId="h1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish as a starter' }))
    expect(zone.artifact).toEqual({
      kind: 'siteStarter',
      hostId: 'h1',
      orgId: 'org-1',
      displayName: 'Corner bistro',
      description: 'A warm neighborhood restaurant',
    })
  })

  it('still hands Publish as template the site as a template', () => {
    render(<SiteTemplateCard hostId="h1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish as template' }))
    expect(zone.artifact).toEqual({ kind: 'site', hostId: 'h1', orgId: 'org-1' })
  })

  it('is not offered while site starters are not released to the workspace', () => {
    flag.released = false
    render(<SiteTemplateCard hostId="h1" />)
    expect(screen.queryByRole('button', { name: 'Publish as a starter' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Publish as template' })).toBeTruthy()
  })

  it('shows staff the offer with the staff marker while it is not released', () => {
    flag.released = false
    flag.isStaff = true
    const { container } = render(<SiteTemplateCard hostId="h1" />)
    expect(screen.getByRole('button', { name: 'Publish as a starter' })).toBeTruthy()
    expect(container.querySelector('[data-staff-only="release_site_starters"]')).not.toBeNull()
  })

  it('carries no staff marker once released', () => {
    const { container } = render(<SiteTemplateCard hostId="h1" />)
    expect(container.querySelector('[data-staff-only]')).toBeNull()
  })
})
