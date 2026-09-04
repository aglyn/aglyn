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

/**
 * What a schema gets when it names nothing — everything (AGL-2557).
 *
 * The default has to be permissive rather than restrictive: `richTextEditable`
 * meant "the whole toolbar" before this existed, and Typography, the one
 * component carrying it, says nothing about groups. A restrictive default
 * would silently take bold away from the element that had it.
 */
const EVERY_GROUP: readonly Aglyn.RICH_TEXT_COMMANDS[] = [
  Aglyn.RICH_TEXT_COMMANDS.EMPHASIS,
  Aglyn.RICH_TEXT_COMMANDS.LIST,
  Aglyn.RICH_TEXT_COMMANDS.LINK,
]

/**
 * The formatting groups this component's inline editor may offer.
 *
 * An EMPTY declared list is read as "nothing declared" rather than as "no
 * formatting". A schema turns formatting off by leaving `richTextEditable`
 * alone, which is the switch the editor already reads; `richTextCommands: []`
 * is what a mistaken spread or a stripped-empty-array produces, and reading
 * it as a silent opt-out would give an author a rich surface with an empty
 * toolbar and no way to tell why.
 */
export function richTextCommandGroups(
  schema: Aglyn.ComponentSchema<any> | undefined | null,
): ReadonlySet<Aglyn.RICH_TEXT_COMMANDS> {
  const declared = schema?.richTextCommands
  return new Set(declared?.length ? declared : EVERY_GROUP)
}
