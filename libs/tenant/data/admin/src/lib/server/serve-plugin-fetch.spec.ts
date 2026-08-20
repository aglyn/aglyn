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
 * The host-mediated plugin fetch (AGL-191) and its SSRF guard (AGL-515).
 *
 * This file had NO spec at all until AGL-2480, which is how a dependency bump
 * came within one merge of silently disabling the guard: `undici` was a
 * phantom dependency — imported by production code, declared nowhere, and
 * present only as a transitive of the **dev-only** `jsdom`. Bumping jsdom
 * moved undici 7 up to 8, and undici 8 rejects the `connect.lookup` shape this
 * control depends on with `UND_ERR_INVALID_ARG` on every request.
 *
 * So the coverage here is deliberately in two layers:
 *
 * 1. **Transport** — `createPinnedDispatcher` is driven through a REAL
 *    `fetch` against a REAL local server. This is the layer that goes red on
 *    an undici major that changes the lookup contract. Asserting the shape of
 *    the options object would not have caught it; only issuing a request does.
 * 2. **Policy** — the refusals in front of the transport (method, allowlist,
 *    install record, private-address resolution, body cap), driven through the
 *    real `servePluginFetch` with Firestore and DNS stubbed.
 */

import type { AddressInfo } from 'net'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { Agent } from 'undici'
import { createPinnedDispatcher, servePluginFetch } from './serve-plugin-fetch'

/** Addresses `lookup` will report for the requested hostname. */
let resolved: { address: string; family: number }[] | Error = []

jest.mock('dns/promises', () => ({
  lookup: async () => {
    if (resolved instanceof Error) throw resolved
    return resolved
  },
}))

/** `hosts/{hostId}/installs/{listingId}` — the server-side install record. */
let install: Record<string, unknown> | undefined

jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ get: async () => ({ data: () => install }) }),
            }),
          }),
        }),
      }),
    }),
  },
}))

interface Captured {
  status: number
  body: Record<string, unknown>
  headers: Record<string, string>
}

/** Minimal `NextApiResponse` that records what the handler wrote. */
function makeRes(): { res: any; captured: Captured } {
  const captured: Captured = { status: 0, body: {}, headers: {} }
  const res: any = {
    setHeader: (name: string, value: string) => {
      captured.headers[name] = value
      return res
    },
    status: (code: number) => {
      captured.status = code
      return res
    },
    json: (payload: Record<string, unknown>) => {
      captured.body = payload
      return res
    },
  }
  return { res, captured }
}

const ALLOWED_ORIGIN = 'https://api.example.com'

function makeReq(body: unknown, method = 'POST'): any {
  return { method, body }
}

/** An install whose manifest declares `ALLOWED_ORIGIN` for host-mediated fetch. */
const INSTALLED = {
  manifest: { capabilities: { network: [ALLOWED_ORIGIN] } },
}

beforeEach(() => {
  install = INSTALLED
  resolved = [{ address: '93.184.216.34', family: 4 }]
})

describe('createPinnedDispatcher — the AGL-515 socket pin (AGL-2480)', () => {
  /** Two servers on the SAME port, one per address family, answering
   * differently — so "which address did the socket actually reach?" is a
   * readable assertion rather than an inference. */
  let v4: Server
  let v6: Server
  let port: number
  /** `Host` header seen by the server, proving the pin did not rewrite it. */
  let seenHost: string | undefined

  const listen = (server: Server, host: string, wanted = 0) =>
    new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(wanted, host, () =>
        resolve((server.address() as AddressInfo).port),
      )
    })

  beforeAll(async () => {
    const handler = (body: string) => (req: IncomingMessage, res: any) => {
      seenHost = req.headers.host
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(body)
    }
    v4 = createServer(handler('from-v4'))
    v6 = createServer(handler('from-v6'))
    port = await listen(v4, '127.0.0.1')
    await listen(v6, '::1', port)
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => v4.close(() => resolve()))
    await new Promise<void>((resolve) => v6.close(() => resolve()))
  })

  beforeEach(() => {
    seenHost = undefined
  })

  it('issues a real request through the pinned dispatcher — the undici-major canary', async () => {
    // The whole point: undici 8 throws UND_ERR_INVALID_ARG here rather than
    // connecting. If this test starts failing after a dependency bump, the
    // plugin-fetch route is broken in production, fail-closed but broken.
    const dispatcher = createPinnedDispatcher('127.0.0.1')
    try {
      const response = await fetch(`http://pinned.invalid:${port}/probe`, {
        dispatcher,
      } as RequestInit)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('from-v4')
    } finally {
      await dispatcher.close()
    }
  })

  it('connects to the pinned address even for a hostname that could never resolve', async () => {
    // `.invalid` is reserved and unresolvable (RFC 2606). The request can only
    // have arrived because `connect.lookup` overrode resolution — which is
    // exactly the property that closes the DNS-rebinding window.
    const dispatcher = createPinnedDispatcher('127.0.0.1')
    try {
      const response = await fetch(`http://also-not-real.invalid:${port}/`, {
        dispatcher,
      } as RequestInit)
      expect(response.status).toBe(200)
      // The original hostname still travels in `Host` (and, over TLS, in SNI
      // and certificate validation) — only address resolution is replaced.
      expect(seenHost).toBe(`also-not-real.invalid:${port}`)
    } finally {
      await dispatcher.close()
    }
  })

  it('selects the address FAMILY from the pin, reaching the v6 socket for a v6 pin', async () => {
    // Same hostname, same port, opposite family. If the pin's family were
    // ignored or hard-coded to 4 this would answer `from-v4`.
    const dispatcher = createPinnedDispatcher('::1')
    try {
      const response = await fetch(`http://v6.invalid:${port}/`, {
        dispatcher,
      } as RequestInit)
      expect(await response.text()).toBe('from-v6')
    } finally {
      await dispatcher.close()
    }
  })
})

