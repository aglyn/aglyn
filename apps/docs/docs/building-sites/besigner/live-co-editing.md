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
toolbar (up to four; photo or initial, on their assigned color). Hovering explains
exactly what presence means here: *"«Name» is editing this too — saves are not
merged"* — and *"(in 2 places)"* when they have it open twice.

<!-- screenshot: besigner/presence-avatar-stack.png per SCREENSHOT_PLAN.md -->

If **your own account** has the document open somewhere else — another tab, or your
account signed in on another machine — an amber badge appears beside the avatars
warning that nothing merges between your own sessions either: whichever one saves
last wins, and it won't warn you, because both are you.

On the canvas, each collaborator shows up as:

- a **cursor** in their color with their name on a small pill, and
- a **selection outline** around the element they have selected, with their name in a
  tab above it.

<!-- screenshot: besigner/remote-cursor-and-selection.png per SCREENSHOT_PLAN.md -->

Everyone sees the same person in the same color, and the overlays never intercept
your clicks.

## Editing together

Edits are shared **live, per element**: change a heading while a teammate restyles the
footer and you both keep your work. What lands in the document:

- **Different elements** — both sets of edits apply. This is the normal case, and it
  just works.
- **The same element** — last write wins. Co-editing shares changes; it does not merge
  two versions of one element.
- A teammate's changes **never enter your undo stack** — undo rewinds only your own
  edits.

Anyone with **edit access** to the site (a site admin or editor, or a workspace owner
/ admin / editor) can co-edit. Viewers see presence but their changes are refused at
the door.

Live edits are working state, not saves — the document still saves when someone
presses **Save**, and a successful save is what makes the shared state durable.

## When saves collide

Co-editing shares unsaved edits, but **saves are still whole-document and are not
merged**. If someone else saves the document while you're editing, the besigner tells
you immediately — not twenty minutes later when you press Save:

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
- **Discard** deletes the draft and keeps the saved document.
- Nothing is ever restored automatically; the besigner always asks.
- If a teammate saved while your draft was stranded, the offer says so and restoring
  will not overwrite their work — you'll be asked to reload before you can save.

Drafts live in **this browser only** (they don't follow you across machines), are
kept for up to **7 days**, and are deleted the moment a save succeeds. They're a
crash net, not version history — for named, durable snapshots use
[versions](../screens-and-layouts/overview.md#versions--scheduled-publishing).

## The Save button always answers

The toolbar's save control reads **Save** when there's work to save and **Up to
date** when there isn't — and clicking always produces an answer (saving, "Already
saved", or the conflict warning), never silence.

## Related

- [The Besigner](overview.md)
- [Screens & layouts — versions](../screens-and-layouts/overview.md#versions--scheduled-publishing)
- [Teams, roles & membership](../../workspace-and-billing/teams-and-roles/overview.md)
