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

import {
  HOST_TOKENS,
  describeHostTokens,
  hostTokenDefinition,
  hostTokenMerge,
  hostTokensIn,
  isHostImageToken,
  resolveHostToken,
  resolveHostTokens,
  resolveNodesHostTokens,
  shouldOmitBlock,
  siteSocialProfileUrl,
  telephoneHref,
  validateHostTokens,
  type HostTokenSource,
} from './host-tokens'

const site = (over: Partial<HostTokenSource> = {}): HostTokenSource => ({
  displayName: 'Northwind Coffee',
  logoUrl: 'https://cdn.example/logo.png',
  subdomain: 'northwind-coffee',
  business: {
    supportEmail: 'help@northwind.example',
    address: '12 Bean Street, Portland',
    socialLinks: [
      { label: 'Instagram', url: 'https://instagram.com/northwind' },
      { label: 'X', url: 'https://x.com/northwind' },
    ],
  },
  ...over,
})

describe('the namespace is closed — no path syntax to abuse', () => {
  it('does not match a dotted path beyond one segment', () => {
    expect(hostTokensIn('{{host.seo.entity.name}}')).toEqual([])
    expect(resolveHostTokens('{{host.seo.entity.name}}', site())).toBe(
      '{{host.seo.entity.name}}',
    )
  })

  it('resolves a token nobody declared to nothing, never to data', () => {
    const dangerous = {
      ...site(),
      orgId: 'org-1',
      memberRoles: { u1: 'admin' },
      stripeAccountId: 'acct_123',
    } as HostTokenSource & Record<string, unknown>
    for (const key of ['orgId', 'memberRoles', 'stripeAccountId', 'theme']) {
      expect(resolveHostToken(key, dangerous)).toBeUndefined()
      expect(resolveHostTokens(`{{host.${key}}}`, dangerous)).toBe('')
    }
  })

  it('every registered token reads through its own function, not a path', () => {
    for (const definition of Object.values(HOST_TOKENS)) {
      expect(typeof definition.resolve).toBe('function')
      expect(definition.key).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/)
    }
  })

  /**
   * Every name below matches the token pattern, and every one is a member the
   * registry's object literal inherits. Read with a bare index, each answers a
   * builtin where a definition belongs, and calling its `resolve` throws — in
   * the middle of composing a published page, or of drawing the canvas.
   */
  const INHERITED = [
    'constructor',
    'toString',
    'toLocaleString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
  ]

  it('CONTROL — each inherited name matches the token pattern', () => {
    for (const key of INHERITED) {
      expect(hostTokensIn(`{{host.${key}}}`)).toEqual([key])
      expect(key in HOST_TOKENS).toBe(true)
    }
  })

  it('resolves a name the registry only inherits to nothing, never to the builtin', () => {
    for (const key of INHERITED) {
      expect(hostTokenDefinition(key)).toBeUndefined()
      expect(resolveHostToken(key, site())).toBeUndefined()
      expect(resolveHostTokens(`What {{host.${key}}} is`, site())).toBe(
        'What  is',
      )
      expect(shouldOmitBlock(`{{host.${key}}}`, site())).toBe(false)
    }
  })

  it('composes a node map holding one without throwing', () => {
    const nodes = {
      t: {
        props: {
          children: 'Hi {{host.toString}}',
          ariaLabel: '{{host.constructor}}',
        },
      },
    }
    const resolved = resolveNodesHostTokens(nodes, site()) as any
    expect(resolved.t.props).toEqual({ children: 'Hi ', ariaLabel: '' })
  })

  it('reports one as an unknown token at authoring time', () => {
    for (const key of INHERITED) {
      expect(validateHostTokens(`{{host.${key}}}`)).toEqual([
        expect.objectContaining({ key, kind: 'unknown' }),
      ])
    }
  })

  it('still finds every declared token', () => {
    for (const key of Object.keys(HOST_TOKENS)) {
      expect(hostTokenDefinition(key)).toBe(HOST_TOKENS[key])
    }
  })
})

