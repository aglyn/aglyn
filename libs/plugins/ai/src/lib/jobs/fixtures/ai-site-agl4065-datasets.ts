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

import type { AiBuildPlanCreate, AiBuildPlanScreen } from '../../model/ai-build-plan'

/**
 * RECORDED, NOT GOLDEN (AGL-4065): what two of the 2026-10-25 booth-kit
 * guided starts in the test workspace planned and answered, for the offline
 * replays of Lane B. Both businesses are fictional. No contact detail,
 * address, person, workspace or site id is kept: screen ids are this
 * fixture's own.
 *
 *  - RUT RUNNERS RACING, an amateur motocross team (`siteKind: fitness`): its
 *    plan's five pages and its "Race events" dataset. The job dump keeps only
 *    the dataset's record NAMES and which fields most records left empty
 *    (date, track, location, class, result: every one); the values beside the
 *    names are reconstructed from those, Status being "Upcoming" or "Past" as
 *    the names said.
 *  - BERM & BOLT MOTO PARTS, a dirt bike and ATV parts shop (`siteKind:
 *    store`): its inputs, its plan's five pages and its first products'
 *    names. The dump keeps the products' names only; the rest of each
 *    proposed product is reconstructed in the catalog tool's shape.
 */

/** The Rut Runners plan's "Race events" creation, as planned. */
export const RUT_RUNNERS_RACE_EVENTS: AiBuildPlanCreate = {
  kind: 'dataset',
  name: 'Race events',
  why: 'The race schedule and results are a list of similar events that no listed dataset covers.',
  duplicateOf: null,
  fields: ['Event', 'Date', 'Track', 'Location', 'Class', 'Result', 'Status'],
  id: 'fxRaceEvts',
}

/** The Rut Runners plan's "Riders" creation, as planned. */
export const RUT_RUNNERS_RIDERS: AiBuildPlanCreate = {
  kind: 'dataset',
  name: 'Riders',
  why: 'Rider profiles are a list of 4 or more similar items and none of the listed datasets hold riders.',
  duplicateOf: null,
  fields: ['Name', 'Age class', 'Bike number', 'Bike', 'Home town', 'Bio'],
  id: 'fxRiders01',
}

const page = (
  id: string,
  title: string,
  slug: string,
  sections: Array<[string, string[], number]>,
): AiBuildPlanScreen => ({
  id,
  title,
  slug,
  layout: 'new:Team site layout',
  template: null,
  duplicateOf: null,
  nav: true,
  seoTitle: title,
  seoDescription: title,
  record: null,
  sections: sections.map(([name, uses, items]) => ({ name, uses, items })),
})

/** The Rut Runners plan's pages, as planned (titles, addresses and sections). */
export const RUT_RUNNERS_SCREENS: AiBuildPlanScreen[] = [
  page('fxHome', 'Home', '/', [
    ['Hero: built in Lockhart, raced across Texas', [], 0],
    ['How to get started with the team', [], 4],
    ['Riders and programs', ['new:Riders'], 4],
    ['The team at the track in pictures', [], 6],
    ['Next races', ['new:Race events'], 4],
    ['Questions people ask, answered', [], 5],
    ['Call to action: sponsor or join', [], 0],
  ]),
  page('fxRiders', 'Riders', '/riders', [
    ['Page intro', [], 0],
    ['Rider profiles', ['new:Riders'], 6],
    ['How young riders join', [], 3],
    ['Call to action: ask about joining', [], 0],
  ]),
  page('fxSchedule', 'Schedule and Results', '/schedule-results', [
    ['Page intro', [], 0],
    ['Upcoming races', ['new:Race events'], 5],
    ['Past results', ['new:Race events'], 5],
    ['Race day for families: what to expect', [], 4],
  ]),
  page('fxSponsors', 'Sponsors', '/sponsors', [
    ['Page intro: thank you to our sponsors', [], 0],
    ['Sponsor wall', [], 6],
    ['What sponsoring a rider is like', [], 4],
    ['Sponsorship questions answered', [], 4],
    ['Call to action: become a sponsor', [], 0],
  ]),
  page('fxContact', 'Contact and Sponsor Inquiries', '/contact', [
    ['Page intro: how to reach the team', [], 0],
    ['Inquiry form', ['new:Get in touch form'], 0],
    ['Where to find us and contact details', [], 3],
  ]),
]

/** The site's words the dataset unit's brief opened with (the guided start's brief; no contact details). */
export const RUT_RUNNERS_BRIEF =
  'A 5-page website for Amateur motocross race team: rider profiles, race schedule and results, sponsors, and sponsor inquiries. It is for Local businesses that sponsor riders, race fans and families following the team, and young riders who want to join. Make it a fitness & sports site.'

const RACE_FIELDS = RUT_RUNNERS_RACE_EVENTS.fields.map((name) => ({ name, type: 'text' }))

