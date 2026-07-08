---
sidebar_position: 4
title: Inline & rich text editing
description: Edit text directly on the canvas, with basic rich text on opt-in elements.
---

# Inline & rich text editing

Text is edited **where it lives** — right on the canvas — so you see the result as you type.

## Edit inline

- **Double-click** any text-capable component to edit its text directly on the canvas.
- Type, then click away to commit.

## Rich text

Components that **opt in** support **basic rich text** — formatting like bold and links
within the text — so you're not limited to plain strings.

## The Text attribute

Prefer the inspector? Set a component's text from its **Text attribute field** instead of
editing on the canvas. This is handy when the text is short or you're setting it alongside
other attributes.

## Bindings in text

Text props accept [bindings](../bindings/overview.md) — `{{variable}}`, `{{fn:name(args)}}`,
and dataset fields — resolved live on the canvas with bound-content markers.

## Related

- [The Besigner](overview.md)
- [Bindings, variables & functions](../bindings/overview.md)
