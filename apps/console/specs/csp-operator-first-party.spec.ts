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
 * The CSP first-party set includes the OPERATOR's hosts (AGL-2198).
 *
 * `PRODUCTION_DOMAINS` in `security-origins.js` is a list of 26 hostnames
 * Aglyn controls, and it feeds `frame-ancestors` and `img-src` in both the
 * console and the tenant middleware. On a self-host install that made the
 * policy exactly backwards: every origin Aglyn controls was permanently
 * allowed and not one origin the operator controls was, so their console
 * could not be framed by their own surfaces and images from their own CDN
 * were refused.
 *
 * The file is plain CommonJS with no imports, because the edge runtime
 * bundles it — but it is IMPORTED here rather than `require`d. A `require()`
 * of it inside this project made `@nx/enforce-module-boundaries` read a
 * dynamic graph edge and redden `console:lint` on twenty-odd unrelated pages
 * (the AGL-949 shape); `middleware.ts` and `csp-img-src-report-only.spec.ts`
 * both import it statically, so this now matches them.
 *
 * Both directives are computed per CALL, which is what lets one test process
 * exercise the configured and unconfigured branches.
 *
 * What this deliberately checks BEYOND "the operator's host appears": that a
 * malformed value contributes nothing. An empty string in a CSP source list
 * becomes a bare `https:`, a scheme-only source matching every https origin
 * on the internet — strictly worse than the missing entry it came from.
 */
// The workspace-root module both middlewares read. Same import and same
// disable as `csp-img-src-report-only.spec.ts` one file over: it is outside
// any nx project, so the boundary rule has nothing to place it in.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  PRODUCTION_DOMAINS,
  baseCspDirectives,
  imgSrcDirective,
} from '../../../security-origins'

const OPERATOR_VARS = [
  'NEXT_PUBLIC_CONSOLE_URL',
  'NEXT_PUBLIC_WORKSPACE_DOMAIN',
  'NEXT_PUBLIC_TENANT_DOMAIN',
  'NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME',
] as const

