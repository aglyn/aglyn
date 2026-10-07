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
 * Other ways to start an email design (AGL-3596): the `hostEmailTemplates`
 * zone the templates list hosts beside New template AND in its empty state,
 * drawn through the renderer the shell hands down — never a widget this
 * plugin imports. Declared by this plugin, laid out bare, and absent from the
 * shell's catalog.
 */

import { CONSOLE_WIDGET_SLOTS } from '@aglyn/aglyn'
import {
  ConsoleWidgetSlotContext,
  type ConsoleWidgetSlotRenderer,
} from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { pluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'
import { act, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { registerEmailConsole } from '../plugin'
import { EmailScreensCard } from './email-screens-card'
import { HOST_EMAIL_TEMPLATES_ZONE } from './email-zones'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: () => undefined }),
  usePathname: () => '/acme/hosts/site/emails/templates',
}))

let screenDocs: Array<Record<string, unknown>> = []

jest.mock('@aglyn/tenant-feature-instance', () => ({
  ...jest.requireActual('@aglyn/tenant-feature-instance'),
  DUPLICATE_MENU_LABEL: 'Duplicate…',
  useDuplicateResource: () => ({ request: jest.fn(), dialog: null }),
  useFirestore: () => ({}),
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
  useHostResourceApi: () => jest.fn(),
  useHostVersionApi: () => jest.fn(),
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () =>
  jest
    .requireActual('@aglyn/tenant-feature-instance/testing/list-query-double')
    .listQueryModule(
      () => screenDocs,
      jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    ),
)
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  // The header's action is drawn, under a marker, so a spec can tell it from
  // the body.
  CardDisplay: ({
    children,
    HeaderProps,
  }: {
    children: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <div>
      <div data-testid="header">{HeaderProps?.action}</div>
      <div data-testid="body">{children}</div>
    </div>
  ),
  useConfirmationContext: () => ({ confirm: jest.fn() }),
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  MdiIcon: () => null,
}))

/** Every call the shell's renderer received. */
const zoneCalls: Array<Record<string, unknown>> = []
const Renderer: ConsoleWidgetSlotRenderer = (props) => {
  zoneCalls.push(props)
  return <button type="button">{`widget in ${props.slot}`}</button>
}

const mountCard = async (withShell: boolean) => {
  const card = <EmailScreensCard hostId="host-1" orgId="org-1" basePath="/acme/hosts/site/emails" />
  render(
    withShell ? (
      <ConsoleWidgetSlotContext.Provider value={Renderer}>{card}</ConsoleWidgetSlotContext.Provider>
    ) : (
      card
    ),
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  zoneCalls.length = 0
  screenDocs = []
})

describe('the zone the templates list hosts', () => {
  it('is declared here under the id widgets register for, laid out bare, and not in the shell catalog', () => {
    registerEmailConsole()
    const zone = pluginZone('hostEmailTemplates')
    expect(HOST_EMAIL_TEMPLATES_ZONE.id).toBe('hostEmailTemplates')
    expect(`${zone?.pluginId} ${zone?.layout} ${zone?.surface}`).toBe(`${BUNDLE_ID} bare console`)
    expect(Object.values(CONSOLE_WIDGET_SLOTS)).not.toContain('hostEmailTemplates')
  })

  it('draws the zone beside New template and in the empty state, with the site and its org', async () => {
    await mountCard(true)
    const header = within(screen.getByTestId('header'))
    expect(header.getByRole('button', { name: 'widget in hostEmailTemplates' })).toBeTruthy()
    expect(screen.getByTestId('header').textContent).toMatch(/widget in hostEmailTemplates.*New template/s)
    const body = within(screen.getByTestId('body'))
    expect(body.getByRole('button', { name: 'widget in hostEmailTemplates' })).toBeTruthy()
    expect(body.getByRole('button', { name: 'Create your first template' })).toBeTruthy()
    expect(zoneCalls).toHaveLength(2)
    for (const call of zoneCalls) {
      expect(call).toEqual({ slot: 'hostEmailTemplates', hostId: 'host-1', orgId: 'org-1' })
    }
  })

  it('leaves the empty state once the site has a template; the header keeps the zone', async () => {
    screenDocs = [
      { $id: 's1', kind: 'email', displayName: 'Welcome', nameLower: 'welcome', versionId: 'v1' },
    ]
    await mountCard(true)
    expect(within(screen.getByTestId('header')).getByRole('button', { name: 'widget in hostEmailTemplates' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create your first template' })).toBeNull()
    expect(zoneCalls.every((call) => call['slot'] === 'hostEmailTemplates')).toBe(true)
  })

  it('draws nothing for the zone outside the console shell', async () => {
    await mountCard(false)
    expect(screen.queryByText(/widget in/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Create your first template' })).toBeTruthy()
  })
})
