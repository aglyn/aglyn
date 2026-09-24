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
 * The Emails page hosts the section as a zone and hands over the segments
 * under `messages`; choosing between the three pages is this widget's.
 *
 * Both bodies are stubbed. What belongs here is which one the segments select
 * and what it is handed, not what either does once it is mounted: the real
 * ones open Firestore listens against hooks no tree here provides, and their
 * behavior is covered by their own files.
 */

import { render, screen } from '@testing-library/react'

/** The props each stub was mounted with, or null while it is not. */
let detailProps: Record<string, unknown> | null = null
let composeProps: Record<string, unknown> | null = null
let listProps: Record<string, unknown> | null = null
let listMounted = false
/** The Marketing org mount the list stub read from context. */
let listOrgMount: unknown = undefined

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
  default: function EmailsListCardStub(props: Record<string, unknown>) {
    const { useMarketingOrgMount } = require('./marketing-org-mount')
    listMounted = true
    listProps = props
    listOrgMount = useMarketingOrgMount()
    return <div>{'the list'}</div>
  },
}))

import EmailMessagesWidget from './email-messages-widget'

const BASE_PATH = '/acme/hosts/site/emails'

function renderMessages(detail: string[] = []) {
  detailProps = null
  composeProps = null
  listProps = null
  listMounted = false
  listOrgMount = undefined
  return render(
    <EmailMessagesWidget hostId="site1" basePath={BASE_PATH} detail={detail} />,
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

/*==========================================
 * THE ORGANIZATION'S EMAILS PAGE.
 *
 * The same zone with no site: the widget is handed the shell's org mount and
 * publishes it to the three cards as the Marketing mount they already read,
 * so the list names each row's site and asks which site a new email is sent
 * as. The mount's own `basePath` is the organization's Marketing page, which
 * is where a campaign's page is; the message pages hang beneath the Emails
 * page's `basePath`, which is handed through untouched.
 *=========================================*/
describe('on the organization’s Emails page', () => {
  const ORG_EMAILS = '/acme/emails'
  const ORG_MOUNT = {
    orgId: 'org-1',
    orgSlug: 'acme',
    hosts: [{ id: 'site1', name: 'Store', subdomain: 'store' }],
    hostsReady: true,
    hostsPath: '/acme/hosts',
  }

  function renderAtOrg(orgMount: typeof ORG_MOUNT | undefined) {
    detailProps = null
    composeProps = null
    listProps = null
    listMounted = false
    listOrgMount = undefined
    return render(
      <EmailMessagesWidget
        hostId={null}
        basePath={ORG_EMAILS}
        detail={[]}
        orgMount={orgMount}
      />,
    )
  }

  it('lists every site’s messages, under the org’s own Emails page', () => {
    renderAtOrg(ORG_MOUNT)

    expect(listMounted).toBe(true)
    expect(listProps).toMatchObject({ hostId: null, basePath: ORG_EMAILS })
  })

  it('publishes the org and its sites, with the org Marketing page as the campaigns hub', () => {
    renderAtOrg(ORG_MOUNT)

    expect(listOrgMount).toEqual({
      orgId: 'org-1',
      orgSlug: 'acme',
      hosts: ORG_MOUNT.hosts,
      hostsReady: true,
      hostsPath: '/acme/hosts',
      basePath: '/acme/marketing',
    })
  })

  it('THE CONTROL: under a site the cards read no org mount', () => {
    renderMessages()
    expect(listMounted).toBe(true)
    expect(listOrgMount).toBeNull()
  })

  it('draws nothing with no site and no org mount', () => {
    renderAtOrg(undefined)
    expect(listMounted).toBe(false)
    expect(detailProps).toBeNull()
    expect(composeProps).toBeNull()
  })
})