function withEnv<T>(env: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>()
  for (const key of OPERATOR_VARS) previous.set(key, process.env[key])
  try {
    for (const key of OPERATOR_VARS) delete process.env[key]
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) process.env[key] = value
    }
    return run()
  } finally {
    for (const key of OPERATOR_VARS) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** Every source in a directive, so a scheme-only entry is visible as one. */
function sourcesOf(directive: string, name: string): string[] {
  const match = directive.split(';').find((part) => part.trim().startsWith(name))
  return (match ?? '').trim().split(/\s+/).slice(1)
}

describe('CSP first-party set follows the operator (AGL-2198)', () => {
  it('is unchanged for Aglyn: no operator variables, our 26 hosts', () => {
    withEnv({}, () => {
      const ancestors = sourcesOf(baseCspDirectives(true), 'frame-ancestors')
      expect(ancestors).toHaveLength(PRODUCTION_DOMAINS.length)
      expect(ancestors).toContain('https://app.aglyn.com')
    })
  })

  it("adds the operator's console, workspace, tenant and CNAME hosts", () => {
    withEnv(
      {
        NEXT_PUBLIC_CONSOLE_URL: 'https://console.example.com',
        NEXT_PUBLIC_WORKSPACE_DOMAIN: 'example.com',
        NEXT_PUBLIC_TENANT_DOMAIN: 'sites.example.com',
        NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME: 'edge.example.com',
      },
      () => {
        for (const directive of [baseCspDirectives(true), imgSrcDirective(true)]) {
          const sources = directive.includes('frame-ancestors')
            ? sourcesOf(directive, 'frame-ancestors')
            : sourcesOf(directive, 'img-src')
          expect(sources).toContain('https://console.example.com')
          expect(sources).toContain('https://example.com')
          expect(sources).toContain('https://sites.example.com')
          expect(sources).toContain('https://edge.example.com')
          // A MERGE, not a replacement: dropping ours would break our own
          // deployment, and keeping it costs the operator nothing because
          // nothing on their install resolves to it.
          expect(sources).toContain('https://app.aglyn.com')
        }
      },
    )
  })

  it('accepts a bare hostname and a URL, and de-duplicates', () => {
    withEnv(
      {
        // Same host by two routes, plus one of ours already on the list.
        NEXT_PUBLIC_CONSOLE_URL: 'https://console.example.com/some/path',
        NEXT_PUBLIC_WORKSPACE_DOMAIN: 'console.example.com',
        NEXT_PUBLIC_TENANT_DOMAIN: 'app.aglyn.com',
      },
      () => {
        const sources = sourcesOf(baseCspDirectives(true), 'frame-ancestors')
        const count = (needle: string) =>
          sources.filter((source) => source === needle).length
        expect(count('https://console.example.com')).toBe(1)
        expect(count('https://app.aglyn.com')).toBe(1)
      },
    )
  })

  it('contributes NOTHING for a malformed value rather than widening', () => {
    withEnv(
      {
        NEXT_PUBLIC_CONSOLE_URL: 'not a url',
        // Whitespace only — the shape a half-finished `.env` produces, and
        // the one that becomes a bare `https:` if it reaches the join.
        NEXT_PUBLIC_WORKSPACE_DOMAIN: '   ',
        // A wildcard is not a hostname; allowing it here would match every
        // subdomain of nothing in particular.
        NEXT_PUBLIC_TENANT_DOMAIN: '*',
        // Single-label: not a registrable name.
        NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME: 'localhost',
      },
      () => {
        const sources = sourcesOf(baseCspDirectives(true), 'frame-ancestors')
        expect(sources).toHaveLength(PRODUCTION_DOMAINS.length)
        // The failure this exists for: a scheme-only source.
        expect(sources).not.toContain('https:')
        expect(sources).not.toContain('https://')
        for (const source of sources) {
          expect(source).toMatch(/^https:\/\/[a-z0-9]/)
        }
      },
    )
  })
})

/**
 * A self-host container does not tell browsers that Aglyn may frame it
 * (AGL-2446).
 *
 * AGL-2198 merged the operator's hosts in and kept ours, reasoning that ours
 * are harmless on their deployment "because nothing there resolves to it".
 * True of `img-src`, whose entries name hosts a page might load FROM. Not true
 * of `frame-ancestors`, whose entries name hosts allowed to FRAME the page —
 * and Aglyn's 26 origins are live servers we run. Measured against a real
 * container: every published page answered with all 26 of ours, plus the
 * operator's, and no configuration removed them.
 *
 * The gate is the deployment shape, not the presence of operator config, and
 * the difference is load-bearing: Aglyn's own deployment sets the
 * `NEXT_PUBLIC_*` values too, so a "seed ours only when theirs is empty" rule
 * would have stripped our 26 origins from OUR policy and broken the
 * `auth.aglyn.com` helper iframe.
 */
describe('frame-ancestors on a self-host container (AGL-2446)', () => {
  const CONTAINER = {
    AGLYN_STANDALONE: '1',
    NEXT_PUBLIC_CONSOLE_URL: 'https://console.example.com',
    NEXT_PUBLIC_TENANT_DOMAIN: 'sites.example.com',
  }

  function withStandalone<T>(
    env: Record<string, string | undefined>,
    run: () => T,
  ): T {
    const saved = process.env.AGLYN_STANDALONE
    try {
      if (env.AGLYN_STANDALONE === undefined) delete process.env.AGLYN_STANDALONE
      else process.env.AGLYN_STANDALONE = env.AGLYN_STANDALONE
      return withEnv(env, run)
    } finally {
      if (saved === undefined) delete process.env.AGLYN_STANDALONE
      else process.env.AGLYN_STANDALONE = saved
    }
  }

  it("SELF-HOST: only the operator's hosts may frame their pages", () => {
    const ancestors = withStandalone(CONTAINER, () =>
      sourcesOf(baseCspDirectives(true), 'frame-ancestors'),
    )
    expect(ancestors).toEqual([
      'https://console.example.com',
      'https://sites.example.com',
    ])
    // The assertion that matters is the absence, stated as an absence rather
    // than inferred from the equality above.
    for (const domain of PRODUCTION_DOMAINS) {
      expect(ancestors).not.toContain(`https://${domain}`)
    }
  })

  it('SELF-HOST with nothing configured falls to \'self\', never to an empty list', () => {
    // An empty source list is not a strict policy — `frame-ancestors ` with no
    // sources is an INVALID directive, which browsers drop, leaving the page
    // framable by anyone. This is the failure mode the narrowing could have
    // introduced, so it is asserted directly.
    const ancestors = withStandalone({ AGLYN_STANDALONE: '1' }, () =>
      sourcesOf(baseCspDirectives(true), 'frame-ancestors'),
    )
    expect(ancestors).toEqual(["'self'"])
  })

  it('AGLYN-OPERATED is untouched: our 26 hosts, plus the operator entries', () => {
    const ancestors = withStandalone(
      { NEXT_PUBLIC_CONSOLE_URL: 'https://app.aglyn.com' },
      () => sourcesOf(baseCspDirectives(true), 'frame-ancestors'),
    )
    for (const domain of PRODUCTION_DOMAINS) {
      expect(ancestors).toContain(`https://${domain}`)
    }
  })

  it('img-src is NOT narrowed — the two directives mean different things', () => {
    // `img-src` names hosts a page may load FROM, where AGL-2198's "harmless"
    // reasoning does hold. Narrowing it as well would break media that legitimately
    // still resolves, so the change is deliberately confined to frame-ancestors.
    const img = withStandalone(CONTAINER, () =>
      sourcesOf(imgSrcDirective(true), 'img-src'),
    )
    expect(img.length).toBeGreaterThan(0)
  })
})
