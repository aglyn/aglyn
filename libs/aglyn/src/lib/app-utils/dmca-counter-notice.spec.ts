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
 * AGL-1983: the §512(g) counter-notice, and the clock that puts a site back.
 *
 * Two properties carry this suite, and they pull in opposite directions.
 *
 * The validation half is strict where the abuse intake is lax, and the tests
 * say why: an incomplete counter-notice is not a slightly worse counter-notice,
 * it is a document that does not work, and accepting one would leave us owing
 * a complainant a forward and a customer a restoration on the strength of a
 * paper that has no legal effect.
 *
 * The clock half is the one that would rot silently. Every assertion about
 * `restoreAtMs` is written against the STATUTORY BOUNDS rather than against a
 * hard-coded date, so the suite still means something if the target inside
 * the window ever moves — and goes red the moment it moves outside it.
 */

import {
  COUNTER_NOTICE_MAX_BUSINESS_DAYS,
  COUNTER_NOTICE_MIN_BUSINESS_DAYS,
  COUNTER_NOTICE_RESTORE_BUSINESS_DAYS,
  COUNTER_NOTICE_STATUSES,
  COUNTER_NOTICE_TERMINAL_STATUSES,
  counterNoticeAwaitsRestoration,
  counterNoticeClock,
  isCounterNoticeStatus,
  normalizeNoticeReference,
  validateCounterNotice,
} from './dmca-counter-notice'
import { normalizeReportedUrl, reportedHostname } from './abuse-report'

/** The route's own wiring, so the suite tests what actually runs. */
const validate = (payload: Record<string, unknown>) =>
  validateCounterNotice(payload, normalizeReportedUrl, reportedHostname)

/** Every statutory element present and sworn. The shape that must be accepted. */
const COMPLETE = {
  url: 'https://acme.aglyn.app/gallery',
  material: 'The three product photographs on the gallery page, which I shot myself.',
  name: 'Dana Okonkwo',
  address: '128 Rue Example, Suite 4, Austin, TX 78701, United States',
  phone: '+1 512 555 0134',
  email: 'dana@acme.test',
  signature: 'Dana Okonkwo',
  goodFaithMistake: true,
  consentJurisdiction: true,
  acceptService: true,
  reference: 'AR-9F2C1B7A44',
}

describe('validateCounterNotice', () => {
  it('accepts a complete counter-notice and normalizes it', () => {
    const result = validate({ ...COMPLETE })
    expect(result.ok).toBe(true)
    const value = (result as any).value
    expect(value.signature).toBe('Dana Okonkwo')
    expect(value.reportedHostname).toBe('acme.aglyn.app')
    expect(value.reference).toBe('AR-9F2C1B7A44')
    // The three sworn statements normalize to `true`, never to the raw
    // checkbox string — the stored record has to read as a sworn fact, not as
    // a transport artefact of whichever client sent it.
    expect(value.goodFaithMistake).toBe(true)
    expect(value.consentJurisdiction).toBe(true)
    expect(value.acceptService).toBe(true)
  })

  /**
   * The refusal table. Each row removes exactly ONE statutory element from an
   * otherwise complete submission, so a green here cannot come from the
   * fixture being broken in some other way — and the `code` is asserted
   * because the form uses it to highlight the field the subscriber must fix.
   */
  it.each([
    ['the location of the material', 'url', { url: '' }],
    ['identification of the material', 'material', { material: 'gone' }],
    ['the subscriber name', 'name', { name: '' }],
    ['the postal address', 'address', { address: 'Austin' }],
    ['the telephone number', 'phone', { phone: '' }],
    ['a reply address', 'email', { email: 'not-an-address' }],
    ['the electronic signature', 'signature', { signature: '' }],
    [
      'the penalty-of-perjury mistake statement',
      'goodFaithMistake',
      { goodFaithMistake: false },
    ],
    [
      'consent to jurisdiction',
      'consentJurisdiction',
      { consentJurisdiction: false },
    ],
    ['agreement to accept service', 'acceptService', { acceptService: false }],
  ])('refuses a notice missing %s', (_label, code, override) => {
    const result = validate({ ...COMPLETE, ...(override as object) })
    expect(result.ok).toBe(false)
    expect((result as any).code).toBe(code)
    // The message is what the subscriber reads while they can still fix it,
    // so it must not be empty and must not be the machine code.
    expect((result as any).message.length).toBeGreaterThan(20)
  })

  it('reads a no-JS checkbox exactly as it reads a JSON boolean', () => {
    // A hardened browser posting `on` and a fetch client posting `true` are
    // the same sworn statement. If these ever diverge, the subscribers who
    // lose are the ones with scripting restricted — and the failure is
    // silent, refusing a valid counter-notice as if it were incomplete.
    const asForm = validate({
      ...COMPLETE,
      goodFaithMistake: 'on',
      consentJurisdiction: 'on',
      acceptService: 'on',
    })
    expect(asForm.ok).toBe(true)
    // And the absent-field case, which is what an unticked box actually sends.
    const unticked: Record<string, unknown> = { ...COMPLETE }
    delete unticked['acceptService']
    const result = validate(unticked)
    expect(result.ok).toBe(false)
    expect((result as any).code).toBe('acceptService')
  })

  it('refuses a javascript: location the way the notice side does', () => {
    // The counter-notice is rendered in the same staff console as the notice,
    // so it is the same stored-XSS surface aimed at the same session — the
    // one that can suspend any site on the platform.
    const result = validate({
      ...COMPLETE,
      // eslint-disable-next-line no-script-url
      url: 'javascript:alert(document.cookie)',
    })
    expect(result.ok).toBe(false)
    expect((result as any).code).toBe('url')
  })

  it('accepts a subscriber who has lost their reference', () => {
    // A customer whose site is down and who deleted the email must still be
    // able to file. Staff can match on the URL; refusing them for a missing
    // reference would be us inventing a statutory element.
    const withoutReference: Record<string, unknown> = { ...COMPLETE }
    delete withoutReference['reference']
    const result = validate(withoutReference)
    expect(result.ok).toBe(true)
    expect((result as any).value.reference).toBeNull()
  })
})

