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

import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { OutreachConsolePage } from './outreach-console-page'

/**
 * The Outreach hub (AGL-2980) mounts the one section the URL names, handing
 * each the organization from the shell's mount — and the Sequences section
 * its own path and the path below it, where a sequence's pages live.
 */

jest.mock('@aglyn/shared-ui-next', () => ({
  HubSections: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}))
jest.mock('./sequences-section', () => ({
  __esModule: true,
  default: (props: {
    orgId: string
    sectionPath: string
    subpath: string[]
  }) => (
    <p>{`sequences ${props.orgId} ${props.sectionPath} [${props.subpath.join('/')}]`}</p>
  ),
}))
jest.mock('./mailboxes-section', () => ({
  __esModule: true,
  default: () => <p>mailboxes</p>,
}))
jest.mock('./compliance-section', () => ({
  __esModule: true,
  default: (props: { orgId: string }) => <p>{`compliance ${props.orgId}`}</p>,
}))

const page = (section: string, segments: string[]): ConsolePluginPageProps => ({
  hostId: null,
  entitled: true,
  basePath: '/acme/outreach',
  section,
  segments,
  sections: [
    {
      id: 'sequences',
      label: 'Sequences',
      href: '/acme/outreach/sequences',
      visible: true,
    },
    {
      id: 'mailboxes',
      label: 'Mailboxes',
      href: '/acme/outreach/mailboxes',
      visible: true,
    },
    {
      id: 'compliance',
      label: 'Compliance',
      href: '/acme/outreach/compliance',
      visible: true,
    },
  ] as ConsolePluginPageProps['sections'],
  orgMount: {
    orgId: 'org-1',
    hosts: [],
    hostsReady: true,
    hostsPath: '/acme/hosts',
  },
})

describe('the Sequences hub (AGL-2980)', () => {
  it('mounts Compliance with the organization', () => {
    render(<OutreachConsolePage {...page('compliance', ['compliance'])} />)
    expect(screen.getByText('compliance org-1')).toBeTruthy()
  })

  it('hands Sequences its path and the pages below it', () => {
    render(
      <OutreachConsolePage
        {...page('sequences', ['sequences', 'seq-1', 'enrollments'])}
      />,
    )
    expect(
      screen.getByText(
        'sequences org-1 /acme/outreach/sequences [seq-1/enrollments]',
      ),
    ).toBeTruthy()
  })

  it('mounts Mailboxes', () => {
    render(<OutreachConsolePage {...page('mailboxes', ['mailboxes'])} />)
    expect(screen.getByText('mailboxes')).toBeTruthy()
  })
})
