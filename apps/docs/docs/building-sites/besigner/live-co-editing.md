---
sidebar_position: 11
title: Live co-editing & unsaved work
description: See who else is editing, work on the same document together, survive save conflicts, and recover unsaved changes after a crash.
---

# Live co-editing & unsaved work

The besigner is safe to share. When teammates open the same document you see each
other — avatars, cursors, and selections — and edits flow between you live. And if a
tab crashes or closes with unsaved work, the besigner keeps a local draft and offers
it back.

This works in every besigner editor: **screens, layouts, reusable components,
templates, and designed emails**.

:::info Plan availability
**Free.** Presence, co-editing, conflict protection, and draft recovery are on for
every plan — how many teammates can edit is a question of
[collaborator seats](../../workspace-and-billing/teams-and-roles/overview.md), not of
this feature.
:::

## Who's here

When someone else has the document open, their **avatar** appears in the besigner
toolbar (photo or initial, on their assigned color, ringed in that same color).
Hovering says what to expect of working alongside them: *"«Name» has this open too.
Edits merge live, element by element, and either of you can save at any time — if you
both change the same element, the last change wins."*

Up to **six** avatars are shown side by side; beyond that the rest collapse into a
`+N` disc that says how many more are here. When you are the only one in the
document, the toolbar shows nothing at all rather than an empty slot.

<!-- screenshot: besigner/presence-avatar-stack.png per SCREENSHOT_PLAN.md -->

If **your own account** has the document open somewhere else — another tab, or your
account signed in on another machine — that window gets its own avatar too, drawn
with a **dashed ring and a small screen badge** so you can tell at a glance it is
yours. It is treated as a separate session in every respect: edits merge between your
windows the same way, and either window can save. The conflict guard has never keyed
on *who* wrote, so two windows of one account are protected exactly as two people
are. Your *current* window never draws an avatar for itself.

On the canvas, each collaborator shows up as:

- a **cursor** in their color, with their name on a small pill — shown while they are
  moving around, and dropped once they have an element selected, where the selection
  already carries their name;
- a **selection outline** around the element they have selected, with their name in a
  tab above it. Your own other tab is labeled **"You, in another tab"** rather than
  by name, and its outline is dashed.

A collaborator's cursor is only broadcast while their pointer is genuinely over the
canvas, so someone typing in a side panel stops trailing a cursor across your screen.

<!-- screenshot: besigner/remote-cursor-and-selection.png per SCREENSHOT_PLAN.md -->

The overlays never intercept your clicks.

### About the colors {#presence-colors}

Colors are assigned **per session**, from a palette of six, and everyone in the room
sees the same session in the same color — "the purple cursor" means the same window
on everybody's screen. Two tabs of your own account therefore get two *different*
colors, which is what makes them tellable apart.

The palette holds six, so a room with more than six sessions in it starts reusing
colors. A session can also change color if a colliding session leaves; a session that
never collided keeps its color, including across reloads.

## One version, one room {#per-version-rooms}

Presence and live editing are scoped to **one version of one document** — not to the
document as a whole.

That matters in practice: if a teammate is editing **version 3** of a screen and you
open **version 4**, you will not see each other. No avatar, no cursor, no selection
box, and none of their typing arrives on your canvas.

This is not a gap — it is the honest answer. Live edits flow through a shared working
copy that is itself per version, so two people on different versions were never going
to reach each other. Showing an avatar would promise a connection that does not
exist. **If you mean to work together, make sure you are both on the same version.**

Templates are the exception, because templates do not have versions: everyone editing
one template shares a single room.

## Who's in a document, before you open it {#presence-in-lists}

You don't have to open a document to find out someone is already in it. Small avatars
appear on the row itself in:

- the **Screens** list,
- the **Layouts** list,
- the **Components** card,
- the **Templates** card, and
- the **Site emails** card.

Up to three faces are shown per row, then `+N`. A row with nobody in it shows nothing,
so a quiet list stays quiet.

Two things are worth knowing about these row avatars, because they answer a slightly
different question from the ones in the editor:

- **They mean "in this document", not "in this version."** They are rolled up across
  every version, so a face on the row may be someone editing a version other than the
  one your **Open** button goes to. The tooltip says so.
- **They refresh about every 30 seconds**, and only while the tab is in front — this
  is a periodic check, not the live connection the editor has. Treat a row avatar as
  "someone was here a moment ago", and the editor's toolbar as the live truth.

One person shows as one face here however many tabs they have open, and you will see
**yourself** on a row if you have that document open in another window.

## Presence is not a lock {#not-a-lock}