describe('normalizeNoticeReference', () => {
  it('accepts the reference with or without its prefix, in any case', () => {
    expect(normalizeNoticeReference('AR-9F2C1B7A44')).toBe('AR-9F2C1B7A44')
    expect(normalizeNoticeReference('9f2c1b7a44')).toBe('AR-9F2C1B7A44')
    expect(normalizeNoticeReference('  ar-9F2C1B7A44 ')).toBe('AR-9F2C1B7A44')
  })

  it('refuses anything that is not one of our references', () => {
    expect(normalizeNoticeReference('')).toBeNull()
    expect(normalizeNoticeReference('the one about my photos')).toBeNull()
    expect(normalizeNoticeReference('AR-ZZZZ')).toBeNull()
    expect(normalizeNoticeReference(null)).toBeNull()
  })
})

describe('counterNoticeClock', () => {
  const MONDAY = Date.UTC(2026, 7, 17, 9, 30)

  it('schedules restoration inside the statutory window', () => {
    const clock = counterNoticeClock(MONDAY)
    expect(clock.receivedAtMs).toBe(MONDAY)
    expect(clock.restoreAtMs).toBeGreaterThanOrEqual(clock.earliestMs)
    expect(clock.restoreAtMs).toBeLessThanOrEqual(clock.latestMs)
  })

  it('holds the window from every day of the week', () => {
    // §512(g)(2)(C) counts from RECEIPT, and receipt is whenever the
    // subscriber pressed the button — including Saturday night. Asserted
    // against the bounds rather than a date so moving the target inside the
    // window stays green and moving it outside goes red.
    for (let offset = 0; offset < 14; offset += 1) {
      const clock = counterNoticeClock(MONDAY + offset * 86_400_000)
      expect(clock.restoreAtMs).toBeGreaterThanOrEqual(clock.earliestMs)
      expect(clock.restoreAtMs).toBeLessThanOrEqual(clock.latestMs)
    }
  })

  it('leaves room for federal holidays at both ends of the window', () => {
    // The reason the target is the middle of the window and not the floor.
    // A weekend-only count OVER-estimates business days elapsed, because
    // holidays only ever remove working days. So the target must sit at least
    // two days above the floor — absorbing the most federal holidays that can
    // fall in one such span — and at or below the ceiling.
    expect(
      COUNTER_NOTICE_RESTORE_BUSINESS_DAYS - COUNTER_NOTICE_MIN_BUSINESS_DAYS,
    ).toBeGreaterThanOrEqual(2)
    expect(COUNTER_NOTICE_RESTORE_BUSINESS_DAYS).toBeLessThanOrEqual(
      COUNTER_NOTICE_MAX_BUSINESS_DAYS,
    )
  })

  it('never schedules a restoration on a weekend', () => {
    // The clock borrows `addBusinessDays` from the support-SLA module rather
    // than restating it, so this is a contract test on that dependency, not a
    // second copy of its own suite: if it ever stopped skipping weekends, a
    // customer's site would be scheduled to come back on a Saturday and every
    // bounds assertion above would still pass.
    for (let offset = 0; offset < 14; offset += 1) {
      const clock = counterNoticeClock(MONDAY + offset * 86_400_000)
      const day = new Date(clock.restoreAtMs).getUTCDay()
      expect([day, offset]).not.toEqual([0, offset])
      expect([day, offset]).not.toEqual([6, offset])
    }
  })

  it('is a real delay, not an instant put-back', () => {
    // The failure that would look like success: a clock that resolves to
    // `now` restores immediately, which denies the complainant every day the
    // statute gives them and is indistinguishable from having no clock.
    const clock = counterNoticeClock(MONDAY)
    expect(clock.restoreAtMs - MONDAY).toBeGreaterThan(13 * 86_400_000)
  })
})

describe('counterNoticeAwaitsRestoration', () => {
  it('keeps counting only while a put-back is still coming', () => {
    expect(counterNoticeAwaitsRestoration('received')).toBe(true)
    expect(counterNoticeAwaitsRestoration('forwarded')).toBe(true)
  })

  it('stops for every terminal status and for one already restored', () => {
    // `suitFiled` is the statutory brake: the complainant went to court and
    // the material stays down. If this ever returned true, a scheduler would
    // put back material that is the subject of a live federal action.
    for (const status of COUNTER_NOTICE_TERMINAL_STATUSES) {
      expect(counterNoticeAwaitsRestoration(status)).toBe(false)
    }
    expect(counterNoticeAwaitsRestoration('restored')).toBe(false)
  })

  it('stops for a status it does not recognise', () => {
    expect(counterNoticeAwaitsRestoration('probably-fine')).toBe(false)
    expect(counterNoticeAwaitsRestoration(undefined)).toBe(false)
  })

  it('covers every declared status — no status is unclassified', () => {
    // The drift guard. Adding a status to the enum without deciding whether
    // it awaits restoration would leave it silently awaiting one.
    for (const status of COUNTER_NOTICE_STATUSES) {
      expect(isCounterNoticeStatus(status)).toBe(true)
      expect(typeof counterNoticeAwaitsRestoration(status)).toBe('boolean')
    }
    const awaiting = COUNTER_NOTICE_STATUSES.filter(counterNoticeAwaitsRestoration)
    expect([...awaiting]).toEqual(['received', 'forwarded'])
  })
})
