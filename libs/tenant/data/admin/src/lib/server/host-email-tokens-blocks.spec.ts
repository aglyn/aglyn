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
 * A SITE'S TRANSACTIONAL EMAIL, WITH ITS REUSABLE HEADER (AGL-3287).
 *
 * `renderHostEmailWithTokens` is what every booking confirmation, order
 * receipt and gift card goes out through, and the senders behind it pass no
 * composer of their own — they cannot be expected to know a header is a
 * component reference. So this renders for real, end to end, over a fake
 * Firestore: the template, its published version, the site's header
 * component, and the host document the tokens come from. The sibling spec
 * mocks the renderer to check the arguments; this one reads the HTML.
 */

jest.mock('./firebase-admin', () => ({ firebaseAdmin: {} }))

import { compress } from '@aglyn/aglyn/app-utils/compress'
import { renderHostEmailWithTokens } from './host-email-tokens'

/** A path-keyed Admin Firestore double: document gets, nothing else. */
function firestoreOver(documents: Record<string, Record<string, unknown>>) {
  const reads: string[] = []
  const docRef = (path: string): any => ({
    get: async () => {
      reads.push(path)
      const data = documents[path]
      return {
        exists: data !== undefined,
        data: () => data,
        get: (field: string) => data?.[field],
      }
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  const collectionRef = (path: string): any => ({
    doc: (id: string) => docRef(`${path}/${id}`),
  })
  return {
    firestore: { collection: (name: string) => collectionRef(name) } as never,
    reads,
  }
}

const HOST = {
  displayName: 'Northwind Coffee',
  subdomain: 'northwind-coffee',
  business: { supportEmail: 'help@northwind.example' },
}

/** The site's header: its title bound to a property, a host token beside it. */
const HEADER = {
  rootId: 'hdrSec',
  props: [{ name: 'title', type: 'text', defaultValue: 'Northwind' }],
  nodes: {
    hdrSec: { $id: 'hdrSec', componentId: 'emailSection', nodes: ['hdrText'] },
    hdrText: {
      $id: 'hdrText',
      componentId: 'emailText',
      parentId: 'hdrSec',
      props: {
        children:
          'Acme header: {{prop.title}} — write to {{host.supportEmail}}',
      },
    },
  },
}

/** A booking confirmation with the header placed above its own line. */
const TEMPLATE_NODES = {
  '_@_': { $id: '_@_', componentId: 'div', nodes: ['hdr', 'body'] },
  hdr: {
    $id: 'hdr',
    componentId: 'reusableInstance',
    parentId: '_@_',
    props: { refId: 'header-1', propValues: { title: 'Your booking' } },
    nodes: [],
  },
  body: {
    $id: 'body',
    componentId: 'emailText',
    parentId: '_@_',
    props: { children: 'Hi {{name}}, see you soon.' },
  },
}

const siteWith = (header: Record<string, unknown> | undefined) =>
  firestoreOver({
    'hosts/host-1': HOST,
    'hosts/host-1/emailTemplates/booking-confirmed': {
      versionId: 'v1',
      subject: 'Booked, {{name}}',
    },
    // Compressed, as the email besigner saves it (AGL-1151).
    'hosts/host-1/emailTemplates/booking-confirmed/versions/v1': {
      nodes: Buffer.from(compress(TEMPLATE_NODES)),
    },
    ...(header ? { 'hosts/host-1/components/header-1': header } : {}),
  })

describe('renderHostEmailWithTokens and a placed header (AGL-3287)', () => {
  it('mails the header, with the placement’s value and the site’s tokens', async () => {
    const { firestore } = siteWith(HEADER)
    const rendered = await renderHostEmailWithTokens(
      firestore,
      'host-1',
      'booking-confirmed',
      { name: 'Alex' },
    )
    expect(rendered?.html).toContain(
      'Acme header: Your booking — write to help@northwind.example',
    )
    expect(rendered?.html).toContain('Hi Alex, see you soon.')
    expect(rendered?.text).toContain('Acme header: Your booking')
    expect(rendered?.subject).toBe('Booked, Alex')
  })

  it('reads the one component the template places, from this site', async () => {
    const { firestore, reads } = siteWith(HEADER)
    await renderHostEmailWithTokens(firestore, 'host-1', 'booking-confirmed')
    expect(reads.filter((path) => path.includes('/components/'))).toEqual([
      'hosts/host-1/components/header-1',
    ])
  })

  /**
   * THE CONTROL. A header deleted from the site renders nothing — the same
   * empty space a page shows — and the email still goes: the rest of the
   * design, not the built-in copy, because nothing FAILED.
   */
  it('sends the rest of the design when the header was deleted', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const { firestore } = siteWith({ ...HEADER, deletedAt: 'yesterday' })
      const rendered = await renderHostEmailWithTokens(
        firestore,
        'host-1',
        'booking-confirmed',
        { name: 'Alex' },
      )
      expect(rendered?.html).not.toContain('Acme header')
      expect(rendered?.html).toContain('Hi Alex, see you soon.')
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
