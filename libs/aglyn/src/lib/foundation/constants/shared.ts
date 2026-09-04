/**
 * @license
 * Copyright 2022 Aglyn LLC
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

export enum FEATURE_FLAG {
  UNKNOWN,
  DEFAULT = 1,
  ENABLED = 1 << 1,
  DISABLED = 1 << 2,
  ENABLED_DEFAULT = DEFAULT | ENABLED,
  DISABLED_DEFAULT = DEFAULT | DISABLED,
}

/**
 * A group of formatting the inline rich-text toolbar may offer for one
 * component (AGL-2557).
 *
 * `richTextEditable` is a yes/no, and yes/no is the wrong shape for this
 * question. Accordion Summary and Button render a `<button>`, and Screen
 * Link renders an `<a>`; the content model of both is phrasing content with
 * no interactive descendant. A list or a nested anchor inside one is invalid
 * markup that browsers UNNEST, and nested interactive content is unreachable
 * by keyboard and unusable with a screen reader — the reasoning AGL-1232
 * already applied when a linked accordion header had to become two sibling
 * controls rather than an anchor inside the toggle.
 *
 * Emphasis is safe inside every one of them, so the toolbar has to be able
 * to offer that half alone. A schema that names no groups gets them all,
 * which is what keeps Typography — the only element with rich text before
 * this — exactly as it was.
 */
export enum RICH_TEXT_COMMANDS {
  /** Bold, italic, underline: phrasing content, valid anywhere text is. */
  EMPHASIS = 'emphasis',
  /** Bulleted and numbered lists: block content, and a container for it. */
  LIST = 'list',
  /** The link tool, which writes an anchor. */
  LINK = 'link',
}
