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
 * The durable half of presence cleanup (AGL-2486).
 *
 * ## Why anything beyond `onDisconnect` is needed
 *
 * `onDisconnect` is best-effort by construction: a client that loses power
 * never gets to run it, and the server only fires it if it notices the socket
 * close. It was ALSO a one-shot — the SDK clears its local registration when
 * the connection drops and never re-sends it — so before the `.info/connected`
 * re-arm in `use-presence.ts`, the first blip spent the handler and every
 * subsequent close leaked a row. Measured on production RTDB 2026-08-22: ~20
 * dead rows in one project, the oldest four hours old.
 *
 * The re-arm makes leaks rare. It cannot make them impossible, so something
 * has to remove a row the handler failed to remove.
 *
 * ## Why it runs on JOIN rather than on a schedule
 *
 * Presence rows are only ever CREATED by someone opening a document. So a
 * room can only accumulate rows while it is in use, and a room in use is
 * joined — which is the one moment we hold admin credentials and know exactly
 * which room to look at. Sweeping there bounds every room that can still
 * grow; a room nobody opens again keeps at most the residue from its last
 * use, which is finite and does not increase.
 *
 * A cron was the obvious alternative and was rejected on evidence. This repo
 * gates scheduled work behind `CRON_SECRET` and reports it through
 * `cronJobsHealth`, which compares each entry in `SCHEDULED_JOBS` against a
 * heartbeat and reports `job-never-reported` once a fire time passes with no
 * beat. Adding an entry without also registering it in the external scheduler
 * — which this change cannot do — would turn a health probe red. A monitoring
 * surface that lies is worse than an invisible dead row.
 *
 * A client-side sweep was rejected too: the RTDB rules scope a presence write
 * to `auth.uid === $uid`, so a client cannot delete anybody else's row, and
 * loosening that to allow it would be a far larger risk than the leak.
 *
 * ## Nothing here may delete a live session
 *
 * That is the failure that matters — evicting somebody mid-edit re-creates
 * the exact "presence keeps disappearing" symptom this issue started with.
 * Three things make the threshold safe:
 *
 *  - the heartbeat is UNCONDITIONAL now. It used to skip hidden tabs, which
 *    made `lastSeenAt` mean "last looked at" rather than "still open" and left
 *    nothing safe to measure. A background tab now writes every ~60s, the
 *    throttled rate browsers impose.
 *  - the threshold below is 30 minutes: thirty times the slowest beat a live
 *    tab can produce.
 *  - and it is recoverable even if it were wrong. A tab whose row is removed
 *    re-announces on its next `.info/connected` event, and its next heartbeat
 *    rewrites the row outright because the beat now carries `displayName` as
 *    well as `lastSeenAt` — the two fields the rules require. Being too eager
 *    costs one heartbeat of invisibility, not a lost session.
 */

/**
 * How stale a row must be before the server deletes it.
 *
 * 30 minutes against a worst-case 60s beat. Deliberately an order of
 * magnitude above `PRESENCE_STALE_MS` (150s, the DISPLAY rule): being wrong
 * about display hides someone for a moment, being wrong about deletion
 * removes them from everyone's screen.
 */
export const PRESENCE_REAP_AFTER_MS = 30 * 60_000

/** One presence row, as the room holds it. */
interface RoomEntry {
  lastSeenAt?: unknown
}

/**
 * Which `${uid}/${sessionId}` keys in a room are provably dead.
 *
 * Pure and exported so the threshold can be exercised at a fixed clock
 * instead of inferred from a live sweep — the boundary either side of "is
 * this session alive" is the part that must not be got wrong, and it is the
 * part a live test is least able to pin down.
 *
 * A row with no usable `lastSeenAt` is treated as age zero and KEPT. It
 * cannot be shown to be dead, and the safe direction here is to leave a row
 * that should have gone rather than remove one that should have stayed.
 */
export function deadSessionKeys(
  room: Record<string, Record<string, RoomEntry>> | null | undefined,
  now: number,
  olderThanMs: number = PRESENCE_REAP_AFTER_MS,
): string[] {
  const dead: string[] = []
  const cutoff = now - olderThanMs
  for (const [uid, sessions] of Object.entries(room ?? {})) {
    if (!sessions || typeof sessions !== 'object') continue
    for (const [sessionId, entry] of Object.entries(sessions)) {
      if (!entry || typeof entry !== 'object') continue
      const lastSeenAt = (entry as RoomEntry).lastSeenAt
      // `typeof`, not a truthy test: `strictNullChecks` is off repo-wide, and
      // a row whose stamp is missing or malformed must be kept, not reaped.
      if (typeof lastSeenAt !== 'number' || !Number.isFinite(lastSeenAt)) {
        continue
      }
      if (lastSeenAt < cutoff) dead.push(`${uid}/${sessionId}`)
    }
  }
  return dead
}
