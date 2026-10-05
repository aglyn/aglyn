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
 * A form in a site package import (AGL-3545): the Forms plugin registers the
 * widget that draws it in the import's `sitePackageItemPreview` zone, for the
 * `form` kind alone, and each side is the form's own preview of the design
 * that side carries.
 */

import { CANVAS_ROOT_ELEMENT_ID, CONSOLE_WIDGET_SLOTS, listConsoleWidgets } from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { registerFormsConsole } from '../plugin'
import { SitePackageFormPreview } from './site-package-form-preview.component'

function design(fieldNames: readonly string[]) {
  const nodes: Record<string, unknown> = {
    [CANVAS_ROOT_ELEMENT_ID]: { $id: CANVAS_ROOT_ELEMENT_ID, componentId: 'div', nodes: ['theForm'] },
    theForm: {
      $id: 'theForm',
      componentId: 'form',
      parentId: CANVAS_ROOT_ELEMENT_ID,
      props: { formId: 'contact' },
      nodes: fieldNames.map((_name, index) => `f${index}`),
    },
  }
  fieldNames.forEach((fieldName, index) => {
    nodes[`f${index}`] = {
      $id: `f${index}`,
      componentId: 'formField',
      parentId: 'theForm',
      props: { fieldName, fieldType: 'text' },
    }
  })
  return nodes
}

const props = (side: 'site' | 'file', content: unknown) => ({
  hostId: 'host-1',
  side,
  itemKey: 'form/contact',
  kind: 'form',
  itemId: 'contact',
  content,
  title: 'Contact',
})

describe('a form in a site package import', () => {
  it('is drawn by this plugin`s widget, for forms alone', () => {
    registerFormsConsole()
    const widgets = listConsoleWidgets(CONSOLE_WIDGET_SLOTS.sitePackageItemPreview, [BUNDLE_ID])
    expect(widgets.map(({ widget }) => [widget.widgetId, widget.itemKinds])).toEqual([
      ['forms-site-package-preview', ['form']],
    ])
  })

  it('draws the fields a submission arrives under, from the design the side carries', () => {
    const { container } = render(
      <SitePackageFormPreview {...props('file', { nodes: design(['email', 'phone']), consentFieldName: 'phone' })} />,
    )
    const document = container.querySelector('iframe')?.getAttribute('srcdoc') ?? ''
    expect(document).toContain('name="email"')
    expect(document).toContain('name="phone"')
    expect(document).toContain('marketing consent')
  })

  it('says so when a side carries no design', () => {
    render(<SitePackageFormPreview {...props('site', { displayName: 'Contact' })} />)
    expect(screen.getByText('This site’s copy has no published design.')).toBeTruthy()
  })
})
