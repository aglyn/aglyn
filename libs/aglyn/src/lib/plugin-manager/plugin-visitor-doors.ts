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
 * A PLUGIN'S PUBLIC DOOR, AS ITS OWNER AND STAFF SEE IT WHEN IT IS FLOODED
 * (AGL-1666, AGL-1831, AGL-3080).
 *
 * A plugin that keeps a public door a visitor writes through — the forms
 * plugin's `/api/forms/submit` — caps a flood with a monthly ceiling and
 * drops what its honeypot catches, and counts both per site in
 * `hosts/{hostId}/counters/{counter}`, keyed by `utcMonthKey`. The site's
 * owner reads those counts where the door's traffic lands (the Inbox), and
 * staff read them on the organization's Sites card. Neither surface may name
 * the plugin, and neither loads it: so the plugin DECLARES its door in
 * `plugins.config.json` (`visitorDoors`) — the two counters and the words —
 * the manifest generator compiles it, and the surfaces read every declared
 * door the same way.
 *
 * The sentences are built here, from the declared nouns, because their
 * discipline is the platform's and not a door's: nothing renders below one
 * refusal or one catch (a counter document persists from its first trip, and
 * "0 refused" every month trains a reader to ignore the row that will one day
 * be real); a refusal is never billed and the owner is told so first; and the
 * date a monthly ceiling lifts is rendered in UTC, the zone its key rolls
 * over in.
 */

import { PLUGIN_VISITOR_DOORS_DECLARED } from './first-party-plugins.generated'
import { nextUtcMonthStart } from '../app-utils/utc-month'

/** A noun in its two counts: `{ one: 'submission', other: 'submissions' }`. */
export interface VisitorDoorNoun {
  one: string
  other: string
}

export interface VisitorDoorDeclaration {
  /** The door's name, as lockdown and the intake gates name it: `form`. */
  door: string
  /** The site counter the door's ceiling refusals are kept in, by month. */
  refusedCounter: string
  /** The site counter the door's honeypot catches are kept in, by month. */
  caughtCounter: string
  words: {
    /** The owner's notice title: "Form submissions are paused". */
    pausedTitle: string
    /** What the door takes in: submission / submissions. */
    noun: VisitorDoorNoun
    /** The same to staff, who see every door: form submission(s). */
    staffNoun: VisitorDoorNoun
    /** Why it usually happens and what to do — the notice's last sentence. */
    cause: string
    /** The staff flag's label for a door refusing now: "forms paused". */
    pausedChip: string
    /** What the honeypot catches: bot submission(s). */
    caught: VisitorDoorNoun
    /** What caught them: "the honeypot". */
    caughtBy: string
    /** The staff flag's noun for a catch: bot hit(s). */
    caughtChip: VisitorDoorNoun
  }
}

/** A declaration with the plugin that keeps the door. */
export type ResolvedVisitorDoor = VisitorDoorDeclaration & { pluginId: string }

/** A door's counts for one site and month, as a staff join reads them. */
export interface VisitorDoorCounts {
  /** The month the counts are for — `utcMonthKey()`. */
  month: string
  /** Refused by the ceiling this month. */
  refused: number
  /** The ceiling the counter recorded when it tripped, when known. */
  ceiling: number | null
  /** Caught by the honeypot this month. */
  caught: number
}

/** What the site's owner is shown while a door is refusing. */
export interface VisitorDoorPausedNotice {
  title: string
  /** What happened, how many, and that none of it is billed. */
  message: string
  /** When it lifts, as a sentence — never a raw month key. */
  until: string
}

/** Every declared door, in the order the plugins are configured. */
export function pluginVisitorDoors(): readonly ResolvedVisitorDoor[] {
  return PLUGIN_VISITOR_DOORS_DECLARED
}

const count = (value: unknown): number => Math.floor(Number(value) || 0)
const said = (noun: VisitorDoorNoun, n: number): string => (n === 1 ? noun.one : noun.other)
const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** The day a monthly ceiling lifts, in UTC: a reader-zone date would be a day early in the Americas. */
function liftsOn(now: Date): string {
  return nextUtcMonthStart(now).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * The owner's notice for a door refusing this month, or `null` below one
 * refusal. `ceiling` is the one the counter recorded, when it did.
 */
export function visitorDoorPausedNotice(
  door: VisitorDoorDeclaration,
  input: { refused: number; ceiling?: number; now?: Date },
): VisitorDoorPausedNotice | null {
  const refused = count(input.refused)
  if (refused < 1) return null
  const { words } = door
  const ceiling =
    typeof input.ceiling === 'number' && Number.isFinite(input.ceiling)
      ? Math.floor(input.ceiling)
      : undefined
  return {
    title: words.pausedTitle,
    message:
      `${refused.toLocaleString()} ${said(words.noun, refused)} ` +
      `to this site ${refused === 1 ? 'has' : 'have'} been refused this month` +
      (ceiling ? ` after it passed ${ceiling.toLocaleString()} ${words.noun.other}` : '') +
      `. Refused ${words.noun.other} are not stored and are not billed. ${words.cause}`,
    until: `${capitalized(words.noun.other)} start being accepted again on ${liftsOn(input.now ?? new Date())}.`,
  }
}

/**
 * The month's honeypot catches as one sentence, or `null` below one catch.
 * It reports protection WORKING — caught and dropped, nothing stored or
 * billed — so it never reads as an alarm.
 */
export function visitorDoorCaughtNotice(
  door: VisitorDoorDeclaration,
  input: { caught: number },
): string | null {
  const caught = count(input.caught)
  if (caught < 1) return null
  const { words } = door
  return (
    `${caught.toLocaleString()} ${said(words.caught, caught)} ` +
    `${caught === 1 ? 'was' : 'were'} caught and dropped by ${words.caughtBy} ` +
    'this month — nothing was stored or billed.'
  )
}

/** One staff flag: the chip's terse label, and the sentence behind it. */
export interface VisitorDoorStaffFlag {
  label: string
  detail: string
}

/**
 * The staff Sites card's flags for one door on one site: a refusing door, and
 * the month's catches, each only from one up. Terse labels on purpose — the
 * owner's wording is for owners — with the ceiling and the date it lifts in
 * the detail.
 */
export function visitorDoorStaffFlags(
  door: VisitorDoorDeclaration,
  counts: Pick<VisitorDoorCounts, 'refused' | 'ceiling' | 'caught'> | null | undefined,
  now: Date = new Date(),
): { refused: VisitorDoorStaffFlag | null; caught: VisitorDoorStaffFlag | null } {
  if (!counts) return { refused: null, caught: null }
  const refused = count(counts.refused)
  const caught = count(counts.caught)
  const { words } = door
  const ceiling =
    typeof counts.ceiling === 'number' && Number.isFinite(counts.ceiling)
      ? Math.floor(counts.ceiling)
      : null
  const caughtDetail = visitorDoorCaughtNotice(door, { caught })
  return {
    refused:
      refused >= 1
        ? {
            label: `${words.pausedChip} · ${refused.toLocaleString()} refused`,
            detail:
              `${refused.toLocaleString()} ${said(words.staffNoun, refused)} refused this month` +
              (ceiling ? ` — the site passed its ${ceiling.toLocaleString()}-${words.noun.one} ceiling` : '') +
              `. Nothing refused is stored or billed. Accepting again on ${liftsOn(now)}.`,
          }
        : null,
    caught:
      caught >= 1 && caughtDetail
        ? { label: `${caught.toLocaleString()} ${said(words.caughtChip, caught)} caught`, detail: caughtDetail }
        : null,
  }
}
