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

import * as Aglyn from '@aglyn/aglyn'
import { renderEmailHtml } from './model'
import { BUNDLE_ID } from './constants/bundle-common'
import { EMAIL_BUNDLE, registerEmailPlugin } from './plugin'

/**
 * Email blocks that RENDER what is dropped into them (AGL-1389) — see the
 * mui bundle's list for what this is and why it is an inventory rather than
 * an exemption list.
 */
const EMAIL_DECLARED_CONTAINERS: readonly string[] = ['emailSection']

const SENTINEL = 'child-contract-sentinel'

describe('email plugin', () => {
  it('registers the bundle once with all email blocks', () => {
    registerEmailPlugin()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBeTruthy()
    expect(() => registerEmailPlugin()).not.toThrow()
    const ids = EMAIL_BUNDLE.map((entry) => entry.schema.$id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'emailSection',
        'emailText',
        'emailRichtext',
        'emailImage',
        'emailButton',
        'emailDivider',
        'emailSpacer',
        'emailProduct',
        'emailHtml',
      ]),
    )
    // Every schema carries the email bundle id.
    for (const entry of EMAIL_BUNDLE) {
      expect(entry.schema.pluginId).toBe(BUNDLE_ID)
    }
  })

  it('lets nothing become a container by accident (AGL-1389)', () => {
    expect(
      Aglyn.auditChildContract(EMAIL_BUNDLE, EMAIL_DECLARED_CONTAINERS),
    ).toEqual([])
  })

  it('keeps every container’s children through compose (AGL-1389)', () => {
    expect(
      Aglyn.auditComposeChildSurvival(
        Aglyn.listAcceptingComponentIds(EMAIL_BUNDLE),
      ),
    ).toEqual([])
  })

  it('renders every container’s children in the EMAIL html too (AGL-1389)', () => {
    // `email-render.ts` is a SECOND render surface with its own switch
    // statement, so the same disagreement can appear there and nowhere else:
    // a block whose case forgets `renderChildren(node.nodes)` swallows an
    // author's node on send while the canvas shows it happily.
    //
    // Unlike the besigner's React tree this one is a pure string function
    // over a node map — no providers, no context, no canvas singleton — so
    // it can be probed for real, with a sentinel, and needs no exemptions.
    // Today only `emailSection` handles children explicitly and the
    // `default` case renders them; this is what keeps the next `case` from
    // quietly dropping one.
    const swallowed: string[] = []
    for (const componentId of Aglyn.listAcceptingComponentIds(EMAIL_BUNDLE)) {
      const { html } = renderEmailHtml({
        rootId: 'root',
        nodes: {
          root: { componentId: 'div', nodes: ['subject'] },
          subject: { componentId, props: {}, nodes: ['sentinel'] },
          sentinel: { componentId: 'emailText', props: { children: SENTINEL } },
        },
      })
      if (!html.includes(SENTINEL)) swallowed.push(componentId)
    }
    expect(swallowed).toEqual([])
  })
})
