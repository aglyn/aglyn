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

import {
  crmDailyDigestEnabled,
  NOTIFICATION_CATEGORY_DESCRIPTIONS,
  NOTIFICATION_SELF_SENT_EMAIL_TYPES,
  NOTIFICATION_TYPE_LABELS,
  STAFF_NOTIFICATION_CATEGORIES,
  notificationAccountTypePref,
  notificationCategory,
  notificationChannelEnabled,
  notificationMuted,
  notificationOverriddenScopes,
  notificationScopePref,
  notificationScopeTypePref,
  notificationTypesInCategory,
  type AglynNotificationType,
  type NotificationSettings,
} from './notifications'

describe('notification categories (AGL-267)', () => {
  it('buckets a type by its prefix and falls back to system', () => {
    expect(notificationCategory('billing.invoice')).toBe('billing')
    expect(notificationCategory('marketplace.review')).toBe('marketplace')
    expect(notificationCategory('nonsense.thing')).toBe('system')
  })

  // NOTE (AGL-1964): this used to be called "labels every type", which it
  // cannot check and never did. A union type is not enumerable at runtime, so
  // iterating `Object.keys(labels)` walks the labels map against ITSELF — add
  // a new `AglynNotificationType` with no label and this stays green. Proved
  // by deleting one: jest passed, and `tsc` failed with TS2741.
  //
  // Completeness is enforced by `Record<AglynNotificationType, string>` on the
  // declaration, i.e. by the compiler, and that is the real guard. What is
  // left here is worth keeping but is a smaller claim, so it now says so: no
  // label may be an empty string, which the type would happily allow and which
  // would render as a blank row.
  it('has no empty label — the type only guarantees a string', () => {
    const labels = NOTIFICATION_TYPE_LABELS as Record<string, string>
    const entries = Object.entries(labels)
    expect(entries.length).toBeGreaterThan(0)
    for (const [type, label] of entries) {
      expect(`${type}:${label}`).not.toMatch(/:$/)
    }
  })
})

describe('the daily CRM digest switch (AGL-2619)', () => {
  it('is on until somebody turns it off, and reads only its own key', () => {
    expect(crmDailyDigestEnabled(undefined)).toBe(true)
    expect(crmDailyDigestEnabled({})).toBe(true)
    expect(crmDailyDigestEnabled({ crmDaily: true })).toBe(true)
    expect(crmDailyDigestEnabled({ crmDaily: false })).toBe(false)
    // A category mute lives in a different map and does not reach it.
    expect(crmDailyDigestEnabled({ content: false })).toBe(true)
  })

  it('files the digest notification under the operational category', () => {
    expect(notificationCategory('content.crmDailyDigest')).toBe('content')
    expect(notificationMuted({ content: false }, 'content.crmDailyDigest')).toBe(true)
    expect(notificationMuted({ billing: false }, 'content.crmDailyDigest')).toBe(false)
  })
})

describe('the verifier-regression alert is not mutable as marketplace noise (AGL-1088)', () => {
  const REGRESSION: AglynNotificationType = 'system.pluginVerifierRegression'

  it('does not live in the Marketplace category', () => {
    // The category IS the prefix, and a staff member mutes Marketplace to
    // stop routine listing-review chatter. Filing this alert there would let
    // an unrelated preference drop "a live plugin now fails the verifier".
    expect(notificationCategory(REGRESSION)).toBe('system')
    expect(notificationCategory(REGRESSION)).not.toBe('marketplace')
  })

  it('survives a staff member who muted marketplace notifications', () => {
    const prefs = { marketplace: false }
    expect(notificationMuted(prefs, 'marketplace.review')).toBe(true)
    expect(notificationMuted(prefs, REGRESSION)).toBe(false)
  })

  it('is still mutable by someone who mutes product and system', () => {
    // Not a loophole worth closing here: the adminAudit record is the
    // durable one, and a category nothing can mute would be a new concept.
    expect(notificationMuted({ system: false }, REGRESSION)).toBe(true)
  })
})

