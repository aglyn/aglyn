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

import { MARKETPLACE_COMPONENT_ID_ALLOWLIST } from '@aglyn/aglyn/app-utils/node-definition-sanitizer'
import type { AiCompletion, AiUsage } from '../providers/contract'
import { AI_ACCEPTABLE_USE_BLOCK, validateAiSystemBlocks } from '../runtime/ai-runtime'
import {
  ASSIST_SECTION_TOOL_NAME,
  assistModeSystemBlocks,
  assistSectionTool,
  readAssistSection,
  type AiAssistMode,
} from './ai-assist-prompts'

/**
 * The copy assistant's prompts and its section tool (AGL-2937).
 *
 * The prompts are static and the tool is strict, so both can be read without
 * the route's Firestore, ID token or provider — which is the point of them
 * living in their own module. What is asserted here: the acceptable-use rules
 * ride at every mode and carry no per-workspace byte; a section arrives as
 * validated tool arguments; and the text parse the tool replaced still reads
 * the answers it used to, so a provider without tools is not refused.
 */

const USAGE: AiUsage = {
  inputTokens: 10,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

const completion = (over: Partial<AiCompletion>): AiCompletion => ({
  kind: 'completion',
  text: '',
  toolUse: [],
  usage: USAGE,
  estCostUsd: 0,
  stopReason: 'tool_use',
  ...over,
})

const MODES: AiAssistMode[] = ['element', 'blog', 'section']

describe('the mode prompts', () => {
  it.each(MODES)('%s carries the acceptable-use rules once, in one cached block', (mode) => {
    const blocks = assistModeSystemBlocks(mode)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].cacheBreakpoint).toBe(true)
    expect(blocks[0].volatile).toBeUndefined()
    expect(blocks[0].text.startsWith(AI_ACCEPTABLE_USE_BLOCK)).toBe(true)
    expect(() => validateAiSystemBlocks(blocks)).not.toThrow()
  })

  it('is the same bytes for every workspace, so nothing per-org can reach the prefix', () => {
    for (const mode of MODES) {
      expect(assistModeSystemBlocks(mode)[0].text).toBe(assistModeSystemBlocks(mode)[0].text)
    }
    // Three modes, three distinct prompts: a mode is not silently served
    // another mode's rules.
    expect(new Set(MODES.map((mode) => assistModeSystemBlocks(mode)[0].text)).size).toBe(3)
  })

  it('names the tool the section mode is told to answer through', () => {
    expect(assistModeSystemBlocks('section')[0].text).toContain(ASSIST_SECTION_TOOL_NAME)
    for (const mode of ['element', 'blog'] as const) {
      expect(assistModeSystemBlocks(mode)[0].text).not.toContain(ASSIST_SECTION_TOOL_NAME)
    }
  })
})

describe('the section tool', () => {
  it('is strict, and offers only the components a marketplace install may carry', () => {
    const tool = assistSectionTool()
    expect(tool.strict).toBe(true)
    expect(tool.name).toBe(ASSIST_SECTION_TOOL_NAME)
    const node = (tool.inputSchema as any).properties.nodes.items
    expect(node.additionalProperties).toBe(false)
    expect(node.required).toEqual(['id', 'componentId', 'parentId', 'children', 'props'])
    // The schema refuses an unpublishable component before the sanitizer has
    // to, which saves the re-ask rather than the rejection.
    expect(node.properties.componentId.enum).toEqual([...MARKETPLACE_COMPONENT_ID_ALLOWLIST])
  })
})

describe('reading a section answer', () => {
  const nodes = [
    {
      id: 'n1',
      componentId: 'muiStack',
      parentId: '',
      children: ['n2', 'n3'],
      props: [
        { name: 'direction', value: 'column' },
        { name: 'spacing', value: '2' },
      ],
    },
    {
      id: 'n2',
      componentId: 'muiTypography',
      parentId: 'n1',
      children: [],
      props: [
        { name: 'children', value: 'Storm damage?' },
        { name: 'variant', value: 'h2' },
      ],
    },
    {
      id: 'n3',
      componentId: 'muiButton',
      parentId: 'n1',
      children: [],
      props: [{ name: 'children', value: 'Book an inspection' }],
    },
  ]

  it('takes the tool call, rebuilding the map the besigner already reads', () => {
    const read = readAssistSection(
      completion({ toolUse: [{ name: ASSIST_SECTION_TOOL_NAME, input: { nodes } }] }),
    )
    expect(read.status).toBe('ok')
    if (read.status !== 'ok') return
    expect(read.section.rootId).toBe('n1')
    expect(Object.keys(read.section.nodes).sort()).toEqual(['n1', 'n2', 'n3'])
    expect(read.section.nodes['n1']).toMatchObject({
      $id: 'n1',
      componentId: 'muiStack',
      parentId: null,
      nodes: ['n2', 'n3'],
    })
    // Copy stays copy, whatever it looks like: `children` is never read as a
    // number even when a heading is one.
    expect((read.section.nodes['n2'] as any).props.children).toBe('Storm damage?')
  })

  it('drops a child id the answer never declared, rather than leaving a dangling reference', () => {
    const read = readAssistSection(
      completion({
        toolUse: [
          {
            name: ASSIST_SECTION_TOOL_NAME,
            input: {
              nodes: [{ ...nodes[0], children: ['n2', 'ghost'] }, nodes[1]],
            },
          },
        ],
      }),
    )
    expect(read.status).toBe('ok')
    if (read.status !== 'ok') return
    expect((read.section.nodes['n1'] as any).nodes).toEqual(['n2'])
  })

  it('still reads the bare JSON the tool replaced, for a provider with no tools', () => {
    const read = readAssistSection(
      completion({
        stopReason: 'end_turn',
        text:
          '```json\n' +
          JSON.stringify({
            rootId: 'n1',
            nodes: {
              n1: { $id: 'n1', componentId: 'muiStack', parentId: null, props: {}, nodes: ['n2'] },
              n2: {
                $id: 'n2',
                componentId: 'muiTypography',
                parentId: 'n1',
                props: { children: 'Hello' },
                nodes: [],
              },
            },
          }) +
          '\n```',
      }),
    )
    expect(read.status).toBe('ok')
    if (read.status !== 'ok') return
    expect(read.section.rootId).toBe('n1')
  })

  it('separates an answer nothing could be read out of from one the sanitizer refused', () => {
    expect(readAssistSection(completion({ stopReason: 'end_turn', text: 'no json here' }))).toEqual({
      status: 'unreadable',
      error: 'AI returned invalid JSON',
    })
    const rejected = readAssistSection(
      completion({
        toolUse: [
          {
            name: ASSIST_SECTION_TOOL_NAME,
            input: { nodes: [{ ...nodes[0], id: '' }] },
          },
        ],
      }),
    )
    // An empty id cannot be a node, so the call reads as no call at all and
    // the empty text behind it is unreadable.
    expect(rejected.status).toBe('unreadable')
  })

  it('reads a refusal as unreadable rather than throwing: the tokens were spent either way', () => {
    const read = readAssistSection({
      kind: 'refusal',
      text: '',
      usage: USAGE,
      estCostUsd: 0,
      stopReason: 'refusal',
    })
    expect(read.status).toBe('unreadable')
  })
})