/** One record as the `submit_dataset` tool answers it: a value per field, in order. */
const race = (event: string, values: Partial<Record<'date' | 'track' | 'location' | 'klass' | 'result', string>>, status: string) => ({
  values: [event, values.date ?? '', values.track ?? '', values.location ?? '', values.klass ?? '', values.result ?? '', status],
})

/**
 * The "Race events" answer of 2026-10-25, through the tool: the seven
 * planned fields and ten numbered placeholders, every value beside the name
 * left empty but the Status the name gave.
 */
export const RACE_EVENTS_PLACEHOLDER_ANSWER = {
  fields: RACE_FIELDS,
  records: [
    ...[1, 2, 3, 4, 5].map((n) => race(`Upcoming race ${n} (details to be added)`, {}, 'Upcoming')),
    ...[1, 2, 3, 4, 5].map((n) => race(`Past race ${n} (details to be added)`, {}, 'Past')),
  ],
}

/** An answer with the fields and no records: what a start that keeps no samples writes. */
export const RACE_EVENTS_EMPTY_ANSWER = { fields: RACE_FIELDS, records: [] as Array<{ values: string[] }> }

/** One sample record as the tool answers it: complete of its kind, its date left for the platform. */
const sampleRace = (event: string, values: Partial<Record<'track' | 'location' | 'klass' | 'result', string>>, status: string) => ({
  ...race(event, values, status),
  sample: true,
})

/**
 * The re-ask's answer under the decided rule (AGL-4065): SAMPLES for the
 * owner to replace, each complete of its kind in the brief's own words — a
 * fictional series at a fictional track — marked sample, three to come and
 * two behind, the dates left "" for the platform to set.
 */
export const RACE_EVENTS_SAMPLE_ANSWER = {
  fields: RACE_FIELDS,
  records: [
    sampleRace('Hill Country Series Round 1', { track: 'Cedar Hollow MX', location: 'Central Texas', klass: '250 Intermediate' }, 'Upcoming'),
    sampleRace('Hill Country Series Round 2', { track: 'Red Mesa Raceway', location: 'Central Texas', klass: 'Youth 85cc' }, 'Upcoming'),
    sampleRace('Hill Country Series Round 3', { track: 'Cedar Hollow MX', location: 'Central Texas', klass: 'Adult amateur', result: 'Top ten' }, 'Upcoming'),
    sampleRace('Fall Classic at Red Mesa', { track: 'Red Mesa Raceway', location: 'Central Texas', klass: '250 Intermediate', result: 'Two riders on the podium' }, 'Past'),
    sampleRace('Season opener at Cedar Hollow', { track: 'Cedar Hollow MX', location: 'Central Texas', klass: 'Youth 85cc', result: 'Fifth in the main' }, 'Past'),
  ],
}

/** A sample answer that numbers stand-ins: what the validator still refuses. */
export const ITEMS_ANSWER = {
  fields: RACE_FIELDS,
  records: [1, 2, 3].map((n) => ({ ...race(`Item ${n}`, { track: 'Cedar Hollow MX', klass: 'Open' }, 'Upcoming'), sample: true })),
}

/**
 * A second recording's shape (AGL-4065): three races a brief could give —
 * fictional tracks — beside two numbered placeholders.
 */
export const RACE_EVENTS_MIXED_ANSWER = {
  fields: RACE_FIELDS,
  records: [
    race('Spring opener', { track: 'Cedar Hollow MX', klass: '250 Intermediate' }, 'Upcoming'),
    race('Summer night series', { track: 'Red Mesa Raceway', klass: 'Youth 85cc' }, 'Upcoming'),
    race('Fall finale', { track: 'Cedar Hollow MX', klass: '250 Intermediate' }, 'Past'),
    race('Upcoming race 4 (details to be added)', {}, 'Upcoming'),
    race('Past race 5 (details to be added)', {}, 'Past'),
  ],
}

/** The Riders answer's names as the 2026-10-25 start wrote them: roles, never numbered, each with a bio. */
export const RIDERS_ANSWER = {
  fields: RUT_RUNNERS_RIDERS.fields.map((name) => ({ name, type: 'text' })),
  records: ['Mini rider', 'Junior rider', 'Youth rider', 'Intermediate rider', 'Adult amateur rider', 'Team captain'].map((name) => ({
    values: [name, '', '', '', '', `A ${name.toLowerCase()} on the team, racing amateur motocross across Central Texas.`],
  })),
}

/** A list whose records are numbered and real: a course's levels, each described. */
export const LEVELS_ANSWER = {
  fields: [
    { name: 'Class', type: 'text' },
    { name: 'Description', type: 'text' },
  ],
  records: [
    { values: ['Level 1', 'First laps on a small bike: throttle, brakes and body position on flat ground.'] },
    { values: ['Level 2', 'Corners, ruts and small jumps, with a coach beside the track.'] },
    { values: ['Level 3', 'Starts, whoops and race lines for riders ready for their first race.'] },
  ],
}