describe('resolveHostTokens', () => {
  it('fills a template in from the installing site', () => {
    expect(
      resolveHostTokens(
        'Thanks for shopping with {{host.businessName}} — {{host.url}}',
        site(),
      ),
    ).toBe(
      'Thanks for shopping with Northwind Coffee — https://northwind-coffee.aglyn.app',
    )
  })

  it('prefers a connected custom domain over the aglyn.app subdomain', () => {
    expect(resolveHostTokens('{{host.url}}', site({ cname: 'northwind.com' }))).toBe(
      'https://northwind.com',
    )
    // Already-qualified values must not double up.
    expect(
      resolveHostTokens('{{host.url}}', site({ cname: 'https://northwind.com' })),
    ).toBe('https://northwind.com')
  })

  it('prefers the SEO entity name, which is the business name proper', () => {
    expect(
      resolveHostTokens(
        '{{host.businessName}}',
        site({ seo: { entity: { name: 'Northwind Coffee Roasters' } } }),
      ),
    ).toBe('Northwind Coffee Roasters')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(resolveHostTokens('{{ host.businessName }}', site())).toBe(
      'Northwind Coffee',
    )
  })

  it('replaces every occurrence, not just the first', () => {
    expect(
      resolveHostTokens('{{host.businessName}} & {{host.businessName}}', site()),
    ).toBe('Northwind Coffee & Northwind Coffee')
  })

  it('leaves text with no tokens exactly alone', () => {
    const text = 'No bindings here at all.'
    expect(resolveHostTokens(text, site())).toBe(text)
  })

  it('never leaks the literal token to a visitor', () => {
    // The failure this whole feature exists to prevent.
    const bare: HostTokenSource = {}
    for (const key of Object.keys(HOST_TOKENS)) {
      expect(resolveHostTokens(`{{host.${key}}}`, bare)).not.toContain('{{')
    }
    expect(resolveHostTokens('{{host.nonsense}}', bare)).not.toContain('{{')
  })

  it('survives a missing site rather than throwing mid-send', () => {
    expect(resolveHostTokens('{{host.businessName}}', null)).toBe('')
    expect(resolveHostTokens('{{host.businessName}}', undefined)).toBe('')
  })

  it('formats social links as readable text', () => {
    expect(resolveHostTokens('{{host.socialLinks}}', site())).toBe(
      'Instagram · X',
    )
  })

  it('falls back to a link’s URL when it has no label', () => {
    expect(
      resolveHostTokens(
        '{{host.socialLinks}}',
        site({ business: { socialLinks: [{ url: 'https://x.com/nw' }] } }),
      ),
    ).toBe('https://x.com/nw')
  })
})

describe('the dark logo (AGL-4119)', () => {
  it('is the dark logo where the site has one', () => {
    expect(resolveHostToken('logoDark', { logoUrl: 'light', logoDarkUrl: 'dark' })).toBe('dark')
  })

  it('is whatever the logo is otherwise, so a site with one logo shows it in both schemes', () => {
    expect(resolveHostToken('logoDark', { logoUrl: 'light' })).toBe('light')
    expect(resolveHostToken('logoDark', { logoUrl: 'light', logoDarkUrl: '  ' })).toBe('light')
    expect(resolveHostToken('logoDark', { seo: { entity: { logo: 'listed' } } })).toBe('listed')
  })

  it('is nothing on a site with no logo at all', () => {
    expect(resolveHostToken('logoDark', {})).toBeUndefined()
    expect(shouldOmitBlock('{{host.logoDark}}', {})).toBe(true)
  })

  it('never changes what the logo token means', () => {
    expect(resolveHostToken('logo', { logoUrl: 'light', logoDarkUrl: 'dark' })).toBe('light')
    expect(resolveHostToken('logo', { logoDarkUrl: 'dark' })).toBeUndefined()
  })

  it('is listed with the other tokens, as an image', () => {
    expect(hostTokenDefinition('logoDark')?.type).toBe('image')
    expect(describeHostTokens({ logoUrl: 'light' }).map(({ key }) => key)).toContain('logoDark')
    expect(hostTokenMerge({ logoUrl: 'light' })['host.logoDark']).toBe('light')
  })
})

