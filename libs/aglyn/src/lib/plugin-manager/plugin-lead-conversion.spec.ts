/**
 * The lead-conversion seam (AGL-3233): one listener per plugin, run in
 * order, isolated, never throwing.
 */

import {
  listPluginLeadConversionListeners,
  registerPluginLeadConversionListener,
  resetPluginLeadConversionListenersForTests,
  runPluginLeadConversionListeners,
} from './plugin-lead-conversion'

const request = {
  orgId: 'org-1',
  hostId: 'site-1',
  leadId: 'lead-1',
  contactId: 'c-1',
  email: 'dana@example.com',
  by: 'member' as const,
}

beforeEach(() => resetPluginLeadConversionListenersForTests())

describe('the lead-conversion seam', () => {
  it('runs every listener in order and answers each report by plugin', async () => {
    const seen: string[] = []
    registerPluginLeadConversionListener(
      async (input) => {
        seen.push(`mail:${input.leadId}→${input.contactId}`)
        return { enrollments: 2 }
      },
      { pluginId: 'mail' },
    )
    registerPluginLeadConversionListener(
      async () => {
        seen.push('notes')
        return { notes: 0 }
      },
      { pluginId: 'notes' },
    )
    expect(listPluginLeadConversionListeners()).toEqual(['mail', 'notes'])
    await expect(runPluginLeadConversionListeners(request)).resolves.toEqual({
      mail: { enrollments: 2 },
      notes: { notes: 0 },
    })
    expect(seen).toEqual(['mail:lead-1→c-1', 'notes'])
  })

  it('records a listener that threw as null and runs the next one', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginLeadConversionListener(
      async () => {
        throw new Error('boom')
      },
      { pluginId: 'mail' },
    )
    registerPluginLeadConversionListener(async () => ({ ok: true }), { pluginId: 'notes' })
    await expect(runPluginLeadConversionListeners(request)).resolves.toEqual({
      mail: null,
      notes: { ok: true },
    })
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it('replaces a plugin’s listener in place and refuses one with no owner', async () => {
    registerPluginLeadConversionListener(async () => ({ first: true }), { pluginId: 'mail' })
    registerPluginLeadConversionListener(async () => ({ second: true }), { pluginId: 'mail' })
    expect(listPluginLeadConversionListeners()).toEqual(['mail'])
    await expect(runPluginLeadConversionListeners(request)).resolves.toEqual({
      mail: { second: true },
    })
    expect(() => registerPluginLeadConversionListener(async () => ({}))).toThrow(/no owner/)
  })
})
