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
 * A picker narrowed to one kind reaches the library from every door
 * (AGL-2953).
 *
 * The library does the narrowing, and `media-library-type-filter.spec.tsx`
 * proves it does. What that file cannot see is whether a caller's `kind`
 * arrives: the dialog shows up to two libraries behind a tab, and the two
 * providers keep one dialog for a whole page and open it per request. A kind
 * dropped at any of those hops is a video field that offers every image
 * again, so each hop is asserted here against a library that records what it
 * was handed.
 */

import { useMediaPicker } from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import { useContext } from 'react'

const mockLibraries: Array<Record<string, unknown>> = []

jest.mock('../components/media/media-library.component', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockLibraries.push(props)
    return jest.requireActual('react').createElement('div', {
      'data-testid': props['orgId'] ? 'org-library' : 'site-library',
      'data-kind': String(props['kind'] ?? ''),
    })
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  // A site with an org, so the dialog shows both libraries behind its tabs.
  useHostOrgId: () => 'org-1',
}))

jest.mock('notistack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: undefined, status: 'loading' }),
}))

// The canvas's asset facts read Firestore, and nothing here is about them.
jest.mock('../components/besigner-media-asset-facts-provider.component', () => ({
  __esModule: true,
  default: (props: { children?: unknown }) => props.children,
}))

// The designer's context by path, rather than the whole designer barrel.
jest.mock('@aglyn/besigner-ui', () => ({
  __esModule: true,
  MediaPickerContext: jest.requireActual(
    '@aglyn/besigner-ui/contexts/media-picker-context',
  ).MediaPickerContext,
}))

import { MediaPickerContext as DesignerMediaPickerContext } from '@aglyn/besigner-ui'
import BesignerMediaPickerProvider from '../components/besigner-media-picker-provider.component'
import ConsoleMediaPickerProvider from '../components/console-media-picker-provider.component'
import MediaPickerDialog from '../components/media/media-picker-dialog.component'

const kindOf = (testId: string) =>
  screen.getByTestId(testId).getAttribute('data-kind')

beforeEach(() => {
  mockLibraries.length = 0
})

describe('the dialog hands its kind to both libraries (AGL-2953)', () => {
  it('narrows the site library and the organization library alike', () => {
    render(
      <MediaPickerDialog
        hostId="host-1"
        open
        kind="video"
        onClose={() => undefined}
        onPick={() => undefined}
      />,
    )
    expect(kindOf('site-library')).toBe('video')

    fireEvent.click(screen.getByRole('tab', { name: 'Organization (shared)' }))
    expect(kindOf('org-library')).toBe('video')
    // Still scoped to the site it is picking for.
    expect(mockLibraries[mockLibraries.length - 1]).toEqual(
      expect.objectContaining({ orgId: 'org-1', forHostId: 'host-1' }),
    )
  })

  it('names the kind it offers', () => {
    render(
      <MediaPickerDialog
        hostId="host-1"
        open
        kind="video"
        onClose={() => undefined}
        onPick={() => undefined}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Choose a video' })).toBeTruthy()
  })

  it('offers everything, as before, when no kind is given', () => {
    render(
      <MediaPickerDialog
        hostId="host-1"
        open
        onClose={() => undefined}
        onPick={() => undefined}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Choose media' })).toBeTruthy()
    expect(kindOf('site-library')).toBe('')
    expect(mockLibraries.every((props) => props['kind'] === undefined)).toBe(true)
  })
})

/** Opens the plugin-facing picker with whatever options the button names. */
function PluginOpener(props: { kind?: 'video' }) {
  const { pickMedia } = useMediaPicker()
  return (
    <button
      type="button"
      onClick={() => void pickMedia?.(props.kind ? { kind: props.kind } : undefined)}
    >
      {props.kind ? 'Pick a video' : 'Pick anything'}
    </button>
  )
}

describe('the plugin-facing provider narrows per request (AGL-2953)', () => {
  it('passes a request’s kind on, and lets the next request go unnarrowed', () => {
    render(
      <ConsoleMediaPickerProvider hostId="host-1" orgId="org-1">
        <PluginOpener kind="video" />
        <PluginOpener />
      </ConsoleMediaPickerProvider>,
    )

    fireEvent.click(screen.getByText('Pick a video'))
    expect(kindOf('site-library')).toBe('video')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByText('Pick anything'))
    expect(kindOf('site-library')).toBe('')
  })
})

/** Opens the designer's picker the way an attribute's Browse media does. */
function DesignerOpener(props: { kind?: 'video' }) {
  const { onPickMedia } = useContext(DesignerMediaPickerContext)
  return (
    <button
      type="button"
      onClick={() =>
        onPickMedia?.(() => undefined, props.kind ? { kind: props.kind } : undefined)
      }
    >
      {props.kind ? 'Browse a video' : 'Browse anything'}
    </button>
  )
}

describe('the besigner provider narrows per Browse media (AGL-2953)', () => {
  it('passes the attribute’s kind on, and does not carry it to the next pick', () => {
    render(
      <BesignerMediaPickerProvider hostId="host-1">
        <DesignerOpener kind="video" />
        <DesignerOpener />
      </BesignerMediaPickerProvider>,
    )

    fireEvent.click(screen.getByText('Browse a video'))
    expect(kindOf('site-library')).toBe('video')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByText('Browse anything'))
    expect(kindOf('site-library')).toBe('')
  })
})
