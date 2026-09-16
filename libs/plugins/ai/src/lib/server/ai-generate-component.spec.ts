/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * Saving a section as a reusable component with AI (AGL-2908), server half,
 * against a recorded answer — no spec here calls a live provider.
 *
 *  - A CLOSED WORLD. A binding names an element the outline described, inside
 *    the selection. Anything else is refused, never guessed at.
 *  - THE BINDING RULES ARE THE FROM-BRIEF STEP'S, read from the same module,
 *    so the two entry points cannot disagree about which property fits which
 *    field.
 *  - REFUSED BEFORE SPEND. A selection that is the document, that carries the
 *    main landmark or a second top-level heading, or that the outline does
 *    not describe whole, is refused before a model runs.
 *  - REFERENCES, NEVER A DOCUMENT. The answer carries no defaults and no
 *    tree: the client reads the values off the canvas as it applies.
 */

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AssistEditCanvasContext } from '../model/assist-edit'
import {
  aiComponentSelectionIds,
  aiComponentSelectionOp,
  aiComponentSelectionPrompt,
  aiComponentSelectionRefusal,
  aiComponentSelectionTool,
  AI_COMPONENT_SELECTION_INSTRUCTIONS,
  AI_COMPONENT_SELECTION_MAX_TOKENS,
  AI_COMPONENT_SELECTION_TOOL_NAME,
  checkAiComponentSelection,
} from './ai-generate-component'
import { AI_COMPONENT_PROP_KINDS } from '../tools/ai-component-tool'

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, '..', 'jobs', 'goldens', 'component-from-selection.json'), 'utf8'),
) as {
  canvas: AssistEditCanvasContext
  name: string
  answer: Record<string, unknown>
}

const context = (): AssistEditCanvasContext => JSON.parse(JSON.stringify(GOLDEN.canvas))
const answer = (): Record<string, unknown> => JSON.parse(JSON.stringify(GOLDEN.answer))
const SELECTED = 'feature'

const codes = (result: ReturnType<typeof checkAiComponentSelection>): string[] =>
  result.violations.map((violation) => violation.code)

describe('the selection', () => {
  it('is the element chosen and everything under it, and nothing beside it', () => {
    expect([...aiComponentSelectionIds(context(), SELECTED)].sort()).toEqual(
      ['feature', 'heading', 'body', 'image', 'primary', 'secondary'].sort(),
    )
  })

  it('refuses the document itself, and a selection with nothing chosen', () => {
    expect(aiComponentSelectionRefusal(context(), null)).toMatch(/Select the section/)
    expect(aiComponentSelectionRefusal(context(), CANVAS_ROOT_ELEMENT_ID)).toMatch(
      /Select the section/,
    )
    expect(aiComponentSelectionRefusal(context(), 'nowhere')).toMatch(/Select the section/)
  })

  it('refuses the page’s main landmark and a second top-level heading, before any spend', () => {
    const withLandmark = context()
    const selection = withLandmark.nodes.find((node) => node.id === SELECTED)
    selection!.props = { ...(selection!.props ?? {}), component: 'main' }
    expect(aiComponentSelectionRefusal(withLandmark, SELECTED)).toMatch(/main landmark/)

    const twoHeadings = context()
    for (const id of ['heading', 'body']) {
      const node = twoHeadings.nodes.find((entry) => entry.id === id)
      node!.componentId = 'muiTypography'
      node!.props = { ...(node!.props ?? {}), variant: 'h1' }
    }
    expect(aiComponentSelectionRefusal(twoHeadings, SELECTED)).toMatch(/top-level heading/)
    // ANTI-VACUITY: one h1 inside the selection is fine.
    const oneHeading = context()
    const only = oneHeading.nodes.find((entry) => entry.id === 'heading')
    only!.props = { ...(only!.props ?? {}), variant: 'h1' }
    expect(aiComponentSelectionRefusal(oneHeading, SELECTED)).toBeNull()
  })

  it('refuses a selection the outline stopped short of describing', () => {
    const clipped = context()
    const selection = clipped.nodes.find((node) => node.id === SELECTED)
    // The outline caps at a node count; a child it never reached is a part of
    // the section the model would not see.
    selection!.childCount += 1
    expect(aiComponentSelectionRefusal(clipped, SELECTED)).toMatch(/too large/)
  })

  it('admits the golden’s own selection', () => {
    expect(aiComponentSelectionRefusal(context(), SELECTED)).toBeNull()
  })
})