/** The Berm & Bolt start's inputs, as the guided start sent them (no contact details). */
export const BERM_BOLT_INPUTS = {
  businessType: 'Dirt bike and ATV parts shop: OEM and aftermarket parts, tires, riding gear, special orders; in-store pickup',
  audience: 'Weekend riders, motocross racers and ranch ATV owners around Kyle who need parts fast and real advice',
  starter: 'physical-shop',
  siteKind: 'store',
  pages: 5,
  businessName: 'Berm & Bolt Moto Parts',
  city: 'Kyle',
  submissions: 'inbox',
  welcomeEmail: true,
}

/** The Berm & Bolt start's brief. */
export const BERM_BOLT_BRIEF =
  'A 5-page website for Dirt bike and ATV parts shop: OEM and aftermarket parts, tires, riding gear, special orders; in-store pickup. It is for Weekend riders, motocross racers and ranch ATV owners around Kyle who need parts fast and real advice. Make it a online store site.'

const storePage = (id: string, title: string, slug: string, sections: Array<[string, string[], number]>): AiBuildPlanScreen => ({
  ...page(id, title, slug, sections),
  layout: 'new:Storefront layout',
})

/** The Berm & Bolt plan's pages, as planned. */
export const BERM_BOLT_SCREENS: AiBuildPlanScreen[] = [
  storePage('fxStoreHome', 'Home', '/', [
    ['Hero: the right part before the weekend', [], 0],
    ['Shop by collection', [], 4],
    ['Bestsellers', [], 0],
    ['Why buy here', [], 4],
    ['Our story', [], 0],
    ['Customer reviews', [], 0],
    ['Newsletter sign-up', ['new:Parts inquiry form'], 0],
  ]),
  storePage('fxStoreShop', 'Shop', '/shop', [
    ['Shop title and intro', [], 0],
    ['Product grid', [], 0],
    ['In-store pickup and shipping help', [], 3],
  ]),
  storePage('fxStoreSpecial', 'Special Orders & Fitment', '/special-orders', [
    ['Special orders intro', [], 0],
    ['How a special order works', [], 4],
    ['What we can source', ['new:Parts categories'], 5],
    ['Fitment questions and contact button', [], 0],
  ]),
  storePage('fxStoreAbout', 'About', '/about', [
    ['About intro', [], 0],
    ['Our story since 2018', [], 0],
    ['Who we serve', [], 3],
    ['Areas we serve', [], 5],
    ['Visit the shop button', [], 0],
  ]),
  storePage('fxStoreContact', 'Contact', '/contact', [
    ['Contact intro', [], 0],
    ['Parts inquiry form', ['new:Parts inquiry form'], 0],
    ['Shop details: address, phone, hours, pickup', [], 4],
  ]),
]

/** The Berm & Bolt plan's form, as planned. */
export const BERM_BOLT_FORM: AiBuildPlanCreate = {
  kind: 'form',
  name: 'Parts inquiry form',
  why: 'No saved form exists; visitors need to ask about parts, fitment and special orders.',
  duplicateOf: null,
  fields: ['name', 'email', 'phone', 'inquiry type', 'bike or ATV make', 'model', 'year', 'part or question', 'pickup preferred', 'consent'],
  writesTo: 'new:Parts inquiries',
  id: 'fxPartsForm',
}

/** One proposed product in the catalog tool's shape. */
const product = (name: string, price: number) => ({
  name,
  type: 'physical',
  description: `${name} for dirt bikes and ATVs, ready for pickup in the shop.`,
  tags: ['dirt bike', 'atv'],
  options: [],
  seoTitle: name,
  seoDescription: `${name} at Berm & Bolt Moto Parts.`,
  photo: `A ${name.toLowerCase()} on a workbench.`,
  price,
})

/** The six names the 2026-10-25 catalog proposed, which the store listed at suggested prices. */
export const BERM_BOLT_CATALOG_NAMES = [
  'OEM Dirt Bike Parts Order',
  'OEM ATV Parts Order',
  'Aftermarket Dirt Bike Part',
  'Dirt Bike Tire',
  'ATV Tire',
  'Riding Gear Item',
] as const

/** The catalog answer of 2026-10-25, reconstructed around its six names. */
export const BERM_BOLT_CATALOG_ANSWER = {
  products: BERM_BOLT_CATALOG_NAMES.map((name, index) => product(name, [40, 40, 35, 95, 120, 60][index] as number)),
}

/** A catalog answer that names each sample as a plain item of its kind. */
export const BERM_BOLT_SAMPLE_ANSWER = {
  products: [product('Dirt bike brake pads', 35), product('Knobby dirt bike tire', 95), product('Motocross helmet', 180)],
}
