---
sidebar_position: 1
title: The Besigner
description: Aglyn's visual editor — canvas, hierarchy, inline text, multi-select, and placement rules.
---

# The Besigner

The **Besigner** is Aglyn's visual editor. You build a screen by placing components on a
**canvas**, arranging them in a **hierarchy**, and editing content directly on the page.
It renders your screen under the real site theme, so what you see matches what publishes.

![The Besigner editor: components drawer and hierarchy on the left, the live canvas in the center, and the inspector on the right](/img/besigner-surface.svg)

:::info Plan availability
**Free**. The Besigner is core to building; some components and actions it exposes are
plan-gated (noted where relevant).
:::

## What you can do

- **Drag-and-drop** components from the drawer onto the canvas, and reparent them by
  dragging in the hierarchy or on the canvas.
- **Multi-select** across the hierarchy and canvas, then move the whole selection at once.
- **Edit text inline** — double-click a text-capable element to type directly; opt-in
  elements support basic rich text.
- **Bind a layout** so the screen renders inside a shared header/footer frame.
- **Preview color schemes** with the artboard light/dark toggle, matching the live site's
  system-driven scheme.

## The canvas

The canvas shows your screen composed with its theme and, if bound, its
[layout](../screens-and-layouts/overview.md#layouts). Selection overlays highlight the
active element without affecting page scroll.

When a drop isn't allowed, the Besigner explains **why** — it surfaces the specific
placement (lineal) rule that rejected the move, so you're never guessing.

## Hierarchy panel

Every element on the canvas is a node in a tree. The hierarchy panel lets you:

- Reorder and **reparent** nodes by dragging (with a placement marker showing the target
  slot).
- Select multiple nodes and act on them together.
- See which nodes are layout-only vs. screen content.

## Inline and rich text

- **Double-click** any text-capable component to edit its text on the canvas.
- Components that opt in support **basic rich text** (bold, links, and similar).
- You can also set a component's text from the **Text** attribute field in the inspector.

## Reusable components

Promote any subtree into a **reusable component**, then insert instances of it across
screens. Editing the source updates every instance at render time. You can rename, demote,
or delete reusable components from the site dashboard. See
[Reusable components](../screens-and-layouts/overview.md#reusable-components).

## AI in the canvas

- **AI copy assist** rewrites or generates text for any canvas text prop.
- **AI Generate Section** produces a constrained subtree straight onto the canvas.

See [AI Assist](../ai-assist/overview.md).

## Related

- [Screens & layouts](../screens-and-layouts/overview.md)
- [Bindings & variables](../bindings/overview.md)
- [Section & block library](../site-templates/overview.md)