describe('the tool', () => {
  const tool = aiComponentSelectionTool()

  it('is strict, and offers only the kinds the Properties dialog has', () => {
    expect(tool.name).toBe(AI_COMPONENT_SELECTION_TOOL_NAME)
    expect(tool.strict).toBe(true)
    const props = (tool.inputSchema as any).properties.props.items
    expect(props.properties.type.enum).toEqual([...AI_COMPONENT_PROP_KINDS])
    expect(props.additionalProperties).toBe(false)
  })

  it('requires every field of every object, which a strict schema needs', () => {
    const walk = (schema: any): void => {
      if (schema?.type === 'object') {
        expect(Object.keys(schema.properties).sort()).toEqual([...schema.required].sort())
        for (const child of Object.values(schema.properties)) walk(child)
      }
      if (schema?.type === 'array') walk(schema.items)
    }
    walk(tool.inputSchema)
  })

  it('asks for no default and no tree: the answer is references', () => {
    const written = JSON.stringify(tool.inputSchema)
    expect(written).not.toContain('defaultValue')
    expect(written).not.toContain('tree')
    expect(written).not.toContain('nodes')
  })
})

describe('what the request sends', () => {
  it('sends the outline and the name, and marks what is inside the selection', () => {
    const prompt = aiComponentSelectionPrompt(context(), SELECTED, GOLDEN.name)
    expect(prompt).toContain(JSON.stringify(GOLDEN.name))
    for (const id of aiComponentSelectionIds(context(), SELECTED)) {
      expect([id, prompt.includes(`* ${id}:`)]).toEqual([id, true])
    }
    // The document root is described and is not inside the selection.
    expect(prompt).toContain(`  ${CANVAS_ROOT_ELEMENT_ID}:`)
  })

  it('sends nothing the outline did not carry', () => {
    const prompt = aiComponentSelectionPrompt(context(), SELECTED, GOLDEN.name)
    for (const line of prompt.split('\n').slice(3)) {
      if (!line.trim()) continue
      const id = /^[* ] (\S+):/.exec(line)?.[1]
      expect([line, Boolean(id)]).toEqual([line, true])
      expect([line, context().nodes.some((node) => node.id === id)]).toEqual([line, true])
    }
  })

  it('caches its instructions, and names the tool it must be answered through', () => {
    expect(AI_COMPONENT_SELECTION_INSTRUCTIONS).toHaveLength(1)
    expect(AI_COMPONENT_SELECTION_INSTRUCTIONS[0].cacheBreakpoint).toBe(true)
    expect(AI_COMPONENT_SELECTION_INSTRUCTIONS[0].text).toContain(AI_COMPONENT_SELECTION_TOOL_NAME)
    // The recorded answer fits the ceiling at three characters a token.
    expect(Math.ceil(JSON.stringify(GOLDEN.answer).length / 3)).toBeLessThanOrEqual(
      AI_COMPONENT_SELECTION_MAX_TOKENS,
    )
  })
})