describe('isHostImageToken (AGL-4119)', () => {
  it('takes exactly one image token', () => {
    expect(isHostImageToken('{{host.logo}}')).toBe(true)
    expect(isHostImageToken('{{ host.logoDark }}')).toBe(true)
  })

  it('takes no other token, no mixture and no address', () => {
    expect(isHostImageToken('{{host.businessName}}')).toBe(false)
    expect(isHostImageToken('{{host.nope}}')).toBe(false)
    expect(isHostImageToken('https://evil.example/{{host.logo}}')).toBe(false)
    expect(isHostImageToken('{{host.logo}}{{host.logoDark}}')).toBe(false)
    expect(isHostImageToken('')).toBe(false)
  })
})

describe('every token defines what empty does', () => {
  it('declares an empty behaviour for all of them', () => {
    for (const definition of Object.values(HOST_TOKENS)) {
      expect(['blank', 'omit-block']).toContain(definition.whenEmpty)
    }
  })

  it('drops a logo block on a site with no logo, rather than an empty image', () => {
    const noLogo = site({ logoUrl: undefined, seo: undefined })
    expect(resolveHostToken('logo', noLogo)).toBeUndefined()
    expect(shouldOmitBlock('<img src="{{host.logo}}">', noLogo)).toBe(true)
  })

  it('keeps the logo block when the site has one', () => {
    expect(shouldOmitBlock('<img src="{{host.logo}}">', site())).toBe(false)
  })

  it('drops a support-email block on a site that set none', () => {
    const noEmail = site({ business: {} })
    expect(shouldOmitBlock('Write to {{host.supportEmail}}', noEmail)).toBe(true)
  })

  it('does NOT drop a block for a blank-behaviour token', () => {
    // A missing business name leaves a gap in a sentence; it does not justify
    // deleting the sentence.
    const nameless = site({ displayName: undefined, seo: undefined })
    expect(shouldOmitBlock('Welcome to {{host.businessName}}', nameless)).toBe(
      false,
    )
  })

  it('does not drop a block for a token that resolved fine', () => {
    expect(shouldOmitBlock('{{host.supportEmail}}', site())).toBe(false)
  })

  it('says nothing about text with no tokens', () => {
    expect(shouldOmitBlock('plain copy', site())).toBe(false)
    expect(shouldOmitBlock('plain copy', null)).toBe(false)
  })
})

describe('validateHostTokens — catch it at authoring, not in a sent email', () => {
  it('accepts a well-formed text token', () => {
    expect(validateHostTokens('Hi from {{host.businessName}}')).toEqual([])
  })

  it('flags a typo, and lists what does exist', () => {
    const issues = validateHostTokens('{{host.buisnessName}}')
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('unknown')
    expect(issues[0].message).toMatch(/no host variable called "buisnessName"/)
    expect(issues[0].message).toMatch(/businessName/)
  })

  it('refuses an image token in a text slot', () => {
    const issues = validateHostTokens('Our logo: {{host.logo}}')
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('wrong-slot')
    expect(issues[0].message).toMatch(/is an image, so it cannot go here/)
  })

  it('accepts the image token in a slot that takes one', () => {
    expect(
      validateHostTokens('{{host.logo}}', { allow: ['image'] }),
    ).toEqual([])
  })

  it('reports each distinct token once, however often it appears', () => {
    expect(
      validateHostTokens('{{host.nope}} {{host.nope}} {{host.nope}}'),
    ).toHaveLength(1)
  })

  it('reports several problems together, so they are fixed in one pass', () => {
    const issues = validateHostTokens('{{host.logo}} and {{host.nope}}')
    expect(issues.map((issue) => issue.kind).sort()).toEqual([
      'unknown',
      'wrong-slot',
    ])
  })

  it('says nothing about ordinary variable bindings', () => {
    expect(validateHostTokens('{{var:abc123}} and {{fn:total(1)}}')).toEqual([])
  })
})

describe('describeHostTokens — a picker that shows what it would produce', () => {
  it('reports each token with the value this site would render', () => {
    const described = describeHostTokens(site())
    const name = described.find((entry) => entry.key === 'businessName')
    expect(name).toMatchObject({
      token: '{{host.businessName}}',
      value: 'Northwind Coffee',
      set: true,
      type: 'text',
    })
  })

  it('marks a token the site has not set, rather than hiding it', () => {
    const described = describeHostTokens(site({ business: {} }))
    const email = described.find((entry) => entry.key === 'supportEmail')
    expect(email).toMatchObject({ set: false, value: undefined })
    // Still listed: an author needs to know it exists in order to go set it.
    expect(described).toHaveLength(Object.keys(HOST_TOKENS).length)
  })

  it('handles a site with nothing set at all', () => {
    const described = describeHostTokens({})
    expect(described.every((entry) => entry.set === false)).toBe(true)
  })
})

