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
 * WHERE EACH KIND OF ARTIFACT GOES (AGL-3080).
 *
 * The console pages that offer a publish used to build the request
 * themselves — the endpoint, the payload key, the noun in the copy — which
 * made a layouts page a file that could not be right without being kept in
 * step with this plugin's routes. They now hand over what they HAVE, in
 * their own vocabulary, and this widget turns it into a request.
 *
 * That translation is the half which can fail quietly: a payload key spelled
 * differently from the route that reads it publishes nothing and says the
 * publish succeeded, because the route defends itself and answers politely.
 * So every kind is driven end to end here, through the real form, and the
 * assertion is the body that reaches the network.
 *
 * ⚠️ The kinds below are the ones the console offers today — the layouts
 * page's menu item and the org publish panel's seven. A kind added to a
 * console page and not here is the drift this exists to catch; a kind here
 * and not on a page is dead code, which the last test makes visible rather
 * than silent.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PublishArtifactDialog from './publish-artifact-dialog.component'
import {
  PUBLISHER_AGREEMENT_TITLE,
  PUBLISHER_AGREEMENT_VERSION,
} from '../model/publisher-agreement'

const posted: Array<{ url: string; body: Record<string, unknown> }> = []
let responseStatus = 200
let responseBody: Record<string, unknown> = { listingId: 'listing-1', version: 1 }

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (
    _user: unknown,
    url: string,
    init?: { body: string },
  ) => {
    const reply = (status: number, body: unknown) => ({
      ok: status < 400,
      status,
      json: async () => body,
    })
    posted.push({ url, body: JSON.parse(String(init?.body)) })
    return reply(responseStatus, responseBody)
  },
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'me', getIdToken: async () => 'token' } }),
}))

beforeEach(() => {
  posted.length = 0
  responseStatus = 200
  responseBody = { listingId: 'listing-1', version: 1 }
  enqueueSnackbar.mockClear()
})

/** Ticks the publisher agreement above Publish (AGL-4105). */
function agree(): void {
  fireEvent.click(screen.getByRole('checkbox', { name: `Agree to the ${PUBLISHER_AGREEMENT_TITLE}` }))
}

/** Opens the dialog for one artifact, agrees, and presses Publish. */
async function publish(artifact: Record<string, unknown>): Promise<void> {
  const onClose = jest.fn()
  render(<PublishArtifactDialog artifact={artifact as never} onClose={onClose} />)
  agree()
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  await waitFor(() => expect(posted.length).toBeGreaterThan(0))
}

