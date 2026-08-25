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
'use client'

import { mdiAlertCircleOutline, mdiMonitorMultiple } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Avatar,
  AvatarGroup,
  Box,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { type MouseEvent, useState } from 'react'
import DocsHelpTip from './docs-help-tip.component'
import MemberAvatar, { memberInitials } from './member-avatar.component'
import {
  presenceFaultNotice,
  type PresenceEntry,
  type PresenceState,
} from '../hooks/use-presence'

/**
 * Initials for a presence entry, delegated to the ONE member-avatar answer
 * (AGL-2486).
 *
 * This file used to carry its own `initialsFor`, which split on whitespace.
 * `MemberAvatar` already had `memberInitials`, built on `splitDisplayName`
 * (AGL-1127) — the console's existing answer to "one provider string, two
 * name fields" — and it also falls back to the local part of an email, which
 * the whitespace split rendered as `?` for every invited-but-unnamed account.
 * Two parsers for one job is how a person ends up with two different sets of
 * initials on two screens.
 */
export function initialsFor(displayName: string): string {
  return memberInitials(displayName)
}

/**
 * Who else is in this document (AGL-675, AGL-2486).
 *
 * Renders nothing when you are alone AND presence is healthy — an empty slot
 * in the app bar of a single-player session is noise, and this must never
 * read as a status indicator that is "working" but showing zero.
 *
 * It does render when presence is BROKEN, which is the whole difference.
 * "Nobody else is here" and "presence never started" used to be the same
 * picture: an empty app bar. Zach opened two browsers, saw no sign of the
 * other, and had no way to tell which of those two things he was looking at.
 *
 * Deliberately NOT a lock, and the tooltip says so. Seeing a face makes
 * people coordinate socially, which avoids most collisions; but the thing
 * that actually protects their work is the concurrent-edit guard (AGL-674),
 * which shipped first for exactly this reason.
 */
export function PresenceAvatars({ presence }: { presence: PresenceState }) {
  const { entries, status } = presence
  if (
    status === 'unauthorized' ||
    status === 'error' ||
    status === 'unconfigured'
  ) {
    return <PresenceFaultBadge presence={presence} />
  }
  if (!entries.length) return null
  return <RoomAvatars entries={entries} />
}

/**
 * Presence is off, and says what to do about it (AGL-2486).
 *
 * ## What changed, and why
 *
 * This badge previously led with `Failed at: broker (500)`. Zach: "what does
 * this mean? It gives the users no course of action on how to fix it." A
 * stage name and an HTTP status are the two things a customer can do least
 * with, and they were the whole sentence.
 *
 * So the order is inverted. The lead is what happened in the reader's terms
 * and what they can do about it; the caution Zach kept — an empty stack is
 * NOT proof you are alone — stays on every branch; and stage/code/message
 * move behind a details affordance, still one click away for whoever is
 * debugging this, no longer in the way of whoever is not.
 *
 * ## Why the detail is not just a longer tooltip
 *
 * A tooltip long enough to hold the remedy AND the technical detail is a
 * tooltip nobody reaches the end of. The detail is also the part people need
 * to COPY into a support message, which a hover-only surface cannot give
 * them. Hence a click-latched popover.
 *
 * ## Not-a-bug is drawn differently
 *
 * `unconfigured` gets a neutral colour and no alarm. A deployment that never
 * configured a Realtime Database is behaving exactly as its operator set it
 * up; painting that the same warning colour as a live outage is how people
 * learn to ignore the warning colour.
 */
