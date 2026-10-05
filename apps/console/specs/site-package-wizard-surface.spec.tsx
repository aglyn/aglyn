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
 * AGL-3534: the console's half of the package import wizard — the client
 * that speaks the site package routes, the side-by-side frames' snapshots,
 * and the backup card that opens the wizard, the export picker and undo
 * from its header.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SiteBackupCard from '../components/site-backup-card.component'
import { readPreviewState } from '../constants/preview-state'
import { createSitePackageHttpClient, SitePackageRequestError } from '../utils/site-package-http-client'
import { packagePreviewTree, sitePackagePreviewHref } from '../utils/site-package-preview'

const mockEnqueueSnackbar = jest.fn()
let mockOrg: { org: Record<string, unknown> | undefined; ready: boolean } = { org: { plan: 'pro' }, ready: true }
const mockClient = {
  plan: jest.fn(),
  compare: jest.fn(),
  apply: jest.fn(),
  undoPlan: jest.fn(),
  undo: jest.fn(),
  catalog: jest.fn(async () => ({ manifest: { format: 'aglyn-package', version: 2, items: [] }, kinds: [] })),
  exportPackage: jest.fn(),
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u1' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme', host: 'acme-site' }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => mockOrg,
}))
jest.mock('@aglyn/shared-ui-jsx', () => {
  const actual = jest.requireActual('@aglyn/shared-ui-jsx')
  return {
    ...actual,
    MdiIcon: () => null,
    CardDisplay: (props: any) => (
      <section aria-label={props.header}>
        <div data-testid="card-actions">{props.HeaderProps?.action}</div>
        {props.children}
      </section>
    ),
  }
})
jest.mock('../utils/site-package-http-client', () => ({
  ...jest.requireActual('../utils/site-package-http-client'),
  createSitePackageHttpClient: () => mockClient,
}))

describe('the site package client', () => {
  const recorded: Array<{ url: string; body: any }> = []
  const respond = (status: number, payload: unknown, headers: Record<string, string> = {}) =>
    jest.fn(async (url: string, init?: RequestInit) => {
      recorded.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
      // jsdom has no `Response`; the client reads only these.
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => headers[name] ?? null },
        json: async () => JSON.parse(text),
        blob: async () => new Blob([text]),
      } as unknown as Response
    })

  beforeEach(() => {
    recorded.length = 0
  })

  it('plans, compares and applies through the import route, bound to its site', async () => {
    const fetch = respond(200, { items: [{ key: 'page/a' }] })
    const client = jest.requireActual('../utils/site-package-http-client').createSitePackageHttpClient({
      hostId: 'host-1',
      fetch,
    }) as ReturnType<typeof createSitePackageHttpClient>
    await client.plan({ manifest: {} }, { decisions: { 'page/a': 'replace' } })
    expect(await client.compare({ manifest: {} }, ['page/a'])).toEqual([{ key: 'page/a' }])
    await client.apply({}, { decisions: {}, dependencyChoices: { 'layout/x': 'drop' }, mergeChoices: {} })
    await client.undo('imp-1', { decisions: { 'page/a': 'revert' }, otherwise: 'keep' })
    expect(recorded.map((one) => [one.url, one.body.hostId, one.body.action])).toEqual([
      ['/api/hosts/import', 'host-1', 'plan'],
      ['/api/hosts/import', 'host-1', 'compare'],
      ['/api/hosts/import', 'host-1', 'apply'],
      ['/api/hosts/import', 'host-1', 'undo'],
    ])
    expect(recorded[0]?.body.decisions).toEqual({ 'page/a': 'replace' })
    expect(recorded[1]?.body.keys).toEqual(['page/a'])
    expect(recorded[2]?.body.dependencyChoices).toEqual({ 'layout/x': 'drop' })
    expect(recorded[3]?.body).toMatchObject({ importId: 'imp-1', otherwise: 'keep' })
  })

  it('throws the route’s refusal with its problems', async () => {
    const client = jest.requireActual('../utils/site-package-http-client').createSitePackageHttpClient({
      hostId: 'host-1',
      fetch: respond(400, { error: 'Some decisions cannot be applied', problems: ['a cannot be "x".'] }),
    }) as ReturnType<typeof createSitePackageHttpClient>
    const refusal = await client.apply({}, { decisions: {}, dependencyChoices: {}, mergeChoices: {} }).catch((e: unknown) => e)
    expect(refusal).toBeInstanceOf(SitePackageRequestError)
    expect((refusal as Error).message).toBe('Some decisions cannot be applied: a cannot be "x".')
  })

  it('lists the manifest and downloads a selection under the route’s file name', async () => {
    const fetch = respond(200, '{}', { 'Content-Disposition': 'attachment; filename="aglyn-acme-2026-10-05.json"' })
    const client = jest.requireActual('../utils/site-package-http-client').createSitePackageHttpClient({
      hostId: 'host-1',
      fetch,
    }) as ReturnType<typeof createSitePackageHttpClient>
    await client.catalog()
    const file = await client.exportPackage({ items: ['page/a'], dependencies: true })
    expect(file.fileName).toBe('aglyn-acme-2026-10-05.json')
    expect(recorded.map((one) => [one.url, one.body])).toEqual([
      ['/api/hosts/export', { hostId: 'host-1', list: true }],
      ['/api/hosts/export', { hostId: 'host-1', items: ['page/a'], dependencies: true }],
    ])
  })
})

