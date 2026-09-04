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

import { richTextCommandGroups } from './rich-text-commands'

/**
 * AGL-2557 turned `richTextEditable` from a yes/no into a yes/no plus a
 * command set, and the risk in that move is entirely in the DEFAULT. Every
 * rich-text node in the corpus is a Typography, whose schema says nothing
 * about groups — so a default that answered "none" or "emphasis" would take
 * lists and links away from the one element that already had them, silently,
 * on every existing site.
 */
describe('richTextCommandGroups (AGL-2557)', () => {
  it('gives a schema that names nothing every group', () => {
    const groups = richTextCommandGroups({ displayName: 'Typography' })
    expect(groups.has(Aglyn.RICH_TEXT_COMMANDS.EMPHASIS)).toBe(true)
    expect(groups.has(Aglyn.RICH_TEXT_COMMANDS.LIST)).toBe(true)
    expect(groups.has(Aglyn.RICH_TEXT_COMMANDS.LINK)).toBe(true)
  })

  it('gives an absent schema every group', () => {
    // The editor reads a node's `componentSchema`, which is optional on the
    // type — an unresolved one must not silently disable formatting.
    expect(richTextCommandGroups(undefined).size).toBe(3)
  })

  it('narrows to exactly what a schema declares', () => {
    const groups = richTextCommandGroups({
      displayName: 'Button',
      richTextCommands: [Aglyn.RICH_TEXT_COMMANDS.EMPHASIS],
    })
    expect(groups.has(Aglyn.RICH_TEXT_COMMANDS.EMPHASIS)).toBe(true)
    expect(groups.has(Aglyn.RICH_TEXT_COMMANDS.LIST)).toBe(false)
    expect(groups.has(Aglyn.RICH_TEXT_COMMANDS.LINK)).toBe(false)
  })

  it('reads an EMPTY list as "nothing declared", not as "no formatting"', () => {
    // A schema turns formatting off through `richTextEditable`, which is the
    // switch the editor already reads. `[]` is what a mistaken spread
    // produces, and honoring it would open a rich surface whose toolbar has
    // no tools on it and nothing to explain why.
    expect(
      richTextCommandGroups({ displayName: 'X', richTextCommands: [] }).size,
    ).toBe(3)
  })
})