describe('an assigned record is work arriving (AGL-2618)', () => {
  it('files a contact or lead assignment beside the task assignment', () => {
    for (const type of ['content.contactAssigned', 'content.leadAssigned'] as const) {
      expect(notificationCategory(type)).toBe(notificationCategory('content.taskAssigned'))
      expect(NOTIFICATION_TYPE_LABELS[type]).toMatch(/assigned to you$/)
    }
    expect(notificationMuted({ content: false }, 'content.contactAssigned')).toBe(true)
    expect(notificationMuted({ team: false }, 'content.leadAssigned')).toBe(false)
  })
})

describe('a task falling due is work arriving (AGL-2659)', () => {
  it('files the reminder beside the assignment, under the one mute that stops both', () => {
    expect(notificationCategory('content.taskReminder')).toBe(
      notificationCategory('content.taskAssigned'),
    )
    expect(NOTIFICATION_TYPE_LABELS['content.taskReminder']).toBe('Task reminder')
    expect(notificationMuted({ content: false }, 'content.taskReminder')).toBe(true)
    expect(notificationMuted({ billing: false }, 'content.taskReminder')).toBe(false)
    // Default on: no preference at all is a reminder that arrives.
    expect(notificationMuted(undefined, 'content.taskReminder')).toBe(false)
  })
})

describe('per-scope, per-channel notification settings (AGL-3223)', () => {
  const FORM = 'content.formSubmission'

  it('defaults to the console and not the inbox', () => {
    expect(notificationChannelEnabled(undefined, 'console', FORM)).toBe(true)
    expect(notificationChannelEnabled(undefined, 'email', FORM)).toBe(false)
    expect(notificationChannelEnabled({}, 'email', 'billing.invoice')).toBe(false)
  })

  it('lets the narrowest scope that answered decide', () => {
    const settings: NotificationSettings = {
      account: { content: { console: true, email: true } },
      orgs: { 'org-a': { content: { email: false } } },
      hosts: { 'host-1': { content: { email: true } } },
    }
    // The site overrides its workspace, which overrides the account.
    expect(
      notificationChannelEnabled(settings, 'email', FORM, {
        orgId: 'org-a',
        hostId: 'host-1',
      }),
    ).toBe(true)
    // A different site in the same workspace takes the workspace's answer.
    expect(
      notificationChannelEnabled(settings, 'email', FORM, {
        orgId: 'org-a',
        hostId: 'host-2',
      }),
    ).toBe(false)
    // A different workspace takes the account's.
    expect(
      notificationChannelEnabled(settings, 'email', FORM, { orgId: 'org-b' }),
    ).toBe(true)
  })

  it('treats an absent key as inherit rather than as off', () => {
    // `hosts['host-1']` answers for email and says nothing about console, so
    // console must keep falling through to the account's `false` — reading
    // the missing key as off would silence the feed for a site whose owner
    // only ever touched the email column.
    const settings: NotificationSettings = {
      account: { content: { console: false } },
      hosts: { 'host-1': { content: { email: true } } },
    }
    expect(
      notificationChannelEnabled(settings, 'console', FORM, { hostId: 'host-1' }),
    ).toBe(false)
    expect(
      notificationChannelEnabled(settings, 'email', FORM, { hostId: 'host-1' }),
    ).toBe(true)
  })

  it('keeps honouring the flat mute map nothing has migrated', () => {
    const muted = { content: false }
    expect(
      notificationChannelEnabled(undefined, 'console', FORM, undefined, muted),
    ).toBe(false)
    // Console-only: the old map predates the email channel and never said
    // anything about it, so it must not be read as an opt-in or an opt-out.
    expect(
      notificationChannelEnabled(undefined, 'email', FORM, undefined, muted),
    ).toBe(false)
    expect(
      notificationChannelEnabled(
        { account: { content: { email: true } } },
        'email',
        FORM,
        undefined,
        muted,
      ),
    ).toBe(true)
    // And the account layer outranks it, so the first thing a person sets on
    // the new page wins over the mute they set on the old one.
    expect(
      notificationChannelEnabled(
        { account: { content: { console: true } } },
        'console',
        FORM,
        undefined,
        muted,
      ),
    ).toBe(true)
  })

  it('reads one scope without inheritance, for the settings page', () => {
    const settings: NotificationSettings = {
      account: { content: { console: false } },
      orgs: { 'org-a': { billing: { email: true } } },
    }
    expect(
      notificationScopePref(settings, { kind: 'account' }, 'content', 'console'),
    ).toBe(false)
    // Inherit, not off — the page draws these differently and a boolean here
    // would make an untouched cell look like a decision.
    expect(
      notificationScopePref(settings, { kind: 'account' }, 'content', 'email'),
    ).toBeUndefined()
    expect(
      notificationScopePref(
        settings,
        { kind: 'org', id: 'org-a' },
        'billing',
        'email',
      ),
    ).toBe(true)
    expect(
      notificationScopePref(
        settings,
        { kind: 'host', id: 'host-1' },
        'billing',
        'email',
      ),
    ).toBeUndefined()
  })

  it('lists only the scopes that actually hold a decision', () => {
    const settings: NotificationSettings = {
      orgs: {
        'org-b': { content: { email: true } },
        'org-a': { billing: { console: false } },
        // An empty husk — a scope somebody opened and set back to Inherit.
        'org-c': { content: {} },
      },
      hosts: { 'host-1': { content: { email: true } } },
    }
    expect(notificationOverriddenScopes(settings)).toEqual({
      orgIds: ['org-a', 'org-b'],
      hostIds: ['host-1'],
    })
    expect(notificationOverriddenScopes(undefined)).toEqual({
      orgIds: [],
      hostIds: [],
    })
  })

  it('never lets the generic channel mail a digest that mails itself', () => {
    expect(
      NOTIFICATION_SELF_SENT_EMAIL_TYPES.has('content.crmDailyDigest'),
    ).toBe(true)
    expect(
      NOTIFICATION_SELF_SENT_EMAIL_TYPES.has('content.insightsDigest'),
    ).toBe(true)
    expect(NOTIFICATION_SELF_SENT_EMAIL_TYPES.has('content.order')).toBe(false)
  })
})

