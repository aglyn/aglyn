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
 * The theme assistant on the Theme section (AGL-2938), mounted through its
 * zone's props with the editor's preview stood in by a probe: it stays absent
 * while the route says the feature does not exist, it previews a proposal
 * before and after, and applying hands the AFTER theme to `proposeDraft` —
 * it never writes a theme itself.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { HostTheme, HostThemeScheme } from '@aglyn/shared-data-types'
import type { ReactNode } from 'react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header?: ReactNode; children: ReactNode }) => (
    <section aria-label={typeof header === 'string' ? header : undefined}>{children}</section>
  ),
}))

import { readThemeColor } from '@aglyn/shared-ui-theme/util/theme-editor-fields'
import { buildAiThemeProposal } from '../model/ai-theme-proposal'
import AiThemeProposalCard from './ai-theme-proposal-card.component'

const theme: HostTheme = {
  colorSchemes: {
    light: {
      primary: { main: '#1565c0' },
      background: { default: '#ffffff', paper: '#ffffff' },
      text: { primary: '#111111' },
    },
    dark: {
      primary: { main: '#90caf9' },
      background: { default: '#121212', paper: '#1e1e1e' },
      text: { primary: '#f5f5f5' },
    },
  },
}

const proposal = buildAiThemeProposal({
  base: theme,
  source: 'custom',
  mode: 'modify',
  brief: 'Make it feel warmer.',
  summary: 'Warmer accents.',
  changes: [
    { control: 'color.primary', scheme: 'light', value: '#c2410c' },
    { control: 'color.primary', scheme: 'dark', value: '#fdba74' },
  ],
  components: [],
  resetComponents: false,
})

const themeJob = (patch: Record<string, unknown> = {}) => ({
  id: 'job-1',
  orgId: 'org-1',
  hostId: 'host-1',
  kind: 'theme',
  status: 'done',
  brief: 'Make it feel warmer.',
  steps: [],
  outputs: [
    {
      resource: 'theme',
      id: 'proposal',
      hostId: 'host-1',
      hostSubdomain: 'shop',
      label: 'Theme proposal · 2 changes',
      proposal: JSON.parse(JSON.stringify(proposal)),
    },
  ],
  creditsReserved: 0,
  creditsSpent: 12,
  createdBy: 'u1',
  createdAt: '2026-09-15T12:00:00.000Z',
  updatedAt: '2026-09-15T12:00:05.000Z',
  error: null,
  running: false,
  ...patch,
})

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
})

/** What the zone hands the card; the preview names the primary it renders. */
function Preview({ theme: shown, scheme }: { theme: HostTheme; scheme: HostThemeScheme }) {
  return <output data-scheme={scheme}>{readThemeColor(shown, scheme, 'primary')}</output>
}

let mockFetch: jest.Mock
const proposeDraft = jest.fn()

function renderCard() {
  return render(
    <AiThemeProposalCard
      hostId="host-1"
      orgId="org-1"
      orgSlug="acme"
      host="shop"
      theme={theme}
      themeSource="custom"
      ThemePreview={Preview}
      proposeDraft={proposeDraft}
    />,
  )
}

beforeEach(() => {
  proposeDraft.mockReset()
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
})

describe('whether the card is here', () => {
  it('stays absent while the route says the feature does not exist', async () => {
    mockFetch.mockResolvedValue(json({ error: 'Not found' }, 404))
    const { container } = renderCard()
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(String(mockFetch.mock.calls[0][0])).toBe('/api/ai/jobs?orgId=org-1&limit=20')
    expect(container.textContent).toBe('')
  })
})

describe('a proposal, before and after', () => {
  it('lists this site’s recent proposals, previews one, and puts the AFTER theme in the editor', async () => {
    mockFetch.mockResolvedValue(
      json({
        jobs: [
          themeJob(),
          themeJob({ id: 'job-other-site', hostId: 'host-2', brief: 'Another site entirely.' }),
          themeJob({ id: 'job-text', kind: 'text', brief: 'A tagline.', outputs: [] }),
        ],
      }),
    )
    const { container } = renderCard()
    expect(await screen.findByText('Recent proposals for this site')).toBeTruthy()
    expect(screen.queryByText('Another site entirely.')).toBeNull()
    expect(screen.queryByText('A tagline.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByText('Warmer accents.')).toBeTruthy()
    const changes = screen.getByRole('table', { name: 'Proposed changes' })
    // A swatch's value is an unbreakable token, so the table scrolls sideways
    // inside the card rather than past its edge (AGL-3045).
    expect(getComputedStyle(changes.parentElement as HTMLElement).overflowX).toBe('auto')
    const rows = within(changes).getAllByRole('row')
    expect(rows.map((row) => row.textContent)).toEqual([
      'ControlNowProposed',
      'Primarylight#1565c0#c2410c',
      'Primarydark#90caf9#fdba74',
    ])

    const shown = (which: string) =>
      container.querySelector(`[data-preview="${which}"] output`)?.textContent
    expect([shown('before'), shown('after')]).toEqual(['#1565c0', '#c2410c'])
    fireEvent.click(screen.getByRole('tab', { name: 'Dark' }))
    expect([shown('before'), shown('after')]).toEqual(['#90caf9', '#fdba74'])

    fireEvent.click(screen.getByRole('button', { name: 'Put in the editor' }))
    expect(proposeDraft).toHaveBeenCalledTimes(1)
    const [applied, key] = proposeDraft.mock.calls[0]
    expect(key).toBe('job-1')
    expect(readThemeColor(applied, 'light', 'primary')).toBe('#c2410c')
    expect(readThemeColor(applied, 'dark', 'primary')).toBe('#fdba74')
    // Everything the proposal does not name is the theme as it was.
    expect(applied.colorSchemes.light.background).toEqual(theme.colorSchemes?.light?.background)
    expect(screen.getByText(/In the editor below as unsaved changes/)).toBeTruthy()
    // The card itself wrote nothing: two reads, no write.
    expect(mockFetch.mock.calls.every((call) => !call[1]?.method || call[1].method === 'GET')).toBe(true)
  })

  it('posts a brief as a theme job for this site, and shows the proposal the route answered with', async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ job: themeJob() })
      return json({ jobs: [] })
    })
    renderCard()
    const brief = await screen.findByRole('textbox', { name: 'Describe the change' })
    fireEvent.click(screen.getByRole('button', { name: 'Design a new theme' }))
    fireEvent.change(brief, { target: { value: 'Make it feel warmer.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Propose changes' }))
    expect(await screen.findByText('Warmer accents.')).toBeTruthy()
    const post = mockFetch.mock.calls.find((call) => call[1]?.method === 'POST')
    expect(post?.[0]).toBe('/api/ai/jobs')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'theme',
      brief: 'Make it feel warmer.',
      inputs: { mode: 'create' },
    })
  })

  it('says why a job produced no proposal', async () => {
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return json({
          job: themeJob({
            status: 'failed',
            outputs: [],
            error: 'The AI could not produce a theme proposal from this brief.',
          }),
        })
      }
      return json({ jobs: [] })
    })
    renderCard()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Describe the change' }), {
      target: { value: 'Something.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Propose changes' }))
    expect(
      await screen.findByText('The AI could not produce a theme proposal from this brief.'),
    ).toBeTruthy()
    expect(proposeDraft).not.toHaveBeenCalled()
  })
})
