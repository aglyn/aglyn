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
 * Campaign merge tags (AGL-272): `{{name}}`, `{{firstName}}`, and
 * `{{email}}` personalize the subject and body per recipient at send
 * time. A pipe sets the fallback when the value is unknown —
 * `{{name|there}}` renders "there" for recipients without a stored name.
 * Unknown tags render their fallback (or empty), never the raw token.
 */
export interface MergeTagRecipient {
  email: string
  /** Display name when the audience source stores one (leads/contacts). */
  name?: string
}

const MERGE_TAG_PATTERN = /\{\{\s*([a-zA-Z]+)\s*(?:\|([^}]*))?\}\}/g

export function resolveMergeTags(
  template: string,
  recipient: MergeTagRecipient,
): string {
  return template.replace(MERGE_TAG_PATTERN, (_match, tag, fallback) => {
    const name = (recipient.name ?? '').trim()
    const value =
      tag === 'email'
        ? recipient.email
        : tag === 'name'
          ? name
          : tag === 'firstName'
            ? name.split(/\s+/)[0]
            : ''
    return value || String(fallback ?? '').trim()
  })
}

/** True when the template uses at least one recognized merge tag. */
export function hasMergeTags(template: string): boolean {
  MERGE_TAG_PATTERN.lastIndex = 0
  return MERGE_TAG_PATTERN.test(template)
}
