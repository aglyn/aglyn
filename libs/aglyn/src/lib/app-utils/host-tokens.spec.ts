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
  hostTokenMerge,
  hostTokensIn,
  resolveHostToken,
  resolveHostTokens,
  resolveNodesHostTokens,
  shouldOmitBlock,
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
      nodes: [],
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
    const input = { a: { $id: 'a' }, b: null }
    expect(() => resolveNodesHostTokens(input as any, site())).not.toThrow()
  })
})
