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

import { compress } from './compress'
import {
  emailStarterRefusal,
  emailStarterSendBlock,
  inspectEmailStarter,
  resolveEmailStarterAssurance,
} from './email-starter-policy'

const ROOT = '_@_'

/** A minimal design: a section holding one block with the given props. */
function design(
  componentId: string,
  props: Record<string, unknown>,
): Record<string, unknown> {
  return {
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['section'] },
    section: {
      $id: 'section',
      componentId: 'emailSection',
      pluginId: 'email',
      parentId: ROOT,
      nodes: ['block'],
    },
    block: {
      $id: 'block',
      componentId,
      pluginId: 'email',
      parentId: 'section',
      props,
    },
  }
}

const codes = (nodes: unknown, hostId?: string) =>
  inspectEmailStarter(nodes, { hostId }).violations.map(
    (violation) => violation.code,
  )

describe('inspectEmailStarter — remote assets', () => {
  it('refuses an image loaded from a host we do not serve', () => {
    expect(codes(design('emailImage', { src: 'https://tracker.example/p.gif' })))
      .toEqual(['remote-asset'])
  })

  it('refuses a 1x1 tracking pixel for exactly the same reason', () => {
    const inspection = inspectEmailStarter(
      design('emailImage', {
        src: 'https://publisher.example/o.gif',
        width: 1,
      }),
    )
    expect(inspection.ok).toBe(false)
    expect(inspection.violations[0].code).toBe('remote-asset')
  })

  it('refuses a protocol-relative src, which resolves to a remote host', () => {
    expect(codes(design('emailImage', { src: '//tracker.example/p.gif' }))).toEqual(
      ['remote-asset'],
    )
  })

  it('accepts a media reference, which our own CDN serves', () => {
    expect(
      inspectEmailStarter(design('emailImage', { src: 'media:host-1/pic' })).ok,
    ).toBe(true)
  })

  it('accepts an inline image, which discloses nothing on open', () => {
    expect(
      inspectEmailStarter(
        design('emailImage', { src: 'data:image/png;base64,iVBORw0KGgo=' }),
      ).ok,
    ).toBe(true)
  })

  it('accepts a first-party CDN path', () => {
    expect(
      inspectEmailStarter(
        design('emailImage', { src: '/api/media/cdn/host-1/pic' }),
      ).ok,
    ).toBe(true)
  })

  it('refuses a malformed media reference rather than passing it through', () => {
    expect(codes(design('emailImage', { src: 'media:not-a-reference' }))).toEqual(
      ['remote-asset'],
    )
  })

  it('reports a media reference scoped to another site without refusing it', () => {
    const inspection = inspectEmailStarter(
      design('emailImage', { src: 'media:publisher-host/pic' }),
      { hostId: 'buyer-host' },
    )
    expect(inspection.ok).toBe(true)
    expect(inspection.foreignMediaScopes).toEqual(['publisher-host'])
  })

  it('does not call the installing site’s own media foreign', () => {
    expect(
      inspectEmailStarter(design('emailImage', { src: 'media:buyer-host/pic' }), {
        hostId: 'buyer-host',
      }).foreignMediaScopes,
    ).toEqual([])
  })
})

