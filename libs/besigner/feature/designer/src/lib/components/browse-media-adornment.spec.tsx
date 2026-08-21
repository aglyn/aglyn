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

import * as Aglyn from '@aglyn/aglyn'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { MediaPickerContext } from '../contexts/media-picker-context'
import { ElementPropsForm } from './element-props-form.component'

/**
 * AGL-2236. The Image element's `src` helper text has told authors since
 * AGL-1215 to "Pick from your media library with 'Browse media'". The
 * control existed (AGL-341) but rendered AFTER the form — below the Save
 * Element button, past every other attribute — so on the Image element it
 * sat six fields and a submit button away from the field it fills, and with
 * one media attribute it read only "Browse media", naming no field. Authors
 * reported it as missing and hand-typed `media:org:…/…` references instead,
 * which is the failure the whole no-code premise cannot afford.
 *
 * These assertions are deliberately NOT "the helper string is present" —
 * that string was always right, and a test on it is exactly the vacuous
 * check that let this ship. Each one below fails if the control is absent,
 * detached from its field, or wired to nothing:
 *
 * - it must render INSIDE the Image source field's own form control, not
 *   merely somewhere in the panel;
 * - clicking it must reach the host app's picker;
 * - the value the picker returns must land on the attribute it was opened
 *   for.
 */

const IMAGE_SCHEMA = {
  displayName: 'Image',
  attributes: [
    {
      name: 'src',
      description:
        'Pick from your media library with "Browse media", or paste the ' +
        'URL of an image hosted somewhere else.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Image source',
    },
    {
      name: 'alt',
      description: 'Describes the image for screen readers.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Alt text',
    },
  ],
}

const imageNode = (props: Record<string, unknown> = {}) =>
  ({
    $id: 'node-1',
    componentSchema: IMAGE_SCHEMA,
    props: { src: 'media:org:jWmGooWE3L/4GF1hRJBUp', ...props },
  }) as never

function renderPanel(options: {
  onPickMedia?: MediaPickerContextValueOnPick
  node?: unknown
} = {}) {
  const { onPickMedia, node = imageNode() } = options
  return render(
    <MediaPickerContext.Provider value={onPickMedia ? { onPickMedia } : {}}>
      <ElementPropsForm node={node as never} />
    </MediaPickerContext.Provider>,
  )
}

type MediaPickerContextValueOnPick = (
  onPick: (value: string, asset?: { alt?: string }) => void,
) => void

/**
 * The MUI form control wrapping a labelled field.
 *
 * Located from the rendered `<label>` rather than by `getByLabelText`: the
 * token editor's input is a contentEditable surface, not an `<input>`, so
 * there is no labelled form element for that query to find.
 */
const fieldControlFor = (label: string) =>
  screen
    .getByText(label, { selector: 'label' })
    .closest('.MuiFormControl-root') as HTMLElement

describe('Browse media, on the field it fills (AGL-2236)', () => {
  it('renders inside the Image source field, not adrift in the panel', () => {
    renderPanel({ onPickMedia: jest.fn() })

    const sourceField = fieldControlFor('Image source')
    expect(sourceField).toBeTruthy()
    // The whole point of the issue: `within`, not `screen`. A button
    // anywhere on the panel passes a `screen` query — that is precisely the
    // arrangement authors could not find.
    expect(
      within(sourceField).getByRole('button', { name: 'Browse media' }),
    ).toBeTruthy()
  })

  it('leaves an attribute that cannot hold an asset alone', () => {
    renderPanel({ onPickMedia: jest.fn() })

    // Alt text is a text attribute on the same element. A picker here would
    // write an asset reference into a field a screen reader reads aloud.
    expect(
      within(fieldControlFor('Alt text')).queryByRole('button', {
        name: 'Browse media',
      }),
    ).toBeNull()
  })

  it('offers nothing when the host app supplies no media browser', () => {
    // The designer stays storage-agnostic: with no picker in context there
    // is no library to browse, so the control must not appear at all rather
    // than appear and do nothing.
    renderPanel()

    expect(screen.queryByRole('button', { name: 'Browse media' })).toBeNull()
  })

  it('opens the host app picker when clicked', () => {
    const onPickMedia = jest.fn()
    renderPanel({ onPickMedia })

    fireEvent.click(
      within(fieldControlFor('Image source')).getByRole('button', {
        name: 'Browse media',
      }),
    )

    // Rendering the button is half of it; this is the half that was never
    // in question and must not silently regress into a no-op.
    expect(onPickMedia).toHaveBeenCalledTimes(1)
  })

  it("writes the picked asset onto the attribute it was opened for", () => {
    const node = imageNode({ alt: '' })
    // Drive the real commit path rather than asserting on the callback: the
    // button is only useful if the pick reaches the canvas node.
    const updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as never)
    jest
      .spyOn(Aglyn.canvas, 'toJSON')
      .mockReturnValue({
        nodes: { 'node-1': { props: { src: 'media:org:old/one', alt: '' } } },
      } as never)

    let deliver: ((value: string, asset?: { alt?: string }) => void) | null =
      null
    renderPanel({ onPickMedia: (onPick) => (deliver = onPick), node })

    fireEvent.click(
      within(fieldControlFor('Image source')).getByRole('button', {
        name: 'Browse media',
      }),
    )
    expect(deliver).toBeTruthy()
    ;(deliver as never as (v: string, a?: { alt?: string }) => void)(
      'media:org:jWmGooWE3L/newAsset',
      { alt: 'A blue kettle' },
    )

    expect(updateNodeProps).toHaveBeenCalledTimes(1)
    const [, patch] = updateNodeProps.mock.calls[0] as [unknown, any]
    expect(patch.src).toBe('media:org:jWmGooWE3L/newAsset')
    // AGL-1896 rides along on the same pick — a blank alt defaults from the
    // asset's own authored alt text.
    expect(patch.alt).toBe('A blue kettle')

    jest.restoreAllMocks()
  })
})
