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
 * The theme step (AGL-2938), driven with the provider faked at the runtime's
 * `runAiRequest` seam and the brand reads faked at their module: what the
 * model is sent, how its answer becomes a proposal, and what the machine is
 * handed back to meter.
 */

const mockRunAiRequest = jest.fn()
const mockGatherBrand = jest.fn()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('./ai-theme-brand-inputs', () => ({
  __esModule: true,
  ...jest.requireActual('./ai-theme-brand-inputs'),
  gatherAiThemeBrandInputs: (...args: unknown[]) => mockGatherBrand(...args),
}))

import type { HostTheme } from '@aglyn/shared-data-types'
import type { AiJob } from '../model/ai-jobs.types'
import { readAiThemeProposal } from '../model/ai-theme-proposal'
import { AI_MODEL_CATALOG } from '../providers/catalog'
import { aiModelForStep } from '../providers/routing'
import {
  AI_THEME_COLOR_CONTROLS,
  AI_THEME_SUMMARY_MAX_CHARS,
  AI_THEME_TOOL_MAX_COMPONENT_LEAVES,
  AI_THEME_TOOL_NAME,
  parseAiThemeToolInput,
} from '../tools/ai-theme-tool'
import {
  AI_JOB_THEME_INVENTORY_LEAVES,
  AI_JOB_THEME_MAX_TOKENS,
  AI_JOB_THEME_NO_ANSWER_COPY,
  AI_JOB_THEME_NO_SITE_COPY,
  aiJobThemeInventory,
  runAiJobThemeStep,
} from './ai-job-theme-step'

const ORG = 'org-1'
const USAGE = { inputTokens: 2_000, outputTokens: 400, cacheReadTokens: 1_500, cacheWriteTokens: 0 }

const siteTheme = (): HostTheme => ({
  colorSchemes: {
    light: {
      primary: { main: '#1565c0' },
      background: { default: '#ffffff', paper: '#ffffff' },
      text: { primary: '#111111', secondary: '#4a4a4a' },
    },
    dark: {
      primary: { main: '#90caf9' },
      background: { default: '#121212', paper: '#1e1e1e' },
      text: { primary: '#f5f5f5', secondary: '#bdbdbd' },
    },
  },
  shape: { borderRadius: 8 },
})

let hostDoc: Record<string, unknown> | null

const firestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      get: async () => ({
        exists: name === 'hosts' && id === 'host-1' && hostDoc !== null,
        data: () => hostDoc,
      }),
    }),
  }),
} as unknown as FirebaseFirestore.Firestore

const job = (patch: Partial<AiJob> = {}): AiJob =>
  ({
    $id: 'job-1',
    orgId: ORG,
    hostId: 'host-1',
    kind: 'theme',
    status: 'running',
    brief: 'Make it feel warmer.',
    inputs: {},
    steps: [],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'uid-1',
    ...patch,
  }) as AiJob

const answer = (input: Record<string, unknown> | null, text = '') => ({
  kind: 'completion',
  text,
  toolUse: input ? [{ name: AI_THEME_TOOL_NAME, input }] : [],
  usage: USAGE,
  estCostUsd: 0.012,
  stopReason: input ? 'tool_use' : 'end_turn',
})

const warmer = {
  summary: 'Warmer accents.',
  colors: [{ token: 'primary', light: '#c2410c', dark: '#fdba74' }],
  darkScheme: null,
  fontFamily: 'Lora',
  borderRadius: null,
  spacing: null,
  navHeightMobile: null,
  navHeightDesktop: null,
  componentOverrides: [],
  resetComponentOverrides: false,
}

const run = (patch: Partial<AiJob> = {}) =>
  runAiJobThemeStep({
    job: job(patch),
    stepIndex: 0,
    now: new Date('2026-09-15T12:00:00.000Z'),
    firestore,
    org: { plan: 'pro' } as never,
  })

beforeEach(() => {
  hostDoc = { orgId: ORG, subdomain: 'shop', theme: siteTheme() }
  mockRunAiRequest.mockReset()
  mockGatherBrand.mockReset()
  mockGatherBrand.mockResolvedValue({
    colors: [{ hex: '#0f766e', source: 'organization' }],
    notes: [],
  })
})