function PresenceFaultBadge({ presence }: { presence: PresenceState }) {
  const { status, fault } = presence
  const notice = presenceFaultNotice(fault)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const notABug = status === 'unconfigured'
  return (
    <>
      <Tooltip
        title={
          <Box>
            <Box sx={{ fontWeight: 600 }}>{notice.title}</Box>
            <Box sx={{ mt: 0.5 }}>{notice.remedy}</Box>
            <Box sx={{ mt: 0.5 }}>{notice.caution}</Box>
            <Box sx={{ mt: 0.5, opacity: 0.75 }}>
              Click for technical details.
            </Box>
          </Box>
        }
      >
        <Avatar
          component="button"
          onClick={(event: MouseEvent<HTMLElement>) =>
            setAnchor(anchor ? null : event.currentTarget)
          }
          data-aglyn-presence-fault={fault ? fault.stage : 'unknown'}
          data-aglyn-presence-fault-kind={fault ? fault.kind : 'broken'}
          aria-label={
            notABug
              ? 'Live collaboration is not set up on this deployment'
              : 'Live collaboration is unavailable'
          }
          sx={{
            width: 28,
            height: 28,
            mr: 1,
            border: 0,
            p: 0,
            cursor: 'pointer',
            bgcolor: notABug ? 'action.selected' : 'warning.main',
            color: notABug ? 'text.secondary' : 'warning.contrastText',
          }}
        >
          <MdiIcon path={mdiAlertCircleOutline.path} size={0.7} />
        </Avatar>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 2, maxWidth: 360 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {notice.title}
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {notice.remedy}
          </Typography>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            {notice.caution}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Technical details
          </Typography>
          <Box
            component="pre"
            data-aglyn-presence-fault-detail=""
            sx={{
              m: 0,
              mt: 0.5,
              p: 1,
              borderRadius: 1,
              bgcolor: 'action.hover',
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {notice.detail || 'No further detail was reported.'}
          </Box>
        </Box>
      </Popover>
    </>
  )
}

/**
 * How many sessions get their own avatar before the rest become a count.
 *
 * Six, not four: with one avatar PER SESSION rather than per person, a pair
 * working in two windows each already fills four slots, and collapsing at
 * that point would hide exactly the thing Zach asked to be able to see.
 */
const MAX_VISIBLE_SESSIONS = 6

/**
 * One avatar per open SESSION (AGL-2486).
 *
 * Zach: "We should also see the same avatar repeated for each of its active
 * sessions all with a different presence color not just consolidated into
 * one." So the same face appears once per window that has this document
 * open — yours and everyone else's alike — each in the colour that session
 * draws its cursor and its selection box in. The stack and the canvas are
 * then readable against each other: the orange caret belongs to the orange
 * avatar.
 *
 * ## Spacing
 *
 * OVERLAPPED, and the rings hug the circle (AGL-2486). An earlier pass read
 * "weird spacing" as ring collision and answered it with a gap; Zach meant
 * the opposite — "We also need to make them overlap, that wasn't what I meant
 * by there is a weird spacing issue, I meant the orange border that seemed to
 * have padding."
 *
 * So the ring sits ON the circle's edge rather than 2px off it — that gap was
 * the "padding" — and the chips overlap the way a stacked avatar group does.
 * Overlapping is only legible because every session carries its OWN ring
 * colour: two sessions of one person are the same face, and the ring is what
 * tells them apart, so it has to be the part that stays visible. The earlier
 * chips are stacked on top, so each ring is drawn over its neighbour rather
 * than under it.
 *
 * PADDING for the outer spacing, never margin. This sits inside a MUI `Stack`
 * whose own child-spacing rule (`& > :not(style) ~ :not(style)`) sets the
 * children's margins and outranks `sx` — measured, `mr: 1.5` computed to
 * `0px` while the left spacing came from the parent rather than from this
 * component at all. Padding is untouched by that rule, so it is the one that
 * holds, and it is symmetric: Zach saw "the enormous right margin and very
 * small left margin".
 */
function RoomAvatars({ entries }: { entries: PresenceEntry[] }) {
  const visible = entries.slice(0, MAX_VISIBLE_SESSIONS)
  const overflow = entries.length - visible.length
  return (
    <Stack
      direction="row"
      sx={{ alignItems: 'center', px: 1 }}
      data-aglyn-presence-sessions={String(entries.length)}
    >
      {visible.map((entry, index) => (
        <Tooltip key={entry.key} title={describe(entry)}>
          <Box
            sx={{
              position: 'relative',
              display: 'inline-flex',
              // The overlap. Left-to-right reading order is preserved and the
              // EARLIER chip is on top, so a ring is never half-covered by
              // the neighbour that comes after it.
              ...(index > 0 && { ml: -0.75 }),
              zIndex: visible.length - index,
            }}
          >
            <MemberAvatar
              // `|| 'Someone'` belt-and-braces with the `projectRoom` guard
              // that already drops nameless rows (AGL-2486). A chip is the one
              // place a missing name is unrecoverable — `memberInitials`
              // renders `?`, which reads as a broken avatar rather than as a
              // person — so the last defence lives at the point of use.
              name={entry.displayName || 'Someone'}
              photoURL={entry.photoURL}
              colour={entry.colour}
              size={28}
              data-aglyn-presence-session={entry.key}
              data-aglyn-presence-self={entry.isSelf ? '' : undefined}
              // DASHED for your own other sessions, in that session's own
              // colour, to match the canvas (AGL-2486). Zach: "go ahead and
              // go back to the dashed border on the avatars when it is you in
              // the other tabs so it matches what appears in the canvas."
              //
              // `collaborator-overlays` draws the selection outline for the
              // same session dashed, from the same `entry.colour`, so the
              // chip and the outline are now one visual statement about one
              // session. Making this solid did not remove a redundant signal;
              // it made two surfaces disagree.
              ringStyle={entry.isSelf ? 'dashed' : 'solid'}
            />
            {entry.isSelf ? (
              <Box
                // The ONLY thing that distinguishes one of your own sessions
                // from a colleague's (AGL-2486), now that every ring is drawn
                // identically. Tagged so a spec can assert that property
                // rather than assert the ring style that used to carry it.
                data-aglyn-presence-self-badge=""
                aria-hidden
                sx={{
                  position: 'absolute',
                  right: -3,
                  bottom: -3,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'warning.main',
                  color: 'warning.contrastText',
                }}
              >
                <MdiIcon path={mdiMonitorMultiple.path} size={0.4} />
              </Box>
            ) : null}
          </Box>
        </Tooltip>
      ))}
      {overflow > 0 ? (
        <Tooltip
          title={`${overflow} more session${overflow === 1 ? '' : 's'} has this document open.`}
        >
          <Avatar
            data-aglyn-presence-overflow={String(overflow)}
            sx={{
              width: 28,
              height: 28,
              fontSize: 11,
              fontWeight: 600,
              bgcolor: 'action.selected',
              color: 'text.secondary',
              // The overflow chip is in the row too, so it has to be the same
              // SIZE as the row (AGL-2486). A ring paints 2px outside the
              // circle, so without one this chip sat 4px smaller than every
              // session beside it — the same unevenness Zach reported, on the
              // one chip that is not a `MemberAvatar` and so was not fixed by
              // fixing that component. Found by measuring the live stack; the
              // unit test for the avatar could not have seen it.
              //
              // In its OWN background colour, because it represents no session
              // and has no identity colour to show. It reads as a plain disc,
              // just one the same size as its neighbours.
              outline: '2px solid',
              outlineColor: (theme) => theme.palette.action.selected,
              outlineOffset: 0,
            }}
          >
            {`+${overflow}`}
          </Avatar>
        </Tooltip>
      ) : null}
      {/* The one route from presence to its documentation (AGL-2486).
          `liveCoEditing` was a registered help topic with ELEVEN anchors and
          not a single call site anywhere in the product — the `API_SCOPES`
          shape again, where a typed, generated promise of a help link reads
          as coverage and its absence is the only symptom.

          It belongs here rather than on a list row: the per-chip tooltips
          answer "who is this", and the questions they raise instead — what a
          room is, why a colleague on another version is invisible, whether
          any of this locks the document — are exactly the page's headings.
          A row-level tip would repeat that on every row of every list.

          Rendered only alongside real sessions, since `RoomAvatars` is not
          mounted when you are alone; an explanation of who is here has
          nothing to explain to someone working by themselves. */}
      <DocsHelpTip
        topic="liveCoEditing"
        anchor="#whos-here"
        title="Who else is here"
        excerpt="One avatar per editing session, in that session's color. A room is one VERSION of a document, so someone editing a different version will not appear."
        sx={{ ml: 0.5, fontSize: '0.9em' }}
      />
    </Stack>
  )
}

/**
 * What the tooltip says about ONE session (AGL-2486).
 *
 * ## Why this no longer says "saves are not merged"
 *
 * Zach: *"Why are saves not merged? Isn't this the point of being able to
 * collaborate together and build a page alongside someone at the same
 * time"* — and again, on the guard that stopped him: *"any user
 * collaborating should be able to save as they all go along and make
 * changes... there should be no problem with this"*.
 *
 * The old copy described the STORAGE and presented it as the experience.
 * The unit of live collaboration is a node (`use-coediting`, AGL-677), so
 * two people on different elements both keep their work; and the save guard
 * now asks whether this document INCORPORATES what is stored rather than
 * whether the stored version moved, so in a converged room either of you
 * can save, in any order, as often as you like.
 *
 * ## What it still has to admit
 *
 * The same element changed at the same time is last-writer-wins. Co-editing
 * shares a node; it does not merge two versions of one. That limit is real
 * and stated — a tooltip that oversells merging is how somebody loses an
 * afternoon — and it is also the one thing the guard still refuses, so it
 * earns its place in the sentence twice over.
 *
 * What is NOT in the copy, deliberately: the refusal that remains. A
 * session whose mirror has fallen behind is still stopped, but that is a
 * fault condition with its own banner, and describing it here would put the
 * exception in front of the rule for every reader who will never meet it.
 *
 * ## Your own second window is not the sharp case
 *
 * This used to say the guard would not fire "because both are you". It
 * never worked that way — it reads the document's content, not a uid — and
 * the one route by which another session's write could slip past it is
 * closed (`expectOwnWriteRef` in `use-besigner-document`). So your own
 * window is described as what it is: another session, treated the same. The
 * badge still says which one is yours.
 */
/**
 * WHAT MAKES THIS COPY TRUE is the room being VERSION-scoped (AGL-2486).
 *
 * "Edits merge live, element by element" is a promise about the co-edit
 * mirror, and the mirror is keyed per version
 * (`coedit/…/{docId}/{versionId}/nodes`). While presence was keyed per
 * DOCUMENT, anyone editing a different version of the same document appeared
 * in this stack and got told their edits would merge — they would not, and
 * nothing on screen said so.
 *
 * Presence is now keyed to the same scope as the mirror, so everyone this
 * sentence is said about really is somewhere their edits reach. Widen the room
 * again and the sentence goes back to being false, so revisit it here if that
 * ever happens.
 */
export function describe(entry: PresenceEntry): string {
  if (entry.isSelf) {
    return (
      'This is YOU, in another window or tab. It counts as a separate ' +
      'session: edits merge live between them, element by element, and ' +
      'either window can save.'
    )
  }
  return (
    `${entry.displayName} has this open too. Edits merge live, element by ` +
    'element, and either of you can save at any time \u2014 if you both ' +
    'change the same element, the last change wins.'
  )
}

PresenceAvatars.displayName = 'PresenceAvatars'

export default PresenceAvatars
