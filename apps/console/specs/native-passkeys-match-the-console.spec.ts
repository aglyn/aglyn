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

/**
 * The native account screen sets a passkey up through the same two routes the console's `registerPasskey` calls, says
 * what the console says, and presents the credential's origin the way the server accepts it. The ceremony itself is
 * replayed by both renderers (ScreenPasskeyTests, ScreenPasskeyTest) with the platform's prompt faked.
 */
interface Block {
  type: string
  title?: string
  when?: string
  empty?: string
  footer?: string
  text?: string
  badges?: Array<{ text: string; when: string }>
  items?: unknown
}
interface Action {
  id: string
  label: string
  success?: string
  passkey?: { options: string; verify: string; origin: string; errors: Record<string, string>; otherwise: string }
}

const read = (path: string) => readFileSync(join(__dirname, '../../..', path), 'utf8')
const screens = (JSON.parse(read('libs/native/screens/account.screens.json')) as { screens: Array<{ id: string; blocks: Block[] }> }).screens
const blocks = screens.find((screen) => screen.id === 'core.account.security')?.blocks ?? []
const card = read('apps/console/components/passkeys-card.component.tsx')
const client = read('apps/console/utils/passkeys.ts')
const server = read('apps/console/app/api/_lib/passkeys.ts')

const add = (blocks.find((block) => block.when === 'user.canAddPasskey')?.items as Action[]).find((one) => one.id === 'addPasskey') as Action

describe('native passkeys', () => {
  it('calls the registration routes the console calls', () => {
    expect(add.passkey?.options).toBe('/api/auth/passkeys/register/options')
    expect(add.passkey?.verify).toBe('/api/auth/passkeys/register/verify')
    expect(client).toContain("'/api/auth/passkeys/register/options'")
    expect(client).toContain("'/api/auth/passkeys/register/verify'")
    expect(read('apps/console/app/api/auth/passkeys/remove/route.ts')).toContain('credentialId')
  })

  it('says what the console says', () => {
    expect(add.label).toBe('Set up a passkey')
    expect(card).toContain(add.label)
    expect(card).toContain('Passkey "${label}" added')
    expect(add.success).toBe('Passkey "{response.label}" added')
    expect(card).toContain('Passkey limit reached — remove one first.')
    expect(add.passkey?.errors['limit-reached']).toBe('Passkey limit reached — remove one first.')
    expect(card).toContain(add.passkey?.otherwise)
    const list = blocks.find((block) => block.title === 'Passkeys') as Block
    expect(card).toContain(list.empty?.replace(/\.$/, ''))
    expect(card).toContain('Blocked — possible credential copy')
    expect(list.badges?.[0]?.text).toBe('Blocked: possible credential copy')
    // The explanation is the console's, in one sentence with its dash.
    expect(list.footer).toContain('Passkeys are an extra way in — your other sign-in methods keep working.')
    expect(card).toContain('Passkeys are an extra way in — your other')
  })

  it('is offered to the accounts the routes accept, and the limit is the console’s', () => {
    const gate = read('apps/console/app/api/auth/passkeys/_lib/passkey-auth.ts')
    expect(gate).toContain('decoded.firebase?.tenant')
    expect(gate).toContain('decoded.email_verified')
    expect(server).toContain('MAX_PASSKEYS_PER_USER = 10')
    expect(server).toContain("throw new PasskeyError('limit-reached')")
    expect(card).toContain("error.reason === 'limit-reached'")
  })

  it('presents an origin the server resolves to the same relying party', () => {
    // The options call sends the relying party's own origin; an Apple credential is signed with it too, and the server
    // resolves any origin on the workspace domain to that relying party (passkeys.spec.ts).
    expect(add.passkey?.origin).toBe('https://{app.passkeyRp}')
    expect(server).toContain('host === WORKSPACE_DOMAIN')
    // An Android credential's origin is the certificate's SHA-256 as base64url (43 characters), accepted only when listed.
    expect(server).toContain('/^android:apk-key-hash:([A-Za-z0-9_-]{43})$/')
    expect(server).toContain('PASSKEY_ANDROID_APK_KEY_HASHES')
  })
})