describe('inspectEmailStarter — links', () => {
  it('accepts an https link and reports its host for inspection', () => {
    const inspection = inspectEmailStarter(
      design('emailButton', { href: 'https://shop.example/sale' }),
    )
    expect(inspection.ok).toBe(true)
    expect(inspection.linkHosts).toEqual(['shop.example'])
  })

  it('refuses an http link', () => {
    expect(codes(design('emailButton', { href: 'http://shop.example' }))).toEqual(
      ['unsafe-link'],
    )
  })

  it('refuses a javascript: link', () => {
    expect(
      codes(design('emailButton', { href: 'javascript:alert(1)' })),
    ).toEqual(['unsafe-link'])
  })

  it('accepts mailto and site-relative links', () => {
    expect(
      inspectEmailStarter(design('emailButton', { href: 'mailto:a@b.example' }))
        .ok,
    ).toBe(true)
    expect(
      inspectEmailStarter(design('emailButton', { href: '/products' })).ok,
    ).toBe(true)
  })

  it('deduplicates and sorts the link hosts it reports', () => {
    const nodes = design('emailButton', { href: 'https://Zed.example/a' })
    ;(nodes as any)['second'] = {
      $id: 'second',
      componentId: 'emailButton',
      parentId: 'section',
      props: { href: 'https://alpha.example/b' },
    }
    ;(nodes as any)['third'] = {
      $id: 'third',
      componentId: 'emailButton',
      parentId: 'section',
      props: { href: 'https://zed.example/c' },
    }
    expect(inspectEmailStarter(nodes).linkHosts).toEqual([
      'alpha.example',
      'zed.example',
    ])
  })
})

describe('inspectEmailStarter — merge tags never reach a URL', () => {
  it('refuses a merge tag in a link, which is recipient data in a query string', () => {
    expect(
      codes(
        design('emailButton', {
          href: 'https://shop.example/?e={{contact.email}}',
        }),
      ),
    ).toEqual(['merge-tag-in-url'])
  })

  it('refuses a merge tag in an image address', () => {
    expect(
      codes(design('emailImage', { src: 'media:host-1/{{contact.id}}' })),
    ).toEqual(['merge-tag-in-url'])
  })

  it('leaves a merge tag in body text alone — that is what they are for', () => {
    expect(
      inspectEmailStarter(
        design('emailText', { children: 'Hello {{contact.firstName}},' }),
      ).ok,
    ).toBe(true)
  })
})

describe('inspectEmailStarter — raw markup', () => {
  it('refuses an html prop on any block, not just the excluded one', () => {
    expect(
      codes(design('emailText', { html: '<img src="https://t.example/p.gif">' })),
    ).toEqual(['raw-markup'])
  })

  it('refuses dangerouslySetInnerHTML', () => {
    expect(
      codes(design('emailText', { dangerouslySetInnerHTML: { __html: 'x' } })),
    ).toEqual(['raw-markup'])
  })
})

describe('inspectEmailStarter — both storage forms', () => {
  const clean = design('emailText', { children: 'Hi' })
  const dirty = design('emailImage', { src: 'https://tracker.example/p.gif' })

  it('reads a plain Firestore map', () => {
    expect(inspectEmailStarter(clean).ok).toBe(true)
  })

  it('decodes msgpack bytes rather than walking them as byte indices', () => {
    const inspection = inspectEmailStarter(Buffer.from(compress(clean)))
    expect(inspection.ok).toBe(true)
    expect(Object.keys(inspection.nodes ?? {})).toContain('block')
  })

  it('catches a violation hidden inside the compressed form', () => {
    expect(inspectEmailStarter(Buffer.from(compress(dirty))).violations).toEqual([
      expect.objectContaining({ code: 'remote-asset' }),
    ])
  })

  it('decodes the JSON Buffer envelope an export bundle carries', () => {
    const envelope = JSON.parse(
      JSON.stringify({ nodes: Buffer.from(compress(dirty)) }),
    ).nodes
    expect(inspectEmailStarter(envelope).violations).toEqual([
      expect.objectContaining({ code: 'remote-asset' }),
    ])
  })

  it('refuses an unreadable map instead of reporting it clean', () => {
    expect(codes(Buffer.from('not msgpack at all'))).toEqual(['unreadable'])
  })

  it('refuses a map whose values are not nodes', () => {
    expect(codes({ 0: 137, 1: 42 })).toEqual(['unreadable'])
  })
})

