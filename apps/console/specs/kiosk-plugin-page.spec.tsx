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
 * The console's generic public route (AGL-3608): `/kiosk/{pluginId}/{…path}`
 * loads ONE plugin's console bundle, and only for a path that plugin's
 * manifest entry declares — an anonymous visitor guessing paths fetches no
 * plugin code at all.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { resolveNavSection, urlNamesOrg } from '../hooks/nav-section'

const mockEnsure = jest.fn(async (_ids: readonly string[], _surfaces: readonly string[]) => {
  const { registerConsoleExtension } = jest.requireActual('@aglyn/aglyn/plugin-manager/feature-plugins')
  registerConsoleExtension({
    pluginId: 'alpha',
    displayName: 'Alpha',
    publicPages: [
      {
        path: '/display',
        title: 'Front display',
        Component: ({ pluginId, path }: { pluginId: string; path: string }) => (
          <p>{`display for ${pluginId} at ${path}`}</p>
        ),
      },
    ],
  })
})

jest.mock('../constants/console-plugin-loader', () => ({
  consolePluginLoader: { ensure: (...args: [readonly string[], readonly string[]]) => mockEnsure(...args) },
}))

jest.mock('../constants/plugins.client.generated', () => ({
  CONSOLE_PLUGIN_MANIFEST: [
    {
      id: 'alpha',
      register: { console: 'registerAlphaConsole' },
      contributes: { console: { publicRoutes: ['/display', '/declared-but-unregistered'] } },
      load: async () => ({}),
    },
    {
      id: 'beta',
      register: { console: 'registerBetaConsole' },
      contributes: { console: { routes: ['/beta'] } },
      load: async () => ({}),
    },
  ],
}))

jest.mock('@aglyn/aglyn', () => jest.requireActual('@aglyn/aglyn/plugin-manager/feature-plugins'))

jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

jest.mock('../components/document-subject', () => ({
  useDeclareDocumentSubject: jest.fn(),
}))

// eslint-disable-next-line import/first
import { KioskPluginPage, kioskRouteDeclared } from '../components/kiosk-plugin-page.component'

/** Renders, and reports a `notFound()` thrown during render as such. */
function renderRoute(pluginId: string, path: string) {
  const errors: unknown[] = []
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  class Boundary extends (require('react') as typeof import('react')).Component<
    { children: React.ReactNode },
    { failed: boolean }
  > {
    override state = { failed: false }
    static getDerivedStateFromError() {
      return { failed: true }
    }
    override componentDidCatch(error: unknown) {
      errors.push(error)
    }
    override render() {
      return this.state.failed ? <p>not found</p> : this.props.children
    }
  }
  render(
    <Boundary>
      <KioskPluginPage pluginId={pluginId} path={path} />
    </Boundary>,
  )
  return errors
}

describe('the kiosk route (AGL-3608)', () => {
  beforeEach(() => {
    mockEnsure.mockClear()
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reads the declaration from the manifest before loading anything', () => {
    expect(kioskRouteDeclared('alpha', 'display')).toBe(true)
    expect(kioskRouteDeclared('alpha', '/display/')).toBe(true)
    expect(kioskRouteDeclared('alpha', '/other')).toBe(false)
    expect(kioskRouteDeclared('beta', '/beta')).toBe(false)
    expect(kioskRouteDeclared('nobody', '/display')).toBe(false)
  })

  it('loads only the named plugin, for the console surface, and renders its page', async () => {
    renderRoute('alpha', 'display')
    expect(await screen.findByText('display for alpha at /display')).toBeTruthy()
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(mockEnsure).toHaveBeenCalledWith(['alpha'], ['console'])
  })

  it('is not found, with no bundle fetched, for a path the manifest does not declare', () => {
    const errors = renderRoute('beta', 'beta')
    expect(screen.getByText('not found')).toBeTruthy()
    expect(String(errors[0])).toContain('NEXT_NOT_FOUND')
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it('is not found when the loaded plugin registers no page at a declared path', async () => {
    renderRoute('alpha', 'declared-but-unregistered')
    await waitFor(() => expect(screen.getByText('not found')).toBeTruthy())
    expect(mockEnsure).toHaveBeenCalledTimes(1)
  })

  it('names no workspace, even on a workspace subdomain', () => {
    const section = resolveNavSection('/kiosk/alpha/display')
    expect(section.kind).toBe('kiosk')
    expect(urlNamesOrg(section, 'acme')).toBe(false)
  })
})