describe('hostTokenMerge — the email seam', () => {
  it('keys every token as the substituter expects', () => {
    const merge = hostTokenMerge(site())
    expect(merge['host.businessName']).toBe('Northwind Coffee')
    expect(merge['host.supportEmail']).toBe('help@northwind.example')
  })

  it('includes UNSET tokens as empty, so no literal can ship', () => {
    const merge = hostTokenMerge(site({ business: {} }))
    expect(merge['host.supportEmail']).toBe('')
    // Every registered token is present — relying on a downstream catch-all to
    // blank the leftovers works by accident, not by design.
    expect(Object.keys(merge).sort()).toEqual(
      Object.keys(HOST_TOKENS)
        .map((key) => `host.${key}`)
        .sort(),
    )
  })

  it('produces a full map even for a site with nothing set', () => {
    const merge = hostTokenMerge({})
    expect(Object.values(merge).every((value) => value === '')).toBe(true)
  })
})

describe('resolveNodesHostTokens — screens resolve like emails', () => {
  const tree = () => ({
    root: { $id: 'root', componentId: 'div', nodes: ['t'] },
    t: {
      $id: 't',
      componentId: 'text',
      props: { children: 'Welcome to {{host.businessName}}', variant: 'h1' },
      // Annotated because a bare `[]` has no element type to infer from.
      nodes: [] as string[],
    },
  })

  it('substitutes into string props and leaves the rest alone', () => {
    const resolved = resolveNodesHostTokens(tree(), site()) as any
    expect(resolved.t.props.children).toBe('Welcome to Northwind Coffee')
    expect(resolved.t.props.variant).toBe('h1')
  })

  it('agrees with the email path for the same token', () => {
    const viaNodes = (resolveNodesHostTokens(tree(), site()) as any).t.props
      .children
    const viaMerge = 'Welcome to ' + hostTokenMerge(site())['host.businessName']
    expect(viaNodes).toBe(viaMerge)
  })

  it('returns the SAME object when nothing needed substituting', () => {
    const input = {
      root: { $id: 'root', componentId: 'div', props: { variant: 'h1' } },
    }
    expect(resolveNodesHostTokens(input, site())).toBe(input)
  })

  it('leaves ordinary variable bindings for the other resolver', () => {
    const input = {
      t: { $id: 't', props: { children: '{{var:abc}} and {{fn:x(1)}}' } },
    }
    expect((resolveNodesHostTokens(input, site()) as any).t.props.children).toBe(
      '{{var:abc}} and {{fn:x(1)}}',
    )
  })

  it('tolerates nodes with no props', () => {
    // Annotated rather than inferred: a bare `null` entry widens to `any`
    // with strictNullChecks off, which `noImplicitAny` then rejects.
    const input: Record<string, unknown> = { a: { $id: 'a' }, b: null }
    expect(() => resolveNodesHostTokens(input, site())).not.toThrow()
  })
})

/**
 * A site's business details have one home, Setup → Business profile (AGL-4136), and
 * the tokens read it: the canonical path first, the older one-block copy
 * where a site saved before that has nothing else.
 */
