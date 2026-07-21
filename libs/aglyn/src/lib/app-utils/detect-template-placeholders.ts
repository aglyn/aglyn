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
 * Bare `{{name}}` tokens in the captured content (AGL-672).
 *
 * Deliberately ignores the id-form `{{var:…}}` and `{{fn:…}}` host bindings:
 * those resolve against the site's own variables and functions at render
 * time, so turning one into a template placeholder would break the binding
 * it already has. Only the plain named form is a placeholder candidate,
 * which is the same form `resolveNamedTokens` substitutes.
 */
export function detectTemplatePlaceholders(nodes: Record<string, unknown>): string[] {
  const found = new Set<string>()
  const pattern = /\{\{\s*([a-zA-Z][\w.-]*)\s*\}\}/g
  // Explicit return type: the function is recursive, so inference has
  // nothing to anchor on and `noImplicitAny` rejects it in this lib.
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(pattern)) {
        const name = match[1]
        if (name && !name.includes(':')) found.add(name)
      }
      return
    }
    if (Array.isArray(value)) return void value.forEach(walk)
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(walk)
    }
  }
  walk(nodes)
  return Array.from(found).sort()
}