describe('the side-by-side frames', () => {
  const NODES = {
    root: { $id: 'root', componentId: 'div', nodes: ['text'] },
    text: { $id: 'text', componentId: 'typography', nodes: [], props: { children: 'Hi' } },
  }

  beforeEach(() => window.localStorage.clear())

  it('reads a page’s design off its version and a component’s off itself', () => {
    expect(packagePreviewTree('page', { version: { nodes: NODES, rootId: 'root' } })).toMatchObject({ text: { $id: 'text' } })
    expect(packagePreviewTree('component', { nodes: NODES, rootId: 'root' })).toMatchObject({ text: { $id: 'text' } })
    expect(packagePreviewTree('page', { displayName: 'No design' })).toBeNull()
    expect(packagePreviewTree('form', { nodes: NODES })).toBeNull()
  })

  it('writes each side under a version of its own and answers the preview route', () => {
    const href = sitePackagePreviewHref({ orgSlug: 'acme', host: 'acme-site', hostId: 'host-1' })
    expect(href({ side: 'file', key: 'page/home', kind: 'page', id: 'home', content: { version: { nodes: NODES } } })).toBe(
      '/acme/hosts/acme-site/screens/home/versions/package-file/preview',
    )
    expect(href({ side: 'site', key: 'layout/l', kind: 'layout', id: 'l', content: { version: { nodes: NODES } } })).toBe(
      '/acme/hosts/acme-site/layouts/l/versions/package-site/preview',
    )
    expect(readPreviewState({ hostId: 'host-1', kind: 'screen', docId: 'home', versionId: 'package-file' })?.nodes).toMatchObject({
      text: { props: { children: 'Hi' } },
    })
    expect(href({ side: 'file', key: 'settings/settings', kind: 'settings', id: 'settings', content: {} })).toBeNull()
  })
})

describe('the backup card', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOrg = { org: { plan: 'pro' }, ready: true }
  })

  it('opens the package wizard and the export picker from its header', async () => {
    render(<SiteBackupCard hostId="host-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Import package' }))
    expect(screen.getByRole('dialog', { name: 'Import a site package' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export items' }))
    })
    await waitFor(() => expect(mockClient.catalog).toHaveBeenCalled())
    expect(screen.getByRole('dialog', { name: 'Export items' })).toBeTruthy()
  })

  it('refuses a site without the plan, saying so', () => {
    mockOrg = { org: { plan: 'free' }, ready: true }
    render(<SiteBackupCard hostId="host-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Import package' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(expect.stringContaining('Pro plan'), expect.anything())
  })
})