describe('every kind the console can hand over', () => {
  it.each([
    [
      'layout',
      { kind: 'layout', hostId: 'host-1', artifactId: 'layout-1', displayName: 'Docs' },
      'marketplace/publish-layout',
      { hostId: 'host-1', layoutId: 'layout-1' },
    ],
    [
      'component',
      { kind: 'component', hostId: 'host-1', artifactId: 'component-1', displayName: 'Hero' },
      'marketplace/publish',
      { hostId: 'host-1', componentId: 'component-1' },
    ],
    [
      'site template',
      { kind: 'site', hostId: 'host-1', displayName: 'Acme' },
      'marketplace/publish-template',
      { hostId: 'host-1' },
    ],
    [
      'theme',
      { kind: 'theme', hostId: 'host-1', displayName: 'Acme theme' },
      'marketplace/publish-theme',
      { hostId: 'host-1' },
    ],
    [
      // Org-scoped, which is the one kind that does NOT travel on a hostId.
      'dataset schema',
      { kind: 'datasetSchema', orgId: 'org-1', artifactId: 'dataset-1', displayName: 'Leads' },
      'marketplace/publish-dataset-schema',
      { orgId: 'org-1', datasetId: 'dataset-1' },
    ],
    [
      'email template',
      { kind: 'emailTemplate', hostId: 'host-1', artifactId: 'welcome', displayName: 'Welcome' },
      'marketplace/publish-email-template',
      { hostId: 'host-1', templateKey: 'welcome' },
    ],
    [
      'email starter',
      { kind: 'emailStarter', hostId: 'host-1', artifactId: 'screen-1', displayName: 'Launch' },
      'marketplace/publish-email-starter',
      { hostId: 'host-1', screenId: 'screen-1' },
    ],
  ])(
    'sends a %s to its own route, with the fields that route reads',
    async (_label, artifact, endpoint, payload) => {
      await publish(artifact)
      expect(posted).toHaveLength(1)
      expect(posted[0].url).toBe(`/api/${endpoint}`)
      expect(posted[0].body).toMatchObject(payload)
      // The name the person left in the field, never the seed by itself: the
      // seed is editable and the listing is named by what they typed.
      expect(posted[0].body['displayName']).toBe(artifact['displayName'])
    },
  )

  it('seeds the name from the artifact and sends what the person typed instead', async () => {
    const onClose = jest.fn()
    render(
      <PublishArtifactDialog
        artifact={{ kind: 'layout', hostId: 'h', artifactId: 'l', displayName: 'Docs' } as never}
        onClose={onClose}
      />,
    )
    const name = screen.getByLabelText('Listing name') as HTMLInputElement
    expect(name.value).toBe('Docs')
    fireEvent.change(name, { target: { value: 'Docs, rebuilt' } })
    agree()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].body['displayName']).toBe('Docs, rebuilt')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

describe('a kind this marketplace does not sell', () => {
  /**
   * The console and this map going out of step is the failure mode of the
   * seam itself, and the person has already clicked by the time it shows. A
   * dialog that drew nothing would look like a broken control with nothing
   * to read; this says what happened and changes nothing.
   */
  it('says so rather than drawing nothing, and posts nothing', () => {
    render(
      <PublishArtifactDialog
        artifact={{ kind: 'spaceship', hostId: 'host-1' } as never}
        onClose={jest.fn()}
      />,
    )
    expect(screen.getByText(/does not publish a spaceship/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(posted).toHaveLength(0)
  })

  it('draws nothing at all while the page has nothing open', () => {
    render(<PublishArtifactDialog artifact={null} onClose={jest.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('what the server says is what the publisher reads', () => {
  it('reports a missing setup step as a warning, not an error', async () => {
    // 412 means a publisher profile or payouts are missing — actionable, and
    // the route's own words for it, never a sentence guessed here.
    responseStatus = 412
    responseBody = { error: 'Set up payouts before publishing a paid listing' }
    await publish({ kind: 'layout', hostId: 'h', artifactId: 'l', displayName: 'Docs' })
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'Set up payouts before publishing a paid listing',
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
  })
})

/**
 * THE PUBLISHER AGREEMENT, AGREED TO ON EVERY PUBLISH (AGL-4105).
 *
 * Every kind above is published through this one form, so wiring it once
 * wires the seven: the box sits above Publish, unticked, Publish waits for
 * it, the publish carries it, and it is unticked again for the next one.
 */
describe('the publisher agreement', () => {
  const artifact = { kind: 'layout', hostId: 'h', orgId: 'org-1', artifactId: 'l', displayName: 'Docs' }

  it('starts unticked, and Publish waits for it', () => {
    render(<PublishArtifactDialog artifact={artifact as never} onClose={jest.fn()} />)
    const box = screen.getByRole('checkbox', { name: `Agree to the ${PUBLISHER_AGREEMENT_TITLE}` }) as HTMLInputElement
    expect(box.checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(posted).toHaveLength(0)
    agree()
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('links the agreement from its title', () => {
    render(<PublishArtifactDialog artifact={artifact as never} onClose={jest.fn()} />)
    const link = screen.getByRole('link', { name: PUBLISHER_AGREEMENT_TITLE }) as HTMLAnchorElement
    expect(link.href).toMatch(/\/legal\/marketplace-publisher-agreement$/)
  })

  it.each(['layout', 'component', 'site', 'theme', 'emailTemplate', 'emailStarter', 'datasetSchema'])(
    'a %s publish carries the version it agreed to',
    async (kind) => {
      await publish({ kind, hostId: 'host-1', orgId: 'org-1', artifactId: 'a-1', displayName: 'Named' })
      expect(posted[0].body['agreement']).toEqual({ version: PUBLISHER_AGREEMENT_VERSION, accepted: true })
    },
  )

  it('is unticked again for the next artifact the dialog opens on', async () => {
    const onClose = jest.fn()
    const { rerender } = render(<PublishArtifactDialog artifact={artifact as never} onClose={onClose} />)
    agree()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    rerender(
      <PublishArtifactDialog artifact={{ ...artifact, artifactId: 'l2', displayName: 'Next' } as never} onClose={onClose} />,
    )
    const box = screen.getByRole('checkbox', { name: `Agree to the ${PUBLISHER_AGREEMENT_TITLE}` }) as HTMLInputElement
    expect(box.checked).toBe(false)
  })
})
