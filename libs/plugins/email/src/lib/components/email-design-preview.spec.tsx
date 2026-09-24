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
 * THE PREVIEW SHOWS THE HEADER THE INBOX GETS (AGL-3287).
 *
 * A shared header or footer placed in a design is a component reference, and
 * the mail renderer draws a reference as nothing. The send path grafts the
 * site's components first; a preview that did not would show an email with
 * its header missing — a picture of a message nobody sends. These render the
 * preview against a client Firestore double holding the site's components and
 * read the frame.
 */

import { render, screen, waitFor } from '@testing-library/react'

/** The site's component documents, by path, as the client SDK hands them. */
const mockComponents = new Map<string, Record<string, unknown>>()
/** Every document path the preview asked for. */
const mockGets: string[] = []
/** Paths whose read fails, as a dropped connection would. */
const mockFailing = new Set<string>()

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  getDoc: async (ref: { __path: string }) => {
    mockGets.push(ref.__path)
    if (mockFailing.has(ref.__path)) throw new Error('unavailable')
    const data = mockComponents.get(ref.__path)
    return { exists: () => data !== undefined, data: () => data }
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => {
  // One handle for the whole file, as the provider's context gives one.
  const firestore = { __firestore: true }
  return { __esModule: true, useFirestore: () => firestore }
})

import { EmailDesignPreview } from './email-design-preview'

const ROOT = '_@_'

/** The site's header: its line bound to the component's `title` property. */
const HEADER = {
  rootId: 'hdrSec',
  props: [{ name: 'title', type: 'text', defaultValue: 'Acme news' }],
  nodes: {
    hdrSec: { $id: 'hdrSec', componentId: 'emailSection', nodes: ['hdrText'] },
    hdrText: {
      $id: 'hdrText',
      componentId: 'emailText',
      parentId: 'hdrSec',
      props: { children: 'Acme header: {{prop.title}}' },
    },
  },
}

/** A design with the header placed above one line of its own. */
const PLACED = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['hdr', 'body'] },
  hdr: {
    $id: 'hdr',
    componentId: 'reusableInstance',
    parentId: ROOT,
    props: { refId: 'header-1', propValues: { title: 'Spring edition' } },
    nodes: [],
  },
  body: {
    $id: 'body',
    componentId: 'emailText',
    parentId: ROOT,
    props: { children: 'Hi {{contact.firstName}}, the sale is on.' },
  },
}

const frame = () =>
  document.querySelector(
    'iframe[title="Email preview"]',
  ) as HTMLIFrameElement | null

const preview = (nodes: unknown) =>
  render(
    <EmailDesignPreview
      hostId="host-1"
      nodes={nodes}
      subject="Spring sale"
      emptyMessage="Nothing to draw."
    />,
  )

beforeEach(() => {
  mockComponents.clear()
  mockGets.length = 0
  mockFailing.clear()
  // A component the design does NOT place, on the same site.
  mockComponents.set('hosts/host-1/components/pricing', HEADER)
})

describe('a design placing the site’s header', () => {
  it('draws the header, with the placement’s own value, as the send would', async () => {
    mockComponents.set('hosts/host-1/components/header-1', HEADER)
    preview(PLACED)

    await waitFor(() =>
      expect(frame()?.getAttribute('srcdoc')).toContain(
        'Acme header: Spring edition',
      ),
    )
    expect(frame()?.getAttribute('srcdoc')).toContain(
      'Hi {{contact.firstName}}, the sale is on.',
    )
    // Still the maximally restrictive sandbox: a graft changes what is drawn,
    // never where.
    expect(frame()?.getAttribute('sandbox')).toBe('')
  })

  it('reads only the component the design places', async () => {
    mockComponents.set('hosts/host-1/components/header-1', HEADER)
    preview(PLACED)
    await waitFor(() => expect(frame()).not.toBeNull())
    expect(mockGets).toEqual(['hosts/host-1/components/header-1'])
  })

  it('says it is loading rather than drawing the email without its header', async () => {
    mockComponents.set('hosts/host-1/components/header-1', HEADER)
    preview(PLACED)
    // Before the component arrives: no frame at all, rather than a frame
    // presenting a headerless email as the mail.
    expect(frame()).toBeNull()
    expect(screen.getByText('Loading this email…')).toBeTruthy()
    // …and the first frame drawn is already the composed one.
    await waitFor(() => expect(frame()).not.toBeNull())
    expect(frame()?.getAttribute('srcdoc')).toContain('Acme header')
  })

  it('draws the rest, and says so, when the component cannot be read', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      mockFailing.add('hosts/host-1/components/header-1')
      preview(PLACED)
      await waitFor(() => expect(frame()).not.toBeNull())
      expect(frame()?.getAttribute('srcdoc')).not.toContain('Acme header')
      expect(frame()?.getAttribute('srcdoc')).toContain('the sale is on.')
      expect(screen.getByText(/could not be loaded/i)).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('a design placing nothing', () => {
  it('costs no read and draws at once', () => {
    preview({
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['body'] },
      body: {
        $id: 'body',
        componentId: 'emailText',
        parentId: ROOT,
        props: { children: 'Just the copy.' },
      },
    })
    expect(frame()?.getAttribute('srcdoc')).toContain('Just the copy.')
    expect(mockGets).toEqual([])
  })
})
