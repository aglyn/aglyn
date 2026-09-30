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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  listPluginOrgErasers,
  PLUGIN_ORG_KEYED_COLLECTIONS,
  PLUGIN_REQUIRED_ORG_ERASERS,
  registerPluginOrgEraser,
  resetPluginOrgErasersForTests,
  runPluginOrgErasers,
  standInRequiredOrgErasersForTests,
} from './plugin-org-erasure'

const REQUEST = { orgId: 'org-a', dryRun: false }
/** The cases below are about isolation; a required eraser is its own block. */
const NONE_REQUIRED: readonly string[] = []

beforeEach(() => {
  resetPluginOrgErasersForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('plugin org erasers (AGL-2978)', () => {
  it("runs two unrelated plugins' erasers in order, each report under its plugin", async () => {
    const seen: string[] = []
    setRegisteringPluginId('mail')
    registerPluginOrgEraser(async ({ orgId, dryRun }) => {
      seen.push(`mail:${orgId}:${dryRun}`)
      return { grants: 2, revoked: 2 }
    })
    setRegisteringPluginId(undefined)
    registerPluginOrgEraser(
      async ({ orgId }) => {
        seen.push(`backups:${orgId}`)
        return { snapshots: 1, offsite: true }
      },
      { pluginId: 'acme-backups' },
    )

    const reports = await runPluginOrgErasers(REQUEST, NONE_REQUIRED)

    expect(seen).toEqual(['mail:org-a:false', 'backups:org-a'])
    expect(reports).toEqual({
      mail: { grants: 2, revoked: 2 },
      'acme-backups': { snapshots: 1, offsite: true },
    })
    expect(listPluginOrgErasers()).toEqual(['mail', 'acme-backups'])
  })

  it('hands a dry run to every eraser as a dry run', async () => {
    const mail = jest.fn(async () => ({ grants: 3, revoked: null as number | null }))
    registerPluginOrgEraser(mail, { pluginId: 'mail' })

    expect(await runPluginOrgErasers({ orgId: 'org-a', dryRun: true }, NONE_REQUIRED)).toEqual({
      mail: { grants: 3, revoked: null },
    })
    expect(mail).toHaveBeenCalledWith({ orgId: 'org-a', dryRun: true })
  })

  it('records a failing eraser as null, never zero, logs it, and still runs the next', async () => {
    registerPluginOrgEraser(
      async () => {
        throw new Error('provider down')
      },
      { pluginId: 'mail' },
    )
    const backups = jest.fn(async () => ({ snapshots: 0 }))
    registerPluginOrgEraser(backups, { pluginId: 'acme-backups' })

    const reports = await runPluginOrgErasers(REQUEST, NONE_REQUIRED)

    expect(reports).toEqual({ mail: null, 'acme-backups': { snapshots: 0 } })
    expect(backups).toHaveBeenCalledWith(REQUEST)
    expect(console.error).toHaveBeenCalledWith(
      '[plugins] mail failed to erase org org-a',
      expect.any(Error),
    )
  })

  it("replaces a plugin's eraser in place when it registers again", async () => {
    registerPluginOrgEraser(async () => ({ run: 1 }), { pluginId: 'mail' })
    registerPluginOrgEraser(async () => ({ snapshots: 1 }), { pluginId: 'acme-backups' })
    registerPluginOrgEraser(async () => ({ run: 2 }), { pluginId: 'mail' })

    expect(listPluginOrgErasers()).toEqual(['mail', 'acme-backups'])
    expect(await runPluginOrgErasers(REQUEST, NONE_REQUIRED)).toEqual({
      mail: { run: 2 },
      'acme-backups': { snapshots: 1 },
    })
  })

  it('refuses an eraser with no owner', () => {
    expect(() => registerPluginOrgEraser(async () => ({}))).toThrow(/no owner/)
    expect(() => registerPluginOrgEraser(async () => ({}), { pluginId: ' ' })).toThrow(/no owner/)
  })

  it('answers an empty record when no plugin registered one', async () => {
    expect(await runPluginOrgErasers(REQUEST, NONE_REQUIRED)).toEqual({})
  })
})

describe('a REQUIRED org eraser (AGL-3080)', () => {
  it('refuses the erasure before any eraser runs when a required one is not registered', async () => {
    const mail = jest.fn(async () => ({ grants: 1 }))
    registerPluginOrgEraser(mail, { pluginId: 'mail' })

    await expect(runPluginOrgErasers(REQUEST, ['listings'])).rejects.toThrow(
      /listings declared a required org eraser and none is registered/,
    )
    expect(mail).not.toHaveBeenCalled()
  })

  it('runs every eraser, then fails the erasure when a required one threw', async () => {
    registerPluginOrgEraser(
      async () => {
        throw new Error('profile write refused')
      },
      { pluginId: 'listings' },
    )
    const mail = jest.fn(async () => ({ grants: 1 }))
    registerPluginOrgEraser(mail, { pluginId: 'mail' })

    await expect(runPluginOrgErasers(REQUEST, ['listings'])).rejects.toThrow(
      /required eraser of listings failed/,
    )
    // Isolation still holds for everyone else's share.
    expect(mail).toHaveBeenCalledWith(REQUEST)
  })

  it('answers normally when every required eraser ran', async () => {
    registerPluginOrgEraser(async () => ({ removed: 1 }), { pluginId: 'listings' })
    expect(await runPluginOrgErasers(REQUEST, ['listings'])).toEqual({
      listings: { removed: 1 },
    })
  })

  it('holds the compiled declaration by default, which names the marketplace', async () => {
    expect(PLUGIN_REQUIRED_ORG_ERASERS).toEqual(['marketplace'])
    await expect(runPluginOrgErasers(REQUEST)).rejects.toThrow(/marketplace/)
  })

  it('stands a no-op in for a required eraser only where none is registered', async () => {
    registerPluginOrgEraser(async () => ({ real: 1 }), { pluginId: 'mail' })
    standInRequiredOrgErasersForTests()
    expect(await runPluginOrgErasers(REQUEST)).toEqual({
      mail: { real: 1 },
      marketplace: { standIn: true },
    })
  })
})

describe('plugin collections keyed by the organization (AGL-3080)', () => {
  it('compiles each owner’s declaration, with the field that names the org', () => {
    expect(PLUGIN_ORG_KEYED_COLLECTIONS).toEqual(
      expect.arrayContaining([
        { pluginId: 'outreach', name: 'outreachMailboxCredentials', orgField: 'orgId' },
        { pluginId: 'outreach', name: 'outreachLinks', orgField: 'orgId' },
      ]),
    )
  })
})
