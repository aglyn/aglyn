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
import { WAIVERS_API_ROUTES, WAIVERS_PUBLIC_PAGE_PATH, WAIVERS_SITE_SIGN_PATH } from './constants/bundle-common'
import { WAIVER_ADULT_AGE_RANGE, WAIVER_LIMITS, WAIVER_STATUS_LABELS } from './model/waiver'
import { WAIVER_METHOD_LABELS } from './model/waiver-signature'

/**
 * The Waivers page's native screens restate a few facts the console works out in code (a status's words, how a
 * signature was taken, the share link's shape, the editor's bounds). This keeps them from drifting from the console.
 */
const screens: Record<string, any> = {}
for (const screen of JSON.parse(
  readFileSync(join(__dirname, '../ios/Sources/AglynWaiversPlugin/Resources/waivers.screens.json'), 'utf8'),
).screens as any[]) {
  screens[screen.id] = screen
}

const rows = (list: Array<{ id: string; label: string }>) => list.map((row) => [row.id, row.label])

describe('native waivers screens', () => {
  it('say a waiver status and a signing method in the console words', () => {
    for (const id of ['waivers.home', 'waivers.signatures', 'waivers.signature', 'waivers.waiver']) {
      expect(rows(screens[id].constants.statuses)).toEqual(Object.entries(WAIVER_STATUS_LABELS))
      expect(rows(screens[id].constants.methods)).toEqual(Object.entries(WAIVER_METHOD_LABELS))
    }
  })

  it('share the link the console shares', () => {
    const text = JSON.stringify(screens['waivers.share'])
    expect(text).toContain(`{data.list.signPageOrigin}/${WAIVERS_SITE_SIGN_PATH}?waiver=`)
    expect(text).toContain(`{app.origin}/kiosk/waivers${WAIVERS_PUBLIC_PAGE_PATH}?host={site.id}&waiver=`)
  })

  it('sign at the window and record a paper waiver through the console routes, within its limits', () => {
    const form = (screen: string, block: string) => screens[screen].blocks.find((one: { id: string }) => one.id === block)
    const sign = form('waivers.sign', 'sign')
    const paper = form('waivers.paper', 'record')
    expect(sign.submit.url).toBe(`/api/${WAIVERS_API_ROUTES.signAtWindow}`)
    expect(paper.submit.url).toBe(`/api/${WAIVERS_API_ROUTES.paper}`)
    expect(screens['waivers.sign'].load.w.url).toContain(`/api/${WAIVERS_API_ROUTES.publicWaiver}?`)
    const minors = (fields: Array<{ key: string; max?: number }>) => fields.find((one) => one.key === 'minors')
    expect(minors(sign.fields)?.max).toBe(WAIVER_LIMITS.minors)
    expect(minors(paper.fields)?.max).toBe(WAIVER_LIMITS.minors)
    // The body carries every key the console's signing form sends.
    expect(Object.keys(sign.submit.body).sort()).toEqual(
      ['attemptKey', 'checked', 'consent', 'guardianRelationship', 'hostId', 'minors', 'signature', 'signatureImage', 'signer', 'version', 'waiverId', 'website'].sort(),
    )
    expect(Object.keys(paper.submit.body).sort()).toEqual(
      ['attemptKey', 'guardianRelationship', 'hostId', 'minors', 'photo', 'signedOnDayKey', 'signer', 'waiverId'].sort(),
    )
  })

  it('bound the editor as the console does', () => {
    const fields = screens['waivers.waiver'].blocks.find((block: { id: string }) => block.id === 'edit').fields
    const field = (key: string) => fields.find((one: { key: string }) => one.key === key)
    expect(field('adultAge').options.map((option: { value: string }) => Number(option.value))).toEqual(
      Array.from({ length: WAIVER_ADULT_AGE_RANGE.max - WAIVER_ADULT_AGE_RANGE.min + 1 }, (_, index) => WAIVER_ADULT_AGE_RANGE.min + index),
    )
    expect(field('days').max).toBe(WAIVER_LIMITS.days)
    expect(field('checkboxes').help).toContain(`up to ${WAIVER_LIMITS.checkboxes}`)
  })
})