describe('the check — a closed world', () => {
  it('takes the golden’s answer whole', () => {
    const result = checkAiComponentSelection(answer(), context(), SELECTED)
    expect(codes(result)).toEqual([])
    expect(result.value?.props.map((prop) => prop.name)).toEqual([
      'headline',
      'body',
      'image',
      'primaryLabel',
      'primaryHref',
      'hideSecondary',
    ])
    // References only: no default is proposed, because the server never saw
    // a whole value to make one out of.
    for (const prop of result.value?.props ?? []) {
      expect([prop.name, 'defaultValue' in prop]).toEqual([prop.name, false])
    }
  })

  it('refuses a binding on an element outside the selection', () => {
    const outside = answer()
    ;(outside['bindings'] as any[])[0].nodeId = 'other-section'
    expect(codes(checkAiComponentSelection(outside, context(), SELECTED))).toEqual([
      'binding-outside',
    ])
  })

  it('refuses a binding on an element the outline never described', () => {
    const unknown = answer()
    ;(unknown['bindings'] as any[])[0].nodeId = 'invented'
    expect(codes(checkAiComponentSelection(unknown, context(), SELECTED))).toEqual([
      'binding-outside',
    ])
  })

  it('refuses a property that hides the whole component', () => {
    const wholeThing = answer()
    const hide = (wholeThing['bindings'] as any[]).find((binding) => binding.field === 'hideIf')
    hide.nodeId = SELECTED
    expect(codes(checkAiComponentSelection(wholeThing, context(), SELECTED))).toEqual([
      'binding-hides-all',
    ])
  })
})

describe('the check — the binding rules', () => {
  it('refuses a property bound to a field of another kind', () => {
    const wrongFit = answer()
    const binding = (wrongFit['bindings'] as any[]).find((entry) => entry.prop === 'image')
    binding.prop = 'headline'
    expect(codes(checkAiComponentSelection(wrongFit, context(), SELECTED))).toEqual(['binding-fit'])
  })

  it('refuses a Yes / no on hideIf that is not labeled "Hide …"', () => {
    const unlabeled = answer()
    const prop = (unlabeled['props'] as any[]).find((entry) => entry.name === 'hideSecondary')
    prop.label = 'Second button'
    expect(codes(checkAiComponentSelection(unlabeled, context(), SELECTED))).toEqual(['hide-label'])
  })

  it('refuses a property that is declared and never bound', () => {
    const unbound = answer()
    ;(unbound['props'] as any[]).push({
      name: 'spare',
      type: 'text',
      label: 'Spare',
      description: '',
      options: [],
    })
    expect(codes(checkAiComponentSelection(unbound, context(), SELECTED))).toEqual(['prop-unbound'])
  })

  it('refuses a binding naming a property that was never declared', () => {
    const undeclared = answer()
    ;(undeclared['bindings'] as any[])[0].prop = 'nobody'
    expect(codes(checkAiComponentSelection(undeclared, context(), SELECTED))).toEqual([
      'binding-undeclared',
    ])
  })

  it('refuses a kind the Properties dialog does not have, and a repeated name', () => {
    const badKind = answer()
    ;(badKind['props'] as any[])[0].type = 'wysiwyg'
    expect(codes(checkAiComponentSelection(badKind, context(), SELECTED))).toEqual(['prop-kind'])

    const twice = answer()
    ;(twice['props'] as any[])[1].name = (twice['props'] as any[])[0].name
    expect(codes(checkAiComponentSelection(twice, context(), SELECTED))).toEqual(['prop-duplicate'])
  })

  it('refuses a proposal that names nothing at all', () => {
    const empty = { summary: 'Nothing here', props: [], bindings: [] }
    expect(codes(checkAiComponentSelection(empty, context(), SELECTED))).toEqual([
      'nothing-proposed',
    ])
  })

  it('refuses an answer missing a list', () => {
    expect(codes(checkAiComponentSelection({ summary: 'x', props: [] }, context(), SELECTED))).toEqual(
      ['proposal-missing'],
    )
  })
})

describe('the op the card applies', () => {
  it('names the selection and carries the properties and bindings, and no defaults', () => {
    const checked = checkAiComponentSelection(answer(), context(), SELECTED)
    const selection = context().nodes.find((node) => node.id === SELECTED)!
    const op = aiComponentSelectionOp(checked.value!, selection, GOLDEN.name)
    expect(op).toMatchObject({
      op: 'saveAsComponent',
      nodeId: SELECTED,
      componentId: selection.componentId,
      name: GOLDEN.name,
    })
    expect(op.bindings.every((binding) => binding.componentId)).toBe(true)
    expect(JSON.stringify(op)).not.toContain('defaultValue')
  })
})