describe('the platform-growth category (AGL-3225)', () => {
  it('is its own bucket, mutable without dropping a system alert', () => {
    expect(notificationCategory('staff.userSignedUp')).toBe('staff')
    expect(notificationCategory('staff.orgCreated')).toBe('staff')
    // The reason the category exists. `system` is the bucket nobody mutes for
    // noise (AGL-1088), so filing sign-ups there would mean a staff member
    // who stopped the chatter also stopped the verifier regression.
    const quiet = { account: { staff: { console: false } } }
    expect(
      notificationChannelEnabled(quiet, 'console', 'staff.userSignedUp'),
    ).toBe(false)
    expect(
      notificationChannelEnabled(
        quiet,
        'console',
        'system.pluginVerifierRegression',
      ),
    ).toBe(true)
  })

  it('arrives in the console and not the inbox until somebody asks', () => {
    // Console on is the complaint this answers — staff heard nothing at all.
    expect(notificationChannelEnabled(undefined, 'console', 'staff.orgCreated')).toBe(true)
    expect(notificationChannelEnabled(undefined, 'email', 'staff.orgCreated')).toBe(false)
  })

  it('describes itself in words a reader can check against their own feed', () => {
    // The settings page drew seven bare labels, so deciding whether to
    // silence a category meant guessing what was in it (AGL-3251).
    for (const category of [
      'billing',
      'team',
      'content',
      'marketplace',
      'support',
      'system',
      'staff',
    ] as const) {
      expect(NOTIFICATION_CATEGORY_DESCRIPTIONS[category].length).toBeGreaterThan(20)
    }
    // And the staff one says so in its own words, not only in a badge the
    // page draws — a reader who exports or reads this elsewhere still learns
    // that nobody outside staff receives it.
    expect(NOTIFICATION_CATEGORY_DESCRIPTIONS.staff).toContain('staff')
  })

  it('is marked staff-only, so no customer is shown a switch for it', () => {
    expect(STAFF_NOTIFICATION_CATEGORIES.has('staff')).toBe(true)
    for (const category of ['billing', 'team', 'content', 'marketplace', 'support', 'system'] as const) {
      expect(STAFF_NOTIFICATION_CATEGORIES.has(category)).toBe(false)
    }
  })
})

