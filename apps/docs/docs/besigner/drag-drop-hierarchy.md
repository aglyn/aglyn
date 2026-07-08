---
sidebar_position: 3
title: Drag-and-drop hierarchy
description: Reparent and reorder elements by dragging, with placement markers and clear rejection reasons.
---

# Drag-and-drop hierarchy

Every element on the canvas is a node in a tree. Rearrange that tree by **dragging** — in the
hierarchy panel or directly on the canvas.

## Reparent and reorder

- Drag a node onto a new parent to **reparent** it, or between siblings to **reorder**.
- A **placement marker** shows exactly where the node will land before you drop.
- Drops work reliably across the hierarchy and the canvas.

## When a drop is rejected

Not every element can go everywhere. If a drop isn't allowed, the Besigner tells you **why**
— it names the specific **placement (lineal) rule** that rejected the move, so you can adjust
instead of guessing. Layout-only components, for instance, are gated by the view type you're
editing.

## Tips

- Use [multi-select](multi-select.md) to move a whole group into a new parent in one drag.
- Watch the placement marker — it's the source of truth for where the drop lands.

## Related

- [Multi-select & multi-drag](multi-select.md)
- [Screens & layouts](../screens-and-layouts/overview.md)