describe('servePluginFetch — refusals in front of the transport', () => {
  it('refuses anything but POST', async () => {
    const { res, captured } = makeRes()
    await servePluginFetch(makeReq({}, 'GET'), res)
    expect(captured.status).toBe(405)
    expect(captured.headers['Allow']).toBe('POST')
  })

  it('refuses a request missing hostId, listingId or url', async () => {
    for (const body of [
      {},
      { hostId: 'h', listingId: 'l' },
      { hostId: 'h', url: `${ALLOWED_ORIGIN}/x` },
      { listingId: 'l', url: `${ALLOWED_ORIGIN}/x` },
    ]) {
      const { res, captured } = makeRes()
      await servePluginFetch(makeReq(body), res)
      expect(captured.status).toBe(400)
    }
  })

  it('refuses a body over the cap before touching the install record', async () => {
    install = undefined // would 404 if the cap did not short-circuit first
    const { res, captured } = makeRes()
    await servePluginFetch(
      makeReq({
        hostId: 'h',
        listingId: 'l',
        url: `${ALLOWED_ORIGIN}/x`,
        method: 'POST',
        body: 'x'.repeat(256 * 1024 + 1),
      }),
      res,
    )
    expect(captured.status).toBe(413)
  })

  it('refuses when the plugin is not installed on this host', async () => {
    install = undefined
    const { res, captured } = makeRes()
    await servePluginFetch(
      makeReq({ hostId: 'h', listingId: 'l', url: `${ALLOWED_ORIGIN}/x` }),
      res,
    )
    expect(captured.status).toBe(404)
  })

  it('re-derives the allowlist from the install record, not the client claim', async () => {
    const { res, captured } = makeRes()
    await servePluginFetch(
      makeReq({
        hostId: 'h',
        listingId: 'l',
        url: 'https://evil.example.net/steal',
        // A client asserting its own capabilities must change nothing.
        capabilities: { network: ['https://evil.example.net'] },
      }),
      res,
    )
    expect(captured.status).toBe(403)
    expect(captured.body['error']).toBe('URL not in allowlist')
  })

  it('refuses plain http even for an allowlisted host', async () => {
    const { res, captured } = makeRes()
    await servePluginFetch(
      makeReq({ hostId: 'h', listingId: 'l', url: 'http://api.example.com/x' }),
      res,
    )
    expect(captured.status).toBe(403)
    expect(captured.body['error']).toBe('URL not in allowlist')
  })
})