/**
 * Per-TYPE answers at the account scope (AGL-3251).
 *
 * The complaint was that the bucket was the only granularity there was, so
 * quietening one noisy type took its six neighbors with it.
 */
describe('a type can answer for itself', () => {
  const settings = {
    account: { billing: { console: true, email: true } },
    accountTypes: { 'billing.usage': { console: false } },
  } as const

  it('beats its own category', () => {
    expect(
      notificationChannelEnabled(settings, 'console', 'billing.usage'),
    ).toBe(false)
    // Its neighbors are untouched, which is the entire point.
    expect(
      notificationChannelEnabled(settings, 'console', 'billing.invoice'),
    ).toBe(true)
  })

  it('answers only the channel it was set on', () => {
    // The map is tri-state per channel: an absent `email` key still falls
    // through to the category rather than reading the console answer.
    expect(notificationChannelEnabled(settings, 'email', 'billing.usage')).toBe(
      true,
    )
  })

  /**
   * The load-bearing one, and the reason this is not simply "most specific
   * wins". The scope layers answer a different question — "quiet down this
   * one noisy site" — and a type-level opinion about the KIND of thing must
   * not overrule it, or the site override silently stops working for any type
   * the person ever touched.
   */
  it('does not overrule a narrower scope', () => {
    const scoped = {
      ...settings,
      orgs: { 'org-a': { billing: { console: true } } },
      hosts: { 'host-1': { billing: { console: true } } },
    }
    expect(
      notificationChannelEnabled(scoped, 'console', 'billing.usage', {
        orgId: 'org-a',
      }),
    ).toBe(true)
    expect(
      notificationChannelEnabled(scoped, 'console', 'billing.usage', {
        hostId: 'host-1',
      }),
    ).toBe(true)
    // …and still answers where no scope has spoken.
    expect(
      notificationChannelEnabled(scoped, 'console', 'billing.usage', {
        orgId: 'org-unspoken',
      }),
    ).toBe(false)
  })

  it('reads back unresolved, so the page can offer to clear it', () => {
    // A switch drawn from the EFFECTIVE answer cannot say which of the two it
    // is reading, and a person who cannot see that they set something cannot
    // unset it.
    expect(notificationAccountTypePref(settings, 'billing.usage', 'console')).toBe(
      false,
    )
    expect(
      notificationAccountTypePref(settings, 'billing.usage', 'email'),
    ).toBeUndefined()
    expect(
      notificationAccountTypePref(settings, 'billing.invoice', 'console'),
    ).toBeUndefined()
  })

  it('groups the types under the category that governs them', () => {
    const billing = notificationTypesInCategory('billing')
    expect(billing).toContain('billing.invoice')
    expect(billing).toContain('billing.usage')
    expect(billing).not.toContain('team.invite')
    // Derived from the labels rather than a second list, so every type the
    // product has is reachable from exactly one category row.
    const everyType = Object.keys(NOTIFICATION_TYPE_LABELS)
    const grouped = (
      ['billing', 'team', 'content', 'marketplace', 'support', 'system', 'staff'] as const
    ).flatMap((category) => notificationTypesInCategory(category))
    expect(grouped.sort()).toEqual(everyType.sort())
  })
})

/**
 * A staff notification is platform-wide (AGL-3267).
 *
 * The workspace a staff row MENTIONS is its subject, not its audience — the
 * person reading "Acme Co subscribed" is almost never a member of Acme Co.
 */