describe('the request', () => {
  it('asks through the strict tool, with the rules cached and the site in the user turn', async () => {
    mockRunAiRequest.mockResolvedValue(answer(warmer))
    await run()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    const request = mockRunAiRequest.mock.calls[0][0]
    expect(request).toMatchObject({
      model: aiModelForStep('job.theme'),
      maxTokens: AI_JOB_THEME_MAX_TOKENS,
      thinking: 'adaptive',
      stream: false,
    })
    expect(request.tools.map((tool: { name: string; strict: boolean }) => [tool.name, tool.strict])).toEqual([
      [AI_THEME_TOOL_NAME, true],
    ])
    const system = request.system as Array<{ text: string; cacheBreakpoint?: true }>
    // The shared acceptable-use block, then the theme's own rules, cached as one prefix.
    expect(system[0].text).toContain('Acceptable use')
    expect(system[system.length - 1].cacheBreakpoint).toBe(true)
    // No byte of this site sits inside the cached prefix.
    for (const block of system) {
      for (const siteByte of ['warmer', '#0f766e', 'shop', '#1565c0']) {
        expect(block.text).not.toContain(siteByte)
      }
    }
    const prompt = request.messages[0].content as string
    expect(prompt).toContain('Mode: modify.')
    expect(prompt).toContain('- primary: #1565c0 (set) | #90caf9 (set)')
    expect(prompt).toContain('- #0f766e (the workspace brand color)')
    expect(prompt).toContain('Brief: Make it feel warmer.')
    expect(mockGatherBrand).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: 'host-1', brief: 'Make it feel warmer.', host: hostDoc }),
    )
  })

  it('runs on the model the machine resolves for job.theme, and reports that model', async () => {
    mockRunAiRequest.mockResolvedValue(answer(warmer))
    const routed = aiModelForStep('job.theme')
    const picked = AI_MODEL_CATALOG.find((entry) => entry.id !== routed)?.id
    if (!picked) throw new Error('the catalog lists one model')
    const modelFor = jest.fn(() => picked)
    const outcome = await runAiJobThemeStep({
      job: job(),
      stepIndex: 0,
      now: new Date('2026-09-15T12:00:00.000Z'),
      firestore,
      org: { plan: 'pro' } as never,
      modelFor,
    })
    expect(modelFor).toHaveBeenCalledWith('job.theme')
    expect(mockRunAiRequest.mock.calls[0][0].model).toBe(picked)
    expect(outcome.model).toBe(picked)
  })

  it('reads create mode from the job’s inputs', async () => {
    mockRunAiRequest.mockResolvedValue(answer(warmer))
    await run({ inputs: { mode: 'create' } })
    expect(mockRunAiRequest.mock.calls[0][0].messages[0].content).toContain('Mode: create.')
  })

  it('lists the site’s component overrides as leaves, and stops at the cap', () => {
    const components: HostTheme['components'] = {}
    for (let index = 0; index < AI_JOB_THEME_INVENTORY_LEAVES + 3; index += 1) {
      components[`MuiButton`] = {
        ...components['MuiButton'],
        defaultProps: { ...components['MuiButton']?.defaultProps, [`prop${index}`]: true },
      }
    }
    const inventory = aiJobThemeInventory({ ...siteTheme(), components }, 'custom')
    expect(inventory).toContain('- MuiButton default prop0 = true')
    expect(inventory).toContain('- and 3 more')
    expect(inventory).toContain('Border radius: 8 (set)')
    expect(inventory).toContain('Spacing unit: 8 (default)')
  })
})