describe('servePluginFetch — the private-address refusal (AGL-515)', () => {
  const cases: [string, string][] = [
    ['loopback', '127.0.0.1'],
    ['cloud metadata / link-local', '169.254.169.254'],
    ['RFC1918 10/8', '10.0.0.5'],
    ['RFC1918 172.16/12', '172.20.1.1'],
    ['RFC1918 192.168/16', '192.168.1.1'],
    ['CGNAT 100.64/10', '100.100.0.1'],
    ['this-network 0/8', '0.0.0.0'],
    ['IPv6 loopback', '::1'],
    ['IPv6 ULA', 'fd00::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['v4-mapped loopback', '::ffff:127.0.0.1'],
  ]

  it.each(cases)('refuses an allowlisted origin resolving to %s', async (_label, address) => {
    resolved = [{ address, family: address.includes(':') ? 6 : 4 }]
    const { res, captured } = makeRes()
    await servePluginFetch(
      makeReq({ hostId: 'h', listingId: 'l', url: `${ALLOWED_ORIGIN}/x` }),
      res,
    )
    expect(captured.status).toBe(403)
    expect(captured.body['error']).toBe('URL resolves to a non-public address')
  })

  it('refuses when ANY resolved address is private, not just the first', async () => {
    resolved = [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]
    const { res, captured } = makeRes()
    await servePluginFetch(
      makeReq({ hostId: 'h', listingId: 'l', url: `${ALLOWED_ORIGIN}/x` }),
      res,
    )
    expect(captured.status).toBe(403)
    expect(captured.body['error']).toBe('URL resolves to a non-public address')
  })

  it('refuses when the hostname does not resolve at all', async () => {
    resolved = []
    const { res, captured } = makeRes()
    await servePluginFetch(
      makeReq({ hostId: 'h', listingId: 'l', url: `${ALLOWED_ORIGIN}/x` }),
      res,
    )
    expect(captured.status).toBe(403)
  })

  it('refuses when resolution throws', async () => {
    resolved = new Error('ENOTFOUND')
    const { res, captured } = makeRes()
    await servePluginFetch(
      makeReq({ hostId: 'h', listingId: 'l', url: `${ALLOWED_ORIGIN}/x` }),
      res,
    )
    expect(captured.status).toBe(403)
  })
})

describe('servePluginFetch — what reaches the network', () => {
  const realFetch = globalThis.fetch
  let seen: { url: string; init: any } | undefined

  beforeEach(() => {
    seen = undefined
    globalThis.fetch = (async (url: string, init: any) => {
      seen = { url, init }
      return new Response('upstream-body', { status: 200 })
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('passes a PINNED undici dispatcher into the request, not the global one', async () => {
    resolved = [{ address: '93.184.216.34', family: 4 }]
    const { res, captured } = makeRes()
    await servePluginFetch(
      makeReq({ hostId: 'h', listingId: 'l', url: `${ALLOWED_ORIGIN}/data` }),
      res,
    )
    expect(captured.status).toBe(200)
    // The guard is worth nothing if the dispatcher is built and then dropped.
    expect(seen?.init.dispatcher).toBeInstanceOf(Agent)
    expect(seen?.url).toBe(`${ALLOWED_ORIGIN}/data`)
    expect(captured.body).toEqual({ ok: true, status: 200, body: 'upstream-body' })
  })

  it('forwards no host credentials and caps the method to GET/POST', async () => {
    const { res } = makeRes()
    await servePluginFetch(
      makeReq({
        hostId: 'h',
        listingId: 'l',
        url: `${ALLOWED_ORIGIN}/data`,
        method: 'DELETE',
        body: 'ignored',
      }),
      res,
    )
    expect(seen?.init.method).toBe('GET')
    // A downgraded method must not smuggle its body through.
    expect(seen?.init.body).toBeUndefined()
    const headerNames = Object.keys(seen?.init.headers ?? {}).map((h) => h.toLowerCase())
    expect(headerNames).toEqual(['accept'])
    expect(headerNames).not.toContain('cookie')
    expect(headerNames).not.toContain('authorization')
  })

  it('sends a POST body through when the method is POST', async () => {
    const { res } = makeRes()
    await servePluginFetch(
      makeReq({
        hostId: 'h',
        listingId: 'l',
        url: `${ALLOWED_ORIGIN}/data`,
        method: 'POST',
        body: '{"q":1}',
      }),
      res,
    )
    expect(seen?.init.method).toBe('POST')
    expect(seen?.init.body).toBe('{"q":1}')
  })

  it('clips an oversized upstream response to the cap', async () => {
    globalThis.fetch = (async () =>
      new Response('y'.repeat(256 * 1024 + 500), {
        status: 200,
      })) as unknown as typeof fetch
    const { res, captured } = makeRes()
    await servePluginFetch(
      makeReq({ hostId: 'h', listingId: 'l', url: `${ALLOWED_ORIGIN}/big` }),
      res,
    )
    expect(captured.status).toBe(200)
    expect((captured.body['body'] as string).length).toBe(256 * 1024)
  })

  it('parses a string body, so a raw JSON payload is not silently empty', async () => {
    const { res, captured } = makeRes()
    await servePluginFetch(
      makeReq(
        JSON.stringify({
          hostId: 'h',
          listingId: 'l',
          url: `${ALLOWED_ORIGIN}/data`,
        }),
      ),
      res,
    )
    expect(captured.status).toBe(200)
    expect(seen?.url).toBe(`${ALLOWED_ORIGIN}/data`)
  })

  it('reports 502 without leaking the upstream error', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED 93.184.216.34:443')
    }) as unknown as typeof fetch
    const { res, captured } = makeRes()
    await servePluginFetch(
      makeReq({ hostId: 'h', listingId: 'l', url: `${ALLOWED_ORIGIN}/data` }),
      res,
    )
    expect(captured.status).toBe(502)
    expect(captured.body).toEqual({ ok: false, status: 0, error: 'Fetch failed' })
    expect(JSON.stringify(captured.body)).not.toContain('ECONNREFUSED')
    spy.mockRestore()
  })
})
