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

import { FEATURE_FLAG, FieldComponentType, type NodeSchema } from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AiAssistActionsContext, type AiAssistActions } from './ai-assist-actions-context'
import {
  AiGenerateSectionControl,
  AiRewriteControl,
  nodeTakesCopyRewrite,
} from './besigner-ai-controls.component'

const textNode = {
  $id: 'heading-1',
  componentSchema: { flags: { textEditable: FEATURE_FLAG.ENABLED }, attributes: [] },
} as unknown as NodeSchema<any>

const imageNode = {
  $id: 'image-1',
  componentSchema: {
    flags: {},
    attributes: [{ name: 'alt', component: FieldComponentType.TEXT_FIELD }],
  },
} as unknown as NodeSchema<any>

const boxNode = {
  $id: 'box-1',
  componentSchema: { flags: {}, attributes: [{ name: 'gap', component: 'number' }] },
} as unknown as NodeSchema<any>

function withActions(actions: AiAssistActions, children: ReactNode) {
  return <AiAssistActionsContext.Provider value={actions}>{children}</AiAssistActionsContext.Provider>
}

/**
 * The copy assistant's besigner controls (AGL-2984), drawn by the plugin
 * through the besigner zones: the toolbar's Generate a section and the
 * Attributes panel's Rewrite with AI, each present only while the provider
 * publishes its door.
 */
describe('the copy assistant’s besigner controls', () => {
  it('the rewrite applies to text elements and to elements with a text attribute', () => {
    expect(nodeTakesCopyRewrite(textNode)).toBe(true)
    expect(nodeTakesCopyRewrite(imageNode)).toBe(true)
    expect(nodeTakesCopyRewrite(boxNode)).toBe(false)
    expect(nodeTakesCopyRewrite(null)).toBe(false)
  })

  it('draws Generate a section only while the door is published, and opens it', () => {
    const { unmount } = render(withActions({}, <AiGenerateSectionControl />))
    expect(screen.queryByRole('button', { name: 'generate section with ai' })).toBeNull()
    unmount()
    const onGenerateSection = jest.fn()
    render(withActions({ onGenerateSection }, <AiGenerateSectionControl />))
    fireEvent.click(screen.getByRole('button', { name: 'generate section with ai' }))
    expect(onGenerateSection).toHaveBeenCalledTimes(1)
  })

  it('draws Rewrite with AI for the selected text element, and opens it for that element', () => {
    const onRewrite = jest.fn()
    const { rerender } = render(withActions({ onRewrite }, <AiRewriteControl node={boxNode} />))
    expect(screen.queryByRole('button', { name: 'Rewrite with AI' })).toBeNull()
    rerender(withActions({ onRewrite }, <AiRewriteControl node={textNode} />))
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite with AI' }))
    expect(onRewrite).toHaveBeenCalledWith(textNode)
    rerender(withActions({}, <AiRewriteControl node={textNode} />))
    expect(screen.queryByRole('button', { name: 'Rewrite with AI' })).toBeNull()
  })
})
