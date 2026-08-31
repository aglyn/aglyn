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
 * HOW A PAGE BODY PUTS CONTROLS IN THE PAGE HEADER IT DOES NOT OWN.
 *
 * A route that renders its own `DashboardLayout` sets `headerRight`. A plugin
 * surface cannot: the console shell's generic host route owns the layout and
 * renders the surface as a child, and a child has no way to set its parent's
 * prop. `PageHeaderActions` closes that gap — the surface publishes, the
 * layout renders it beside the title.
 *
 * What is asserted here is the seam itself, with plain buttons standing in
 * for a real surface's controls: what reaches the header, what does NOT, and
 * what happens to the outgoing surface's controls when the body is swapped.
 * Every "the header is empty" assertion is paired with a control that puts
 * something in it through the same harness, because an empty header is also
 * what a seam that never worked at all would produce.
 */

import { render, screen, within } from '@testing-library/react'
import { PageHeaderActions } from '@aglyn/aglyn'
import type { ReactNode } from 'react'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  Container: ({ children }: any) => <div>{children}</div>,
  MdiIcon: () => null,
}))

jest.mock('@aglyn/shared-ui-jsx/components/background-image.component', () => ({
  __esModule: true,
  BackgroundImageComponent: ({ children }: any) => <header>{children}</header>,
}))

jest.mock('../components/breadcrumbs.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/docs-help-tip.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/quota-warnings-banner.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/search-discouraged-banner.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/footer.component', () => ({
  __esModule: true,
  default: () => null,
}))

import DashboardLayout from '../components/layouts/dashboard.layout'

/** The page header, by its landmark role — the bar the title sits in. */
const pageHeader = () => screen.getByRole('banner')

/** Buttons rendered inside the page header, by their labels. */
const headerButtons = () =>
  within(pageHeader())
    .queryAllByRole('button')
    .map((button) => button.textContent)

/** A surface that publishes one named control and draws its own body. */
function PublishingSurface(props: { label: string }) {
  return (
    <>
      <PageHeaderActions>
        <button type="button">{props.label}</button>
      </PageHeaderActions>
      <p>{`body of ${props.label}`}</p>
    </>
  )
}

/** A surface that publishes nothing — most of them. */
function QuietSurface() {
  return <p>{'body of the quiet surface'}</p>
}

function renderLayout(body: ReactNode, headerRight?: ReactNode) {
  return render(
    <DashboardLayout header={{ children: 'Surface' }} headerRight={headerRight}>
      {body}
    </DashboardLayout> as any,
  )
}

describe('a page body publishes into the header it does not own', () => {
  it('CONTROL: a published control reaches the header, and the body still renders', () => {
    renderLayout(<PublishingSurface label="Create Form" />)
    expect(headerButtons()).toEqual(['Create Form'])
    // The publisher renders nothing where it sits, so the surface's own body
    // has to survive the move — a seam that swallowed its children would
    // satisfy the header assertion alone.
    expect(screen.getByText('body of Create Form')).toBeTruthy()
  })

  it('leaves the header clean for a surface that publishes nothing', () => {
    renderLayout(<QuietSurface />)
    // Not merely "no button": the header must not grow an empty slot for the
    // controls that never arrived.
    expect(headerButtons()).toEqual([])
    expect(pageHeader().querySelectorAll('button')).toHaveLength(0)
    expect(screen.getByText('body of the quiet surface')).toBeTruthy()
  })

  it('empties the header when the publishing surface is replaced', () => {
    const { rerender } = renderLayout(<PublishingSurface label="Create Form" />)
    expect(headerButtons()).toEqual(['Create Form'])

    // The list surface giving way to a detail surface: same route, same
    // layout, different component. The outgoing surface's create button must
    // not be left standing over a page that cannot create anything.
    rerender(
      (
        <DashboardLayout header={{ children: 'Surface' }}>
          <QuietSurface />
        </DashboardLayout>
      ) as any,
    )
    expect(headerButtons()).toEqual([])
  })

  it('carries nothing from one publishing surface to the next', () => {
    const { rerender } = renderLayout(<PublishingSurface label="Create Form" />)
    rerender(
      (
        <DashboardLayout header={{ children: 'Surface' }}>
          <PublishingSurface label="Create Campaign" />
        </DashboardLayout>
      ) as any,
    )
    // One slot, so the arriving surface REPLACES rather than joins. Both
    // buttons standing together would be two surfaces' worth of actions over
    // whichever one is on screen.
    expect(headerButtons()).toEqual(['Create Campaign'])
  })

  it('lets a route that sets headerRight keep its own header', () => {
    renderLayout(
      <PublishingSurface label="Create Form" />,
      <button type="button">{'Route action'}</button>,
    )
    // One header, one author: a route that writes its header owns it, and a
    // body underneath cannot append to it or shout over it.
    expect(headerButtons()).toEqual(['Route action'])
  })

  it('is inert with no layout above it', () => {
    // A surface mounted outside the console shell — a test harness, a
    // storybook — publishes into nothing rather than throwing.
    render(<PublishingSurface label="Create Form" /> as any)
    expect(screen.getByText('body of Create Form')).toBeTruthy()
    expect(screen.queryByRole('banner')).toBeNull()
  })
})
