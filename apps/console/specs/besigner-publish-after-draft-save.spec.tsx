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
 * A saved draft turns the toolbar into Publish (AGL-3271).
 *
 * On the version a site is serving, `Save draft` writes the working draft
 * document and deliberately leaves the version alone — so `saveAvailable`
 * stays true for as long as the draft is unpublished. The split button's
 * middle state was gated on `!saveAvailable`, which made it unreachable
 * exactly where it matters most: the author saved, was told the draft saved,
 * and the button still read `Save draft` with the publish they were waiting
 * for reachable only from the chevron menu.
 *
 * What this spec pins:
 *  - a drafted canvas whose live site is behind reads `Publish`, and clicking
 *    it publishes rather than saving another draft;
 *  - the author's next edit takes it back to `Save draft`, because the draft
 *    no longer holds what is on the canvas;
 *  - the states that have nothing to do with a draft are untouched.
 */

import { fireEvent, render, screen } from '@testing-library/react'

/**
 * The besigner's own toolbar controls drag the canvas singleton and the whole
 * editor UI in with them. Nothing here is about what they render — the save
 * control is the subject — so they are stubbed to keep this a fast render of
 * the real `BesignerAppBarComponent`.
 */
jest.mock('@aglyn/besigner-ui', () => ({
  AddControlsComponent: () => null,
  DevicePreviewControlsComponent: () => null,
  HistoryControlsComponent: () => null,
  PanelControlsComponent: () => null,
  SchemePreviewControlsComponent: () => null,
}))

import { BesignerAppBarComponent } from '../components/besigner-app-bar.component'

const onSave = jest.fn()
const onSaveAndPublish = jest.fn()

function renderBar(props: {
  saveAvailable?: boolean
  draftSaved?: boolean
  livePublished?: boolean
}) {
  return render(
    <BesignerAppBarComponent
      detailsUrl="/console/host/components"
      onSave={onSave}
      onSaveAndPublish={onSaveAndPublish}
      {...props}
    />,
  )
}

/** The primary half of the split button, by the label it is showing. */
function primary(): HTMLElement {
  const [button] = screen.getAllByRole('button', {
    name: /Save draft|Publish|Up to date/,
  })
  return button
}

describe('the besigner toolbar after a draft save', () => {
  beforeEach(() => {
    onSave.mockClear()
    onSaveAndPublish.mockClear()
  })

  it('says Publish once the canvas is in the working draft', () => {
    // The canvas still differs from the VERSION document, and always will
    // until the draft is published — that is what the draft is.
    renderBar({ saveAvailable: true, draftSaved: true, livePublished: false })

    expect(primary().textContent).toContain('Publish')
  })

  it('publishes on that click rather than saving the draft again', () => {
    renderBar({ saveAvailable: true, draftSaved: true, livePublished: false })

    fireEvent.click(primary())

    expect(onSaveAndPublish).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('goes back to Save draft on the next edit', () => {
    // The draft holds what it was given, not what the canvas has become.
    renderBar({ saveAvailable: true, draftSaved: false, livePublished: false })

    expect(primary().textContent).toContain('Save draft')

    fireEvent.click(primary())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSaveAndPublish).not.toHaveBeenCalled()
  })

  it('leaves the states that have no draft in them alone', () => {
    // A saved version that is not the live one still says Publish…
    const saved = renderBar({ saveAvailable: false, livePublished: false })
    expect(primary().textContent).toContain('Publish')
    saved.unmount()

    // …and a saved version the site is serving still says Up to date.
    renderBar({ saveAvailable: false, draftSaved: false, livePublished: true })
    expect(primary().textContent).toContain('Up to date')
  })

  it('does not call a drafted canvas Up to date for want of a publish story', () => {
    // `livePublished` undefined is an editor with no publish concept at all.
    // Drafted or not, the work is not in the document, so the only honest
    // label is the one that saves it.
    renderBar({ saveAvailable: true, draftSaved: true })

    expect(primary().textContent).toContain('Save draft')
  })
})

describe('the save menu names what publishing changes (AGL-3318)', () => {
  it('speaks of the live site by default', () => {
    renderBar({ saveAvailable: true, livePublished: true })
    fireEvent.click(screen.getByRole('button', { name: 'Save options' }))
    expect(
      screen.getByText('Keeps your work; the live site is unchanged'),
    ).toBeTruthy()
    expect(screen.getByText('Saves, then updates the live site')).toBeTruthy()
  })

  it('speaks of emails for a site email or an email block', () => {
    render(
      <BesignerAppBarComponent
        detailsUrl="/console/host/emails"
        onSave={onSave}
        onSaveAndPublish={onSaveAndPublish}
        saveAvailable
        livePublished
        publishTarget="email"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save options' }))
    expect(
      screen.getByText('Keeps your work; your emails are unchanged'),
    ).toBeTruthy()
    expect(
      screen.getByText('Saves, then your emails send this version'),
    ).toBeTruthy()
    expect(screen.queryByText(/live site/)).toBeNull()
  })
})
