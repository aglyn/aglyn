/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://panaderia-el-trigal.aglyn.app/missing"}
 */
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
 * A site's own status pages speak its language (AGL-3771). Panaderia El
 * Trigal, a Spanish site, answered a missing page with "We can’t find that
 * page", "Search this site" and "Go to the homepage".
 */

jest.mock('next/navigation', () => ({
  __esModule: true,
  usePathname: () => '/missing',
}))
jest.mock('@aglyn/shared-ui-jsx/components/app-link', () => ({
  __esModule: true,
  default: ({ href, children, 'aria-label': ariaLabel }: { href: string; children?: React.ReactNode; 'aria-label'?: string }) => (
    <a href={href} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}))

import { render, screen, within } from '@testing-library/react'
import { HostBrandProvider } from '../app/[host]/host-brand.context'
import SiteStatusScreen from '../components/site-status-screen.component'
import SiteErrorScreen from '../components/site-error-screen.component'
import { SITE_STATUS_COPY_EN, siteStatusCopy, siteStatusLanguageOf } from '../utils/site-status-copy'

afterEach(() => {
  document.documentElement.lang = ''
})

describe('a site in Spanish', () => {
  it('says its 404 in Spanish', () => {
    render(
      <HostBrandProvider brandName="Panaderia El Trigal" language="es">
        <SiteStatusScreen search code="404" />
      </HostBrandProvider>,
    )
    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { level: 1, name: 'No encontramos esa página' })).toBeTruthy()
    expect(within(main).getByText(siteStatusCopy('es').notFoundMessage)).toBeTruthy()
    expect(within(main).getByLabelText('Buscar en este sitio')).toBeTruthy()
    expect(within(main).getByRole('button', { name: 'Buscar' })).toBeTruthy()
    expect(within(main).getByRole('link', { name: 'Ir a la página de inicio' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'Inicio de Panaderia El Trigal' })).toBeTruthy()
    expect(screen.queryByText(/We can.t find that page|Go to the homepage|Search this site/)).toBeNull()
  })

  it('reads the document’s language where the layout published none', () => {
    document.documentElement.lang = 'es-MX'
    render(<SiteErrorScreen onReset={() => undefined} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Algo salió mal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeTruthy()
  })
})

describe('a site in English, or a language the pages do not list', () => {
  it('keeps the English words', () => {
    render(
      <HostBrandProvider brandName="Acme" language="ja">
        <SiteStatusScreen search code="404" />
      </HostBrandProvider>,
    )
    expect(screen.getByRole('heading', { level: 1, name: SITE_STATUS_COPY_EN.notFoundTitle })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Acme home' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to the homepage' })).toBeTruthy()
  })

  it('reads a language by its two-letter code', () => {
    expect(siteStatusLanguageOf('pt-BR')).toBe('pt')
    expect(siteStatusCopy('en-US')).toBe(SITE_STATUS_COPY_EN)
    expect(siteStatusCopy(undefined)).toBe(SITE_STATUS_COPY_EN)
  })

  it('has every line in every language it lists', () => {
    for (const code of ['es', 'fr', 'pt', 'de', 'it']) {
      const copy = siteStatusCopy(code)
      expect(Object.keys(copy).sort()).toEqual(Object.keys(SITE_STATUS_COPY_EN).sort())
      expect(copy.markHome).toContain('{name}')
    }
  })
})
