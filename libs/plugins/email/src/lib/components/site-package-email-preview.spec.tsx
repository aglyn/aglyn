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
 * A site email in a site package import (AGL-3545): the Email plugin
 * registers the widget that draws it in the import's `sitePackageItemPreview`
 * zone, for site emails alone, and each side goes through the email preview
 * with the design, subject and preheader that side carries.
 */

import { CONSOLE_WIDGET_SLOTS, listConsoleWidgets } from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { registerEmailConsole } from '../plugin'
import { SitePackageEmailPreview } from './site-package-email-preview'

const mockPreview = jest.fn()
jest.mock('./email-design-preview', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockPreview(props)
    return <p>{String(props['emptyMessage'])}</p>
  },
}))

const props = (side: 'site' | 'file', content: unknown) => ({
  hostId: 'host-1',
  side,
  itemKey: 'emailTemplate/orderConfirmation',
  kind: 'emailTemplate',
  itemId: 'orderConfirmation',
  content,
  title: 'Order confirmation',
})

describe('a site email in a site package import', () => {
  beforeEach(() => mockPreview.mockClear())

  it('is drawn by this plugin`s widget, for site emails alone', () => {
    registerEmailConsole()
    const widgets = listConsoleWidgets(CONSOLE_WIDGET_SLOTS.sitePackageItemPreview, [BUNDLE_ID])
    expect(widgets.map(({ widget }) => [widget.widgetId, widget.itemKinds])).toEqual([
      ['email-site-package-preview', ['emailTemplate']],
    ])
  })

  it('hands the email preview the design the side publishes, with its subject and preheader', () => {
    const nodes = { _: { $id: '_' } }
    render(
      <SitePackageEmailPreview
        {...props('file', { subject: 'Thanks!', preheader: 'Your order', version: { nodes } })}
      />,
    )
    expect(mockPreview).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: 'host-1', nodes, subject: 'Thanks!', preheader: 'Your order' }),
    )
  })

  it('says a side without a design sends the built-in email', () => {
    render(<SitePackageEmailPreview {...props('site', { subject: '' })} />)
    expect(mockPreview.mock.calls[0]?.[0]).not.toHaveProperty('subject')
    expect(
      screen.getByText('This site’s copy has no design, so the site sends its built-in email.'),
    ).toBeTruthy()
  })
})
