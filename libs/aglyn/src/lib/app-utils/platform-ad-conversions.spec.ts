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
 * The Google Ads conversion reporter.
 *
 * Two failure modes are worth more than the happy path here, and both are
 * silent: a self-hosted console reporting Aglyn's signups into Aglyn's ad
 * account, and a half-configured build filing conversions against whatever
 * action Google picks by default. Neither errors, and neither is visible from
 * inside the deployment that causes it.
 */

const loadWith = async (env: Record<string, string | undefined>) => {
  jest.resetModules()
  const previous = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete (process.env as Record<string, unknown>)[key]
    else (process.env as Record<string, string>)[key] = value
  }
  const loaded = await import('./platform-ad-conversions')
  process.env = previous as NodeJS.ProcessEnv
  return loaded
}

const AGLYN = {
  NEXT_PUBLIC_ADS_CONVERSION_ID: 'AW-18401436785',
  NEXT_PUBLIC_ADS_SIGNUP_LABEL: 'AS8ICPWfmekcEPHIvsZE',
  NEXT_PUBLIC_ADS_SUBSCRIBE_LABEL: '2P2OCPifmekcEPHIvsZE',
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['gtag']
})

describe('the conversion target', () => {
  it('THE CONTROL: a fully configured build has one for each kind', async () => {
    // Every "returns null" case below is only worth something because this
    // proves the same code path CAN produce a target.
    const mod = await loadWith(AGLYN)
    expect(mod.platformAdConversionTarget('signup')).toBe(
      'AW-18401436785/AS8ICPWfmekcEPHIvsZE',
    )
    expect(mod.platformAdConversionTarget('subscribe')).toBe(
      'AW-18401436785/2P2OCPifmekcEPHIvsZE',
    )
  })

  it('is null for a build with no ad account — the self-host case', async () => {
    /*
     * `analyticsMayEmit()` is true for ANY production build, so a hardcoded
     * id would have every self-hosted console reporting its operator's signups
     * into Aglyn's ad account. Unset must mean unset.
     */
    const mod = await loadWith({
      NEXT_PUBLIC_ADS_CONVERSION_ID: undefined,
      NEXT_PUBLIC_ADS_SIGNUP_LABEL: undefined,
      NEXT_PUBLIC_ADS_SUBSCRIBE_LABEL: undefined,
    })
    expect(mod.platformAdConversionTarget('signup')).toBeNull()
    expect(mod.platformAdConversionTarget('subscribe')).toBeNull()
  })

  it('is null when the id is set but the label is not', async () => {
    /*
     * `AW-123/` is not a no-op: gtag accepts an empty label and reports
     * against the account default, so a half-configured deployment files its
     * signups under whatever conversion Google picks.
     */
    const mod = await loadWith({
      ...AGLYN,
      NEXT_PUBLIC_ADS_SIGNUP_LABEL: '',
    })
    expect(mod.platformAdConversionTarget('signup')).toBeNull()
    // The other kind is unaffected — this is per-action, not all-or-nothing.
    expect(mod.platformAdConversionTarget('subscribe')).not.toBeNull()
  })
})

describe('reporting one', () => {
  it('sends the conversion when configured and allowed', async () => {
    const mod = await loadWith(AGLYN)
    const gtag = jest.fn()
    ;(globalThis as Record<string, unknown>)['gtag'] = gtag

    expect(mod.reportPlatformAdConversion('signup', true)).toBe(true)
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: 'AW-18401436785/AS8ICPWfmekcEPHIvsZE',
    })
  })

  it('sends NOTHING when the visitor has not allowed advertising', async () => {
    // The case that matters most: a refused visitor must not be reported to an
    // ad network, whatever else is configured.
    const mod = await loadWith(AGLYN)
    const gtag = jest.fn()
    ;(globalThis as Record<string, unknown>)['gtag'] = gtag

    expect(mod.reportPlatformAdConversion('signup', false)).toBe(false)
    expect(gtag).not.toHaveBeenCalled()
  })

  it('sends nothing when the build has no ad account, even if allowed', async () => {
    const mod = await loadWith({ NEXT_PUBLIC_ADS_CONVERSION_ID: undefined })
    const gtag = jest.fn()
    ;(globalThis as Record<string, unknown>)['gtag'] = gtag

    expect(mod.reportPlatformAdConversion('signup', true)).toBe(false)
    expect(gtag).not.toHaveBeenCalled()
  })

  it('does not throw when no tag has booted', async () => {
    /*
     * `gtag` is defined by the Analytics tag, which does not exist for a
     * visitor who refused — the very path that also passes `allowed: false`.
     * Reporting must degrade to "not sent", never to an exception on a signup
     * that otherwise succeeded.
     */
    const mod = await loadWith(AGLYN)
    expect(() => mod.reportPlatformAdConversion('signup', true)).not.toThrow()
    expect(mod.reportPlatformAdConversion('signup', true)).toBe(false)
  })
})
