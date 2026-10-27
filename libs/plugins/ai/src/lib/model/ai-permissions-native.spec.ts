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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOST_ROLE_AI_PERMISSIONS } from './ai-permissions'

/**
 * The native "AI access" screen for a site collaborator restates the role
 * defaults the console's per-site Permissions dialog draws
 * (`stored ?? HOST_ROLE_AI_PERMISSIONS[role]`), because a screen spec has no
 * role table. A role default that changes in the plugin must change there.
 */
const SPEC = join(
  __dirname,
  '../../ios/Sources/AglynAiPlugin/Resources/ai.screens.json',
)
const screens = JSON.parse(readFileSync(SPEC, 'utf8')).screens as Array<{
  id: string
  constants?: { defaults?: Record<string, Record<string, boolean>> }
}>

describe('native AI access for a site collaborator', () => {
  it('starts from the same per-role defaults as the console', () => {
    const native = screens.find((s) => s.id === 'ai.hostMember')?.constants
      ?.defaults
    expect(native).toEqual(HOST_ROLE_AI_PERMISSIONS)
  })
})
