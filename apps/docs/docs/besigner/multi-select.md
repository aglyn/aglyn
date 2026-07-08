---
sidebar_position: 2
title: Multi-select & multi-drag
description: Select several elements at once and move the whole selection together.
---

# Multi-select & multi-drag

Working element-by-element is slow. The Besigner lets you **select multiple** nodes — in the
hierarchy or on the canvas — and act on them together.

## Select multiple

- **On the canvas**, add elements to the selection as you click.
- **In the hierarchy**, select multiple nodes the same way.
- Selection spans **both** surfaces — what you pick in the hierarchy is reflected on the
  canvas and vice versa.

## Move the whole selection

Once several nodes are selected, **dragging moves the entire selection** at once, preserving
their arrangement. This is the fast way to reposition a group without grouping them
permanently.

## Tips

- Selection overlays render inside the viewport's stacking context, so they highlight the
  right elements without disturbing page scroll.
- Combine with [drag-and-drop reparenting](drag-drop-hierarchy.md) to move a group into a new
  parent.

## Related

- [Drag-and-drop hierarchy](drag-drop-hierarchy.md)
- [The Besigner](overview.md)