describe('the staff category cannot be scoped', () => {
  const settings = {
    account: { staff: { console: true } },
    orgs: { 'org-a': { staff: { console: false } } },
    hosts: { 'host-1': { staff: { console: false } } },
    orgTypes: { 'org-a': { 'staff.orgCreated': { console: false } } },
    hostTypes: { 'host-1': { 'staff.orgCreated': { console: false } } },
  } as const

  it('ignores a workspace or site answer, however it was written', () => {
    for (const scope of [{ orgId: 'org-a' }, { hostId: 'host-1' }]) {
      expect(
        notificationChannelEnabled(settings, 'console', 'staff.orgCreated', scope),
      ).toBe(true)
    }
  })

  it('still takes the account answer, which is the one that means something', () => {
    const off = { account: { staff: { console: false } } }
    expect(
      notificationChannelEnabled(off, 'console', 'staff.orgCreated', {
        orgId: 'org-a',
      }),
    ).toBe(false)
    // And per-type at the account scope keeps working for staff rows.
    const oneOff = {
      account: { staff: { console: true } },
      accountTypes: { 'staff.userSignedUp': { console: false } },
    }
    expect(
      notificationChannelEnabled(oneOff, 'console', 'staff.userSignedUp'),
    ).toBe(false)
    expect(
      notificationChannelEnabled(oneOff, 'console', 'staff.orgCreated'),
    ).toBe(true)
  })

  /**
   * The positive control. The same settings shape on a NON-staff type must be
   * honored at both scopes, or this test would pass against a resolver that
   * had simply stopped reading the scope layers for everybody.
   */
  it('THE CONTROL: a non-staff type is still scoped', () => {
    const scoped = {
      account: { billing: { console: true } },
      orgs: { 'org-a': { billing: { console: false } } },
    }
    expect(
      notificationChannelEnabled(scoped, 'console', 'billing.invoice', {
        orgId: 'org-a',
      }),
    ).toBe(false)
  })
})

/**
 * Per-type answers at the workspace and site scopes (AGL-3267) — the fine
 * grain moved to where the noise actually is.
 */
describe('a type can answer for itself at any scope', () => {
  const settings = {
    account: { content: { console: true } },
    orgTypes: { 'org-a': { 'content.formSubmission': { console: false } } },
    hostTypes: { 'host-1': { 'content.formSubmission': { console: false } } },
  } as const

  it('takes the site answer over the workspace and the account', () => {
    expect(
      notificationChannelEnabled(settings, 'console', 'content.formSubmission', {
        orgId: 'org-a',
        hostId: 'host-1',
      }),
    ).toBe(false)
    // A different type from the same category is untouched at that site.
    expect(
      notificationChannelEnabled(settings, 'console', 'content.booking', {
        orgId: 'org-a',
        hostId: 'host-1',
      }),
    ).toBe(true)
  })

  it('beats its own category at the SAME scope, and loses to a narrower one', () => {
    const mixed = {
      account: { content: { console: true } },
      orgTypes: { 'org-a': { 'content.booking': { console: false } } },
      hosts: { 'host-1': { content: { console: true } } },
    }
    // Workspace type answer beats the account category.
    expect(
      notificationChannelEnabled(mixed, 'console', 'content.booking', {
        orgId: 'org-a',
      }),
    ).toBe(false)
    // …and the SITE's category answer, being narrower, beats that type answer.
    expect(
      notificationChannelEnabled(mixed, 'console', 'content.booking', {
        orgId: 'org-a',
        hostId: 'host-1',
      }),
    ).toBe(true)
  })

  it('reads back unresolved, per scope', () => {
    expect(
      notificationScopeTypePref(
        settings,
        { kind: 'org', id: 'org-a' },
        'content.formSubmission',
        'console',
      ),
    ).toBe(false)
    expect(
      notificationScopeTypePref(
        settings,
        { kind: 'org', id: 'org-b' },
        'content.formSubmission',
        'console',
      ),
    ).toBeUndefined()
  })

  /**
   * A scope whose ONLY answer is a per-type one must still be listed, or the
   * person who set it has no way to find it again — which is the whole job of
   * `notificationOverriddenScopes`.
   */
  it('a type-only override still makes its scope findable', () => {
    const found = notificationOverriddenScopes(settings)
    expect(found.orgIds).toContain('org-a')
    expect(found.hostIds).toContain('host-1')
  })

  it('an emptied scope is not listed', () => {
    const empty = { orgTypes: { 'org-a': { 'content.booking': {} } }, orgs: {} }
    expect(notificationOverriddenScopes(empty).orgIds).toEqual([])
  })
})
