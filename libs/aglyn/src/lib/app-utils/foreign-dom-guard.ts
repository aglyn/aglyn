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
 * Keeps a browser translator from crashing React (facebook/react#11538).
 *
 * Chrome's built-in Translate (and extensions like it) replaces a text node
 * React rendered with a `<font>` wrapper holding the translation. React still
 * holds the ORIGINAL node, so the next commit that removes it, or inserts
 * before it, asks a parent that no longer has it as a child and the DOM
 * throws `NotFoundError: Failed to execute 'removeChild' on 'Node'`. Nothing
 * catches a commit-phase throw short of the root boundary, so the visitor
 * gets the "Something went wrong" screen.
 *
 * That happened on 2026-10-09 22:30Z: a visitor from Istanbul signed up, the
 * console's `/` landing crashed 41 seconds later (preceded by a #418 text
 * mismatch on aglyn.com, the translator's other signature), `global-error`
 * replaced `<body>`, and App Check's reCAPTCHA then failed twice because the
 * container it had appended to `<body>` was gone. The same pair hit
 * aglyn.com on 2026-10-04.
 *
 * The guard answers exactly the mis-parented case and nothing else: removing
 * a node from a parent it is not in is a no-op (the node is already out of
 * the place React believed it was), and inserting before a reference that is
 * not a child appends instead of throwing. Every well-formed call goes
 * straight to the native method. React's own recommendation for translated
 * pages is this patch or `translate="no"`, and the second would take
 * translation away from the very visitors who need it.
 *
 * Framework-free and tiny on purpose: it runs on every published tenant page
 * as well as the console, at module scope beside the error beacon so it is in
 * place before hydration commits anything. No-op during SSR and on repeat
 * installs.
 */

const GUARDED = Symbol.for('aglyn.foreignDomGuard')

export function installForeignDomGuard(): void {
  if (typeof Node !== 'function' || !Node.prototype) return
  const proto = Node.prototype as Node & { [GUARDED]?: true }
  if (proto[GUARDED]) return
  proto[GUARDED] = true

  const removeChild = proto.removeChild
  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child && child.parentNode !== this) return child
    return removeChild.call(this, child) as T
  }

  const insertBefore = proto.insertBefore
  proto.insertBefore = function <T extends Node>(
    this: Node,
    node: T,
    reference: Node | null,
  ): T {
    if (reference && reference.parentNode !== this) {
      return insertBefore.call(this, node, null) as T
    }
    return insertBefore.call(this, node, reference) as T
  }
}
