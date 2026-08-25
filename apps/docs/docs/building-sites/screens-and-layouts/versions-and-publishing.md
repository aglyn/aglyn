---
sidebar_position: 4
title: Versions & scheduled publishing
description: Every screen, layout and reusable component keeps named versions — publish one, roll back to an older one, or schedule one to go live.
---

# Versions & scheduled publishing

Screens, layouts, and reusable components all keep **versions**. A version is a named
snapshot of the saved document; exactly one version of each is **published** — the one
your visitors get.

## The versions dialog

Open the version name in the Besigner's app bar to see the **Versions** dialog, with each
version's created/updated times and a **Published** chip on the live one.

- **New version** saves a named snapshot of the current saved document (prefilled
  "Copy of …" — rename it to something meaningful).
- **Open** switches the Besigner to that version. Viewing an old version never
  publishes it.
- Delete versions you no longer need — the published version can't be deleted, and
  the one you have open must be closed first.

<!-- screenshot: besigner/versions-dialog.png per SCREENSHOT_PLAN.md -->

## Publish & roll back

**Publish** on any row makes that version the live one — which is also how you
**roll back**: publishing an older version moves the live pointer, destroys nothing, and
is symmetrical, so rolling forward again is the same click.

A **save is not a publish.** Saving updates the version you have open; publishing is what
changes the live site. Publishing a *layout* version reaches every screen bound to that
layout, so check its **Used by** card first — see [Layouts](layouts.md#used-by).

## Scheduled publishing

**Schedule** publishes a version automatically at a chosen future time; the row then
shows a *"Publishes …"* chip you can clear to cancel.

If a scheduled publish comes due on a plan that no longer includes scheduling — after a
downgrade, say — it is **skipped and shown as skipped** on the screen's page, never
silently dropped, so you can dismiss it or upgrade and reschedule.

## Plan requirements

Gating is enforced where you click:

- **Creating versions** requires **Pro or above** — on a lower tier the editor answers
  *"Versioning requires a Pro plan — see Billing to upgrade"* instead of opening the
  name dialog.
- **Scheduled publishing** requires **Business or above**.
- A version is snapshotted from the **saved** document, so the editor asks you to save
  the canvas first rather than silently capturing (or losing) unsaved edits.

## Related

- [Screens](screens.md)
- [Layouts](layouts.md)
- [Reusable components](../besigner/reusable-components.md)
- [Live co-editing](../besigner/live-co-editing.md)
