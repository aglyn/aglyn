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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CampaignDesignCreateWidget } from './campaign-design-create-widget'
import { CampaignTopicSelect } from './campaign-topic-select'
import { EmailDesignPreview } from './email-design-preview'

/**
 * WHAT THIS PLUGIN DRAWS INSIDE A CAMPAIGN'S PAGES.
 *
 * The composer and a message's page belong to the plugin that owns campaigns;
 * the topic catalog, the design document and its renderer are this one's, and
 * are drawn there as widgets. The host's specs hold what it hands each zone.
 * These hold the half that is this plugin's: that the picker settles on a real
 * topic, what a minted design is, and what the preview draws.
 */
const mockCreateResource = jest.fn(async (_input?: unknown) => ({ id: 'new' }))
const mockCreateVersion = jest.fn(async () => ({ id: 'v1' }))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHostResourceApi: () => mockCreateResource,
  useHostVersionApi: () => mockCreateVersion,
  // The preview reads the components a design places (AGL-3287); nothing in
  // this file places one, so the handle is never used.
  useFirestore: () => ({}),
}))

jest.mock('./use-org-email-topics', () => ({
  useOrgEmailTopics: () => ({
    topics: [
      { id: 'sales', name: 'Sales outreach' },
      { id: 'marketing', name: 'Promotions and offers' },
      { id: 'retired', name: 'Old stream', archived: true },
    ],
  }),
}))

beforeEach(() => {
  mockCreateResource.mockClear()
  mockCreateVersion.mockClear()
})

describe('the topic picker', () => {
  it('settles an empty field on the org default, not on the first row', () => {
    // A select that reads blank while the server has already decided is a
    // field that lies; and the default is the stream, not whichever sorts
    // first.
    const onChange = jest.fn()
    render(<CampaignTopicSelect hostId="host-1" value="" onChange={onChange} />)
    expect(onChange).toHaveBeenCalledWith('marketing')
  })

  it('moves a campaign off a topic that has been retired', () => {
    const onChange = jest.fn()
    render(
      <CampaignTopicSelect hostId="host-1" value="retired" onChange={onChange} />,
    )
    expect(onChange).toHaveBeenCalledWith('marketing')
  })

  it('THE CONTROL: leaves a live choice alone', () => {
    const onChange = jest.fn()
    render(
      <CampaignTopicSelect hostId="host-1" value="sales" onChange={onChange} />,
    )
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('a design for one email', () => {
  it('mints an email screen named after the email, and says which', async () => {
    const onCreated = jest.fn()
    render(
      <CampaignDesignCreateWidget
        hostId="host-1"
        name="August newsletter"
        onCreated={onCreated}
        onError={() => undefined}
      />,
    )
    fireEvent.click(screen.getByText('Design this email'))

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    const created = mockCreateResource.mock.calls[0][0] as any
    expect(created.data.kind).toBe('email')
    // The name is the only thing that tells one design from another in the
    // picker; a list of identical "Untitled email" rows tells nobody anything.
    expect(created.data.displayName).toBe('August newsletter')
    expect(onCreated.mock.calls[0][0].screenId).toBe(created.id)
  })

  it('hands a failure to the host rather than swallowing it', async () => {
    mockCreateResource.mockRejectedValueOnce(new Error('quota'))
    const onError = jest.fn()
    const onCreated = jest.fn()
    render(
      <CampaignDesignCreateWidget
        hostId="host-1"
        onCreated={onCreated}
        onError={onError}
      />,
    )
    fireEvent.click(screen.getByText('Design this email'))

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onCreated).not.toHaveBeenCalled()
  })
})

describe('a message written as plain text still previews', () => {
  const frame = () =>
    document.querySelector('iframe[title="Email preview"]') as
      | HTMLIFrameElement
      | null

  it('draws the synthesized HTML the send path mails, fully sandboxed', () => {
    // A plain-text message is not previewless: the send path synthesizes an
    // HTML part for it, and that part is what the inbox received.
    render(
      <EmailDesignPreview
        hostId="host-1"
        nodes={undefined}
        text="Hello from the composer."
        subject="Spring sale"
        emptyMessage="Nothing to draw."
      />,
    )
    expect(frame()?.getAttribute('sandbox')).toBe('')
    expect(frame()?.getAttribute('srcdoc')).toContain('Hello from the composer.')
  })

  it('has nothing to draw only when there is no body either', () => {
    // The control. A frame drawn for an empty body would be an empty frame
    // presented as the mail, which is worse than saying so.
    render(
      <EmailDesignPreview
        hostId="host-1"
        nodes={undefined}
        text=""
        emptyMessage="This email carries no body."
      />,
    )
    expect(frame()).toBeNull()
    expect(screen.getByText(/carries no body/i)).toBeTruthy()
  })
})
