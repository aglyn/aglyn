import { NextRequest } from 'next/server'

async function drive(host: string): Promise<Response> {
  jest.resetModules()
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }) as never) as never
  const { middleware } = await import('../middleware')
  return (await middleware(
    new NextRequest(new URL('/', `https://${host}`), { headers: { host } }),
    {} as never,
  )) as Response
}

describe('probe', () => {
  const ORIGINAL = { ...process.env }
  beforeEach(() => {
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    process.env.AGLYN_STANDALONE = '1'
    Object.assign(process.env, { NODE_ENV: 'production' })
    process.env.AGLYN_TENANT_HOST_CNAME = 'sites.example.com'
    process.env.NEXT_PUBLIC_TENANT_DOMAIN = 'sites.example.com'
    process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://console.example.com'
  })
  afterEach(() => { process.env = { ...ORIGINAL }; jest.resetModules() })

  it('what does acme.sites.example.com rewrite to?', async () => {
    const r = await drive('acme.sites.example.com')
    console.log('REWRITE:', r.headers.get('x-middleware-rewrite'))
    const r2 = await drive('bravo.sites.example.com')
    console.log('REWRITE2:', r2.headers.get('x-middleware-rewrite'))
  })
})