describe('the outcome', () => {
  it('hands back one theme proposal, a targeted diff, with what the model spent', async () => {
    mockRunAiRequest.mockResolvedValue(answer(warmer))
    const outcome = await run()
    expect(outcome).toMatchObject({
      usage: USAGE,
      estCostUsd: 0.012,
      stopReason: 'tool_use',
      model: aiModelForStep('job.theme'),
    })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.outputs).toHaveLength(1)
    const [output] = outcome.outputs
    expect(output).toMatchObject({
      resource: 'theme',
      id: 'proposal',
      hostId: 'host-1',
      hostSubdomain: 'shop',
      label: 'Theme proposal · 2 changes',
    })
    const proposal = readAiThemeProposal(output.proposal)
    expect(proposal).toMatchObject({ source: 'custom', mode: 'modify', summary: 'Warmer accents.' })
    // "Warmer" is about color: the font the model also proposed is left out.
    expect(proposal?.changes.map((change) => [change.control, change.scheme, change.value])).toEqual([
      ['color.primary', 'light', '#c2410c'],
      ['color.primary', 'dark', '#fdba74'],
    ])
    expect(proposal?.dropped).toEqual(['fontFamily: the brief did not ask about typography'])
    // What reaches the job document carries no `undefined`.
    expect(JSON.stringify(output.proposal)).toBe(JSON.stringify(JSON.parse(JSON.stringify(output.proposal))))
  })

  it('refuses a site of another org before anything reaches the model, spending nothing', async () => {
    hostDoc = { orgId: 'org-2', subdomain: 'theirs', theme: siteTheme() }
    const outcome = await run()
    expect(outcome).toMatchObject({
      outputs: [],
      failure: AI_JOB_THEME_NO_SITE_COPY,
      estCostUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(mockGatherBrand).not.toHaveBeenCalled()
  })

  it('refuses a job that names no site, or a site that does not exist', async () => {
    expect((await run({ hostId: null })).failure).toBe(AI_JOB_THEME_NO_SITE_COPY)
    hostDoc = null
    expect((await run()).failure).toBe(AI_JOB_THEME_NO_SITE_COPY)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('passes a model refusal on as a refusal', async () => {
    mockRunAiRequest.mockResolvedValue({
      kind: 'refusal',
      text: '',
      usage: USAGE,
      estCostUsd: 0.004,
      stopReason: 'refusal',
    })
    expect(await run()).toMatchObject({ refused: true, outputs: [], estCostUsd: 0.004 })
  })
})

describe('the one re-ask', () => {
  it('asks again once when the model answered in prose, and sums what both calls spent', async () => {
    mockRunAiRequest.mockResolvedValueOnce(answer(null, 'Here is a warmer palette…'))
    mockRunAiRequest.mockResolvedValueOnce(answer(warmer))
    const outcome = await run()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(mockRunAiRequest.mock.calls[1][0].messages[0].content).toContain(
      `Your last reply did not call ${AI_THEME_TOOL_NAME}.`,
    )
    expect(outcome.outputs).toHaveLength(1)
    expect(outcome.usage).toEqual({
      inputTokens: 4_000,
      outputTokens: 800,
      cacheReadTokens: 3_000,
      cacheWriteTokens: 0,
    })
    expect(outcome.estCostUsd).toBe(0.024)
  })

  it('names only what was refused when nothing proposed could be used', async () => {
    mockRunAiRequest.mockResolvedValueOnce(
      answer({ ...warmer, fontFamily: null, colors: [{ token: 'primary', light: 'warm orange', dark: null }] }),
    )
    mockRunAiRequest.mockResolvedValueOnce(answer(warmer))
    const outcome = await run()
    const reask = mockRunAiRequest.mock.calls[1][0].messages[0].content as string
    expect(reask).toContain('- color.primary (light): "warm orange" is not a hex color')
    expect(reask).not.toContain('Your last reply did not call')
    expect(outcome.outputs).toHaveLength(1)
  })

  it('fails with its own sentence when neither answer can be used, and still reports the spend', async () => {
    mockRunAiRequest.mockResolvedValue(answer(null, 'I cannot help with that theme.'))
    const outcome = await run()
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(outcome).toMatchObject({ outputs: [], failure: AI_JOB_THEME_NO_ANSWER_COPY, estCostUsd: 0.024 })
  })
})

describe('a measured budget', () => {
  it('fits the largest answer the tool accepts with as much again to think in', () => {
    const largest = {
      summary: 'x'.repeat(AI_THEME_SUMMARY_MAX_CHARS),
      colors: AI_THEME_COLOR_CONTROLS.map((control) => ({
        token: control.token,
        light: '#aabbcc',
        dark: '#ddeeff',
      })),
      darkScheme: 'auto',
      fontFamily: 'Playfair Display',
      borderRadius: 24,
      spacing: 16,
      navHeightMobile: 160,
      navHeightDesktop: 160,
      componentOverrides: Array.from({ length: AI_THEME_TOOL_MAX_COMPONENT_LEAVES }, () => ({
        component: 'MuiCircularProgress',
        target: 'styleOverrides',
        slot: 'circleDeterminate',
        property: 'gridTemplateColumns',
        media: 'desktop',
        value: 'repeat(3, minmax(0, 1fr))',
      })),
      resetComponentOverrides: true,
    }
    const parsed = parseAiThemeToolInput(largest)
    expect(parsed.dropped).toEqual([])
    expect(parsed.components).toHaveLength(AI_THEME_TOOL_MAX_COMPONENT_LEAVES)
    // JSON runs well over three characters a token; three errs toward more tokens.
    const tokens = Math.ceil(JSON.stringify(largest).length / 3)
    expect(tokens * 2).toBeLessThanOrEqual(AI_JOB_THEME_MAX_TOKENS)
  })
})