describe('emailStarterRefusal', () => {
  it('is undefined for a clean design', () => {
    expect(
      emailStarterRefusal(inspectEmailStarter(design('emailText', { children: 'x' }))),
    ).toBeUndefined()
  })

  it('names the offending value and counts the rest', () => {
    const nodes = design('emailImage', { src: 'https://a.example/1.gif' })
    ;(nodes as any)['second'] = {
      $id: 'second',
      componentId: 'emailImage',
      parentId: 'section',
      props: { src: 'https://b.example/2.gif' },
    }
    const message = emailStarterRefusal(inspectEmailStarter(nodes))
    expect(message).toContain('https://a.example/1.gif')
    expect(message).toContain('and 1 more')
  })
})

describe('resolveEmailStarterAssurance — a verdict belongs to one version', () => {
  it('reads an approval off the version', () => {
    expect(resolveEmailStarterAssurance({ reviewState: 'approved' })).toBe(
      'approved',
    )
  })

  it('reads a rejection off the version', () => {
    expect(resolveEmailStarterAssurance({ reviewState: 'rejected' })).toBe(
      'rejected',
    )
  })

  it('treats an absent verdict as unreviewed, never as approval', () => {
    expect(resolveEmailStarterAssurance({})).toBe('unreviewed')
    expect(resolveEmailStarterAssurance(null)).toBe('unreviewed')
    expect(resolveEmailStarterAssurance(undefined)).toBe('unreviewed')
  })

  it('does not inherit a verdict from the listing that carries the version', () => {
    // Every listing-level field that could be mistaken for approval, on a
    // version that has no verdict of its own.
    const listingFields = {
      reviewStatus: 'verified',
      latestVersionReviewState: 'approved',
      latestApprovedVersion: '3',
      verificationRequest: { state: 'granted' },
    }
    expect(
      resolveEmailStarterAssurance({ ...listingFields } as never),
    ).toBe('unreviewed')
  })

  it('treats an unrecognized state as unreviewed rather than approved', () => {
    expect(resolveEmailStarterAssurance({ reviewState: 'pending' })).toBe(
      'unreviewed',
    )
    expect(resolveEmailStarterAssurance({ reviewState: 'revoked' })).toBe(
      'unreviewed',
    )
  })
})

describe('emailStarterSendBlock — a kill reaches an installed design', () => {
  const installedFrom = { listingId: 'listing-1', version: '2' }

  it('blocks the send when the installed version is killed', () => {
    const block = emailStarterSendBlock({
      installedFrom,
      revocation: { versions: ['2'], reason: 'Phishing layout' },
    })
    expect(block?.code).toBe('killed')
    expect(block?.reason).toContain('Phishing layout')
  })

  it('blocks the send when the whole listing is killed', () => {
    expect(
      emailStarterSendBlock({ installedFrom, revocation: { versions: 'all' } })
        ?.code,
    ).toBe('killed')
  })

  it('leaves other versions of the same listing sending', () => {
    expect(
      emailStarterSendBlock({ installedFrom, revocation: { versions: ['7'] } }),
    ).toBeNull()
  })

  it('says the design is still there — a kill refuses the send, not the content', () => {
    const block = emailStarterSendBlock({
      installedFrom,
      revocation: { versions: 'all' },
    })
    expect(block?.reason).toContain('still here')
  })

  it('does nothing for an email the site designed itself', () => {
    expect(
      emailStarterSendBlock({
        installedFrom: null,
        revocation: { versions: 'all' },
      }),
    ).toBeNull()
  })

  it('does nothing when nothing is revoked', () => {
    expect(
      emailStarterSendBlock({ installedFrom, revocation: undefined }),
    ).toBeNull()
  })

  it('catches a version-less legacy install with a listing-wide kill', () => {
    expect(
      emailStarterSendBlock({
        installedFrom: { listingId: 'listing-1', version: null },
        revocation: { versions: 'all' },
      })?.code,
    ).toBe('killed')
  })

  it('does not guess at a version-less install for a per-version kill', () => {
    expect(
      emailStarterSendBlock({
        installedFrom: { listingId: 'listing-1', version: null },
        revocation: { versions: ['2'] },
      }),
    ).toBeNull()
  })
})