Seeing nobody does not reserve the document, and seeing somebody does not shut you
out. Nothing is ever locked — anyone with edit access can open anything at any time.
What actually protects your work is the save guard described in
[When a save is refused](#when-a-save-is-refused), not the avatars.

So an empty avatar row is a good sign, not a guarantee. If presence cannot reach the
server the toolbar says so — an amber warning disc replaces the avatars, and clicking
it explains what went wrong, what to do, and warns you explicitly that an empty stack
is not proof you are alone.

On a self-hosted Aglyn without a Realtime Database configured, presence and live
co-editing are simply not available; the toolbar shows a neutral "not set up" badge
rather than an error, and everything else on this page — the save guard and draft
recovery — carries on working.

## Editing together

Edits are shared **live, per element**: change a heading while a teammate restyles the
footer and you both keep your work. What lands in the document:

- **Different elements** — both sets of edits apply. This is the normal case, and it
  just works.
- **The same element** — last write wins. Co-editing shares changes; it does not merge
  two versions of one element.
- A teammate's changes **never enter your undo stack** — undo rewinds only your own
  edits, including edits that came back to you from another of your own tabs.

:::note One rough edge in undo
If you try to undo a change to an element a teammate has since edited themselves,
the undo will step back without visibly changing anything — Aglyn will not roll back
their work on your behalf. Press undo again to keep going back through your own
edits. This is uncommon, and only happens on an element two of you touched.
:::

Anyone with **edit access** to the site (a site admin or editor, or a workspace owner
/ admin / editor) can co-edit. Viewers see presence but their changes are refused at
the door.

Live edits are working state, not saves — the document still saves when someone
presses **Save**, and a successful save is what makes the shared state durable.

## Saving together

**Everyone can save, in any order, as often as they like.** One of you saves, the
other carries on and saves a minute later — that is the normal rhythm and nothing
interrupts it. It works because co-editing has already done the merging: your
teammate's changes reached your canvas element by element *before* they pressed
Save, so what you write next contains their work rather than overwriting it.

The besigner checks that rather than assuming it. Before letting a save through it
confirms your document actually **incorporates** what is stored — every element the
other save changed is on your canvas with the stored value, deletions included. Two
people in step both pass, always.

## When a save is refused

Two situations do not pass that check, and both are real:

- **Your session has fallen behind.** A tab that lost its connection never received
  those elements, so it would write over work it has never seen.
- **You have both changed the same element.** That is the one case co-editing cannot
  merge, and letting it through is exactly how the last writer silently wins.

Either way the besigner tells you immediately — not twenty minutes later when you
press Save:

> Someone else saved this screen while you were editing. Saving is paused so their
> work is not overwritten — reload to pick up their changes. Nothing you have done
> here is lost until you do.

<!-- screenshot: besigner/concurrent-save-banner.png per SCREENSHOT_PLAN.md -->

The banner has one action — **Reload** — and that's deliberate: there is no "save
anyway" that could silently destroy a teammate's work. Your canvas keeps everything
you've done until you reload, so the recovery is calm: note (or copy) what you need,
reload to pick up their version, and reapply.

Pressing **Save** while the banner is up answers with the same message rather than
saving. The guard also runs server-side inside a transaction, so even a save racing
the conflict by milliseconds is refused, never silently applied.

The guard identifies the other writer as a **different editing session**, not as a
different person — so it applies to a second window of your own account just as it
does to a colleague.

## Local draft recovery

The besigner continuously keeps a **local draft** of your unsaved work in the
browser — written about a second after you pause, and flushed when the tab is hidden
or closed. If the tab crashes, the machine sleeps at the wrong moment, or you just
close without saving, the next time you open that document you're offered the work
back:

> Unsaved changes to this screen from 3 minutes ago were recovered from this
> browser. Restoring puts them back on the canvas without saving; you can undo it.

<!-- screenshot: besigner/draft-recovery-alert.png per SCREENSHOT_PLAN.md -->

- **Restore** puts the draft back on the canvas — unsaved and undoable, so you can
  inspect before committing to it.
- **Discard** deletes the draft from this browser and keeps the saved document. It
  changes nothing on the canvas and nothing for anyone else.
- Nothing is ever restored automatically; the besigner always asks.
- If someone saved while your draft was stranded, restoring it would roll their work
  back, so it is not offered — the banner says so and points you at **Reload**.

**The offer only appears when you are alone in the document.** Recovery is for a
crash: a lost connection, a browser quit, a tab closed on unsaved work. If anyone
else has the document open — including another of your own windows — live co-editing
has already put the unsaved work back on the canvas, so there is nothing to recover
and no prompt is shown. Your draft is still kept; it simply is not offered over the
top of work other people are in the middle of.

Drafts live in **this browser only** (they don't follow you across machines), are
kept for up to **7 days**, and are deleted the moment a save succeeds. They're a
crash net, not version history — for named, durable snapshots use
[versions](../screens-and-layouts/versions-and-publishing.md).

## The Save button always answers

The toolbar's save control reads **Save** when there's work to save and **Up to
date** when there isn't — including after a teammate saves work you already have,
where the document is now stored exactly as your canvas holds it and there is
nothing left to write — and clicking always produces an answer (saving, "Already
saved", or the conflict warning), never silence.

## Related

- [The Besigner](overview.md)
- [Screens & layouts — versions](../screens-and-layouts/versions-and-publishing.md)
- [Teams, roles & membership](../../workspace-and-billing/teams-and-roles/overview.md)
