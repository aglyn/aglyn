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
 *
 * @jest-environment jsdom
 */

/**
 * WHICH SURFACE A MESSAGE URL RESOLVES TO.
 *
 * `/emails/messages/{id}` reports on an email; `/emails/messages/{id}/edit`
 * writes it. They were one route, and one route cannot be both — a report is
 * a page of figures a reader scrolls, and a composer is a form with one
 * irreversible button.
 *
 * Both bodies are stubbed. What belongs here is which one the segments select
 * and what it is handed, not what either does once it is mounted: the real
 * ones open Firestore listens against hooks no tree here provides, and their
 * behavior is covered by their own files.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

/** The props each stub was mounted with, or null while it is not. */
let detailProps: Record<string, unknown> | null = null
let composeProps: Record<string, unknown> | null = null
let listMounted = false

jest.mock('./email-detail', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    detailProps = props
    return <div>{'the report'}</div>
  },
}))
jest.mock('./email-compose-card', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    composeProps = props
    return <div>{'the composer'}</div>
  },
}))
jest.mock('./emails-list-card', () => ({
  __esModule: true,
  default: () => {
    listMounted = true
    return <div>{'the list'}</div>
  },
}))

/*
 * The rail, which this file is not about. It renders its children and nothing
 * else, so what is asserted below is the section body the page chose.
 */
jest.mock('@aglyn/shared-ui-next', () => ({
  __esModule: true,
  HubSections: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import EmailsConsolePage from './emails-console-page'

const BASE_PATH = '/acme/hosts/site/emails'

function renderMessages(detail: string[] = []) {
  detailProps = null
  composeProps = null
  listMounted = false
  return render(
    (
      <EmailsConsolePage
        hostId="site1"
        entitled
        org={{ plan: 'business' } as never}
        permissions={{} as never}
        basePath={BASE_PATH}
        sections={[{ id: 'messages', label: 'Messages' }] as never}
        section="messages"
        segments={['messages', ...detail]}
      />
    ) as ReactNode as never,
  )
}

describe('a message URL, and the two jobs it used to do at once', () => {
  it('lists the messages when the URL names no email', async () => {
    renderMessages()

    expect(listMounted).toBe(true)
    expect(detailProps).toBeNull()
    expect(composeProps).toBeNull()
  })

  it('REPORTS on the email at `…/{id}`', async () => {
    renderMessages(['msg_1'])

    expect(screen.getByText('the report')).toBeTruthy()
    expect(detailProps).toMatchObject({
      emailId: 'msg_1',
      hostId: 'site1',
      basePath: BASE_PATH,
    })
    // The composer is not merely hidden here — it is not constructed, so the
    // reader of a report pays for none of its listens.
    expect(composeProps).toBeNull()
  })

  it('WRITES the email at `…/{id}/edit`', async () => {
    renderMessages(['msg_1', 'edit'])

    expect(screen.getByText('the composer')).toBeTruthy()
    expect(composeProps).toMatchObject({
      emailId: 'msg_1',
      hostId: 'site1',
      basePath: BASE_PATH,
    })
    expect(detailProps).toBeNull()
  })

  it('THE CONTROL: the segment decides, and one branch is not always taken', async () => {
    /*
     * Both tests above pass against a page that always mounted the surface
     * each was looking for. This is the pair that does not: the same section
     * and the same id, differing only in the trailing segment, asserted to
     * mount different things.
     */
    renderMessages(['msg_1'])
    const reported = { detailProps, composeProps }
    renderMessages(['msg_1', 'edit'])

    expect(reported.detailProps).not.toBeNull()
    expect(reported.composeProps).toBeNull()
    expect(composeProps).not.toBeNull()
    expect(detailProps).toBeNull()
  })

  it('treats an unrecognized trailing segment as the email’s own page', async () => {
    // `edit` is the one subroute this section owns. Anything else is not a
    // second composer address — the record's page is the canonical one.
    renderMessages(['msg_1', 'something-else'])

    expect(detailProps).toMatchObject({ emailId: 'msg_1' })
    expect(composeProps).toBeNull()
  })
})
