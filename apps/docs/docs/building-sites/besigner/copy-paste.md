---
sidebar_position: 7
title: Copy & paste elements
description: Copy any element — with its children — and paste it elsewhere, including into a different screen, layout or component.
---

# Copy & paste elements

**Duplicate** makes another copy right where you are. **Copy and paste** goes further: it
carries an element, with everything inside it, to somewhere else entirely — another screen,
a layout, a reusable component, an email template.

## Copy

Select an element and either:

- press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>C</kbd>, or
- open the element's **⋮** menu (on the canvas overlay or in the hierarchy) and choose
  **Copy**.

The whole subtree comes along — a column you built copies with every link inside it.

With [several elements selected](multi-select.md) the menu reads **Copy selection** and takes
them all, in document order. If your selection includes both a container and something
already inside it, the container wins: you get one copy, not two.

## Paste

Select where it should go and press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>V</kbd>, or choose
**Paste** from the same **⋮** menu. The menu item names what's waiting — *Paste Stack*,
*Paste 3 elements* — and is greyed out when nothing has been copied.

Where it lands follows the same rule as **Add element**:

- Select a **container** (a Stack, Section, Container) and the copy goes **inside** it, at the
  end.
- Select a **leaf** — a Screen Link, button, icon, image — and the copy goes **beside** it as
  the next sibling, because a leaf has no slot to render children in.

Everything pasted is selected afterwards, so you can retext or restyle it straight away.
Paste is a single undo step.

## Between documents

**What you copy stays copied after you navigate.** Open a different screen, layout, component
or template and paste — the clipboard is still there. This is the fastest way to reuse a
structure you have already built and refined.

Two things to know:

- The copy is a **snapshot**, not a link. Editing the original later does not change what you
  pasted. When you want one source of truth across many places, promote it to a
  [reusable component](reusable-components.md) instead.
- Elements have to exist where you're pasting. A block copied from an **email** template uses
  email elements, and pasting it into a site screen is refused with a message naming the
  element that isn't available there. Nothing is half-pasted — the paste either lands
  completely or not at all.

## Copy & paste vs. Duplicate vs. reusable components

| You want | Use |
| -- | -- |
| Another one right here | **Duplicate** |
| The same structure somewhere else, edited separately from then on | **Copy & paste** |
| One thing that updates everywhere it appears | **[Reusable component](reusable-components.md)** |

## Shortcuts

| Action | Shortcut |
| -- | -- |
| Copy selection | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>C</kbd> |
| Paste | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>V</kbd> |
| Select every element at the same depth | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>A</kbd> |

These act on **elements**, not text. While you're editing text — in the attributes panel, in a
dialog, or directly on the canvas — the shortcuts do the ordinary thing and copy or paste the
text instead.

## Related

- [Multi-select & multi-drag](multi-select.md)
- [Reusable components](reusable-components.md)
- [The Besigner](overview.md)
