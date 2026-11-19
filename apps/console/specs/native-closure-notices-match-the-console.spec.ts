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
import { CLOSURE_NOTICES_UNAVAILABLE } from '../components/closure-notices.component'

/*
 * The apps' delete-workspace and close-account screens ask
 * `/api/closure-notices` for the same subject the console's screens do, and
 * say the console's words when it cannot answer (AGL-4038).
 */
const read = (file: string) =>
  (JSON.parse(readFileSync(join(__dirname, `../../../libs/native/screens/${file}`), 'utf8')) as {
    screens: Array<Record<string, any>>
  }).screens

const screens = [
  ['workspace.screens.json', 'core.settings.delete', 'subject=workspace&orgId={org.id}'],
  ['account.screens.json', 'core.account.close', 'subject=account'],
] as const

describe('native closure notices', () => {
  it.each(screens)('%s %s asks for its subject and says the console’s words', (file, id, subject) => {
    const screen = read(file).find((entry) => entry.id === id)!
    expect(screen.load.closure.url).toBe(`/api/closure-notices?${subject}`)
    const texts = screen.blocks.map((block: any) => block.text)
    expect(texts).toContain(CLOSURE_NOTICES_UNAVAILABLE)
    const lists = screen.blocks.filter((block: any) => block.items === 'data.closure.notices')
    expect(lists.map((block: any) => block.flatten ?? null)).toEqual([null, 'items'])
  })
})