describe('the business details tokens (AGL-4136)', () => {
  const entity = (over: NonNullable<NonNullable<HostTokenSource['seo']>['entity']>) =>
    site({ seo: { entity: over } })

  describe('phone and phoneLink', () => {
    it('gives the phone as entered', () => {
      expect(resolveHostToken('phone', entity({ telephone: ' +1 (512) 555-0100 ' }))).toBe(
        '+1 (512) 555-0100',
      )
    })

    it('links it as tel: with everything but digits and a leading + removed', () => {
      expect(resolveHostToken('phoneLink', entity({ telephone: '+1 (512) 555-0100' }))).toBe(
        'tel:+15125550100',
      )
      expect(resolveHostToken('phoneLink', entity({ telephone: '(512) 555.0100' }))).toBe(
        'tel:5125550100',
      )
      // A plus anywhere but the front is punctuation, not a country prefix.
      expect(telephoneHref('512-555-0100 +')).toBe('tel:5125550100')
      expect(telephoneHref('  +44 20 7946 0958')).toBe('tel:+442079460958')
    })

    it('is nothing at all without a phone, so a Call button never links to a bare tel:', () => {
      expect(resolveHostToken('phoneLink', site())).toBeUndefined()
      expect(resolveHostToken('phoneLink', entity({ telephone: '   ' }))).toBeUndefined()
      expect(telephoneHref('call us')).toBeUndefined()
      expect(resolveHostToken('phone', site())).toBeUndefined()
      expect(resolveHostTokens('{{host.phoneLink}}', site())).toBe('')
    })

    it('is a URL, so it may go where a link goes', () => {
      expect(HOST_TOKENS['phoneLink'].type).toBe('url')
      expect(validateHostTokens('{{host.phoneLink}}', { allow: ['url'] })).toEqual([])
    })
  })

  describe('the email', () => {
    it('is the one Setup → Business profile saves, over the older copy', () => {
      const host = site({ seo: { entity: { email: 'hello@northwind.example' } } })
      expect(resolveHostToken('supportEmail', host)).toBe('hello@northwind.example')
    })

    it('falls back to the one-block copy a site saved before', () => {
      expect(resolveHostToken('supportEmail', site())).toBe('help@northwind.example')
    })

    it('is nothing when the site has neither', () => {
      expect(resolveHostToken('supportEmail', site({ business: {} }))).toBeUndefined()
    })
  })

  describe('the address', () => {
    const parts = {
      streetAddress: '12 Bean St',
      addressLocality: 'Portland',
      addressRegion: 'OR',
      postalCode: '97201',
      addressCountry: 'US',
    }

    it('is the structured address on one line, over the older block', () => {
      expect(resolveHostToken('address', entity({ address: parts }))).toBe(
        '12 Bean St, Portland, OR, 97201, US',
      )
    })

    it('formats a partial address without gaps', () => {
      expect(
        resolveHostToken('address', entity({ address: { addressLocality: 'Portland', addressCountry: 'US' } })),
      ).toBe('Portland, US')
    })

    it('falls back to the block as typed, line breaks kept', () => {
      const host = site({ business: { address: '12 Bean Street\nPortland, OR ' } })
      expect(resolveHostToken('address', host)).toBe('12 Bean Street\nPortland, OR')
    })

    it('reads empty parts as no structured address at all', () => {
      expect(resolveHostToken('address', entity({ address: { streetAddress: '  ' } }))).toBe(
        '12 Bean Street, Portland',
      )
    })
  })

  describe('the slogan', () => {
    it('is the slogan as saved, trimmed', () => {
      expect(resolveHostToken('slogan', entity({ slogan: '  Roasted this morning  ' }))).toBe(
        'Roasted this morning',
      )
    })

    it('renders as nothing where there is none', () => {
      expect(resolveHostTokens('{{host.slogan}}', site())).toBe('')
      expect(HOST_TOKENS['slogan'].whenEmpty).toBe('blank')
    })
  })

  describe('the areas served', () => {
    it('are nothing for an empty list', () => {
      for (const areaServed of [undefined, [], ['', '  '], '']) {
        const host = entity({ areaServed })
        expect([areaServed, resolveHostToken('mainArea', host)]).toEqual([areaServed, undefined])
        expect([areaServed, resolveHostToken('areasServed', host)]).toEqual([areaServed, undefined])
      }
      expect(HOST_TOKENS['mainArea'].whenEmpty).toBe('blank')
      expect(HOST_TOKENS['areasServed'].whenEmpty).toBe('blank')
    })

    it('name one area by its place, and list it whole', () => {
      const host = entity({ areaServed: ['  San Antonio, TX  '] })
      expect(resolveHostToken('mainArea', host)).toBe('San Antonio')
      expect(resolveHostToken('areasServed', host)).toBe('San Antonio, TX')
    })

    it('keep an area with no comma as it is', () => {
      expect(resolveHostToken('mainArea', entity({ areaServed: ['Greater London'] }))).toBe(
        'Greater London',
      )
    })

    it('list several in order, blanks dropped, and name only the first', () => {
      const host = entity({ areaServed: ['San Antonio, TX', '', 'New Braunfels, TX', ' Boerne '] })
      expect(resolveHostToken('mainArea', host)).toBe('San Antonio')
      expect(resolveHostToken('areasServed', host)).toBe(
        'San Antonio, TX, New Braunfels, TX, Boerne',
      )
      expect(
        resolveHostTokens('for homes across {{host.mainArea}} and surrounding areas', host),
      ).toBe('for homes across San Antonio and surrounding areas')
    })

    it('read the one-per-line text form too', () => {
      const host = entity({ areaServed: 'Austin\n\nRound Rock' })
      expect(resolveHostToken('mainArea', host)).toBe('Austin')
      expect(resolveHostToken('areasServed', host)).toBe('Austin, Round Rock')
    })
  })

  describe('a link per social network', () => {
    it('matches a profile by its hostname, not its label', () => {
      const host = site({
        business: {
          socialLinks: [
            { label: 'Follow us', url: 'https://www.instagram.com/northwind' },
            { label: 'Instagram', url: 'https://linkedin.com/company/northwind' },
          ],
        },
      })
      expect(resolveHostToken('instagramUrl', host)).toBe('https://www.instagram.com/northwind')
      expect(resolveHostToken('linkedinUrl', host)).toBe('https://linkedin.com/company/northwind')
    })

    it('takes X on either of its hostnames', () => {
      expect(resolveHostToken('xUrl', site())).toBe('https://x.com/northwind')
      const renamed = site({ business: { socialLinks: [{ url: 'https://twitter.com/northwind' }] } })
      expect(resolveHostToken('xUrl', renamed)).toBe('https://twitter.com/northwind')
    })

    it('takes a subdomain of the network, and refuses a lookalike', () => {
      const host = site({
        business: {
          socialLinks: [
            { url: 'https://notfacebook.com/northwind' },
            { url: 'https://m.facebook.com/northwind' },
            { url: 'https://youtu.be/abc' },
            { url: 'https://www.tiktok.com/@northwind' },
          ],
        },
      })
      expect(resolveHostToken('facebookUrl', host)).toBe('https://m.facebook.com/northwind')
      expect(resolveHostToken('youtubeUrl', host)).toBe('https://youtu.be/abc')
      expect(resolveHostToken('tiktokUrl', host)).toBe('https://www.tiktok.com/@northwind')
    })

    it('reads the entity’s sameAs first, as the structured data does', () => {
      const host = site({ seo: { entity: { sameAs: ['https://instagram.com/northwind.roasters'] } } })
      expect(siteSocialProfileUrl(host, 'instagram')).toBe('https://instagram.com/northwind.roasters')
    })

    it('never links an http address, and is nothing where the site has no profile there', () => {
      const host = site({ business: { socialLinks: [{ url: 'http://facebook.com/northwind' }] } })
      expect(resolveHostToken('facebookUrl', host)).toBeUndefined()
      expect(resolveHostToken('youtubeUrl', site())).toBeUndefined()
      expect(HOST_TOKENS['facebookUrl'].type).toBe('url')
    })
  })

  describe('in a link or a button’s href', () => {
    const tree = () => ({
      call: {
        $id: 'call',
        componentId: 'button',
        props: { children: 'Call {{host.phone}}', href: '{{host.phoneLink}}' },
        nodes: [] as string[],
      },
      follow: {
        $id: 'follow',
        componentId: 'link',
        props: { children: 'Instagram', href: '{{host.instagramUrl}}' },
        nodes: [] as string[],
      },
    })

    it('resolves to an address a link can follow', () => {
      const host = site({ seo: { entity: { telephone: '+1 (512) 555-0100' } } })
      const resolved = resolveNodesHostTokens(tree(), host) as any
      expect(resolved.call.props.href).toBe('tel:+15125550100')
      expect(resolved.call.props.children).toBe('Call +1 (512) 555-0100')
      expect(resolved.follow.props.href).toBe('https://instagram.com/northwind')
    })

    it('leaves no address, never the literal token, where the site has none', () => {
      const resolved = resolveNodesHostTokens(tree(), site({ business: {} })) as any
      expect(resolved.call.props.href).toBe('')
      expect(resolved.follow.props.href).toBe('')
    })
  })
})
