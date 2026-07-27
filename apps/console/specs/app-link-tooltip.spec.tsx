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
import { AppLink } from '@aglyn/shared-ui-jsx'
import { Tooltip } from '@mui/material'
import { render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({ usePathname: () => '/' }))

/**
 * AGL-926: MUI `Tooltip` clones its child and attaches a ref, then reads
 * `childNode.getAttribute('title')`. Any AppLink variant used as a tooltip
 * child therefore has to land the ref on a real DOM node.
 */
describe('AppLink as a Tooltip child (AGL-926)', () => {
  const variants = [
    'naked',
    'button',
    'button-base',
    'icon-button',
    'fab',
    'text',
  ] as const

  it.each(variants)('%s forwards a DOM ref to Tooltip', (componentVariant) => {
    render(
      <Tooltip title="tip">
        <AppLink
          componentVariant={componentVariant as any}
          href="/docs"
          aria-label={`link-${componentVariant}`}
        >
          {'link'}
        </AppLink>
      </Tooltip>,
    )

    expect(screen.getByLabelText(`link-${componentVariant}`)).toBeTruthy()
  })
})
