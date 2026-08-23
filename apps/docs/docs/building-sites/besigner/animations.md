---
sidebar_position: 13
title: Element animations
description: Add fade, slide and zoom motion to any element, choose when it plays, and keep the page fast and accessible.
---

# Element animations

Any element on a screen can animate. Pick a preset, choose when it plays,
and adjust two numbers — there is no CSS to write.

## Add an animation

1. Select the element on the canvas.
2. Open the **Attributes** tab in the right-hand panel.
3. Scroll to **Animation** and pick a preset.

The rest of the animation fields appear once a preset is chosen.

### Presets

| Preset | Entrance | On hover |
| --- | --- | --- |
| **Fade in** | Fades up from invisible | Dims slightly |
| **Slide up** | Rises into place while fading in | Lifts |
| **Slide down** | Drops into place while fading in | Sinks |
| **Slide left** | Enters from the right | Nudges left |
| **Slide right** | Enters from the left | Nudges right |
| **Zoom in** | Grows from slightly small | Grows |
| **Zoom out** | Shrinks from slightly large | Shrinks |

### Plays

- **On scroll into view** (default) — the animation runs the first time the
  element reaches the viewport. This is the right choice for anything below
  the top of the page.
- **On page load** — runs immediately. Best for a hero or a headline that is
  visible the moment the page opens.
- **On hover** — the element eases to its emphasis state while the pointer is
  over it, and eases back when the pointer leaves.

### Duration and delay

Both are in milliseconds. **Duration** is how long the motion takes; 600 is a
natural default and anything over 3000 is capped. **Delay** is how long to
wait before starting.

Delay is how you stagger a group. Give a row of three cards delays of 0, 100
and 200 and they arrive one after another instead of all at once.

### Replay each time

Only offered for **on scroll into view**. Off by default, so an animation
plays once and then leaves the element alone. Turn it on and the element
re-animates every time it scrolls back into view.

## Animations do not play on the canvas

The besigner shows every element in its finished, un-animated state so you
can always see and select it. Use **Preview** or the published site to watch
an animation run.

## Accessibility

Some people get motion sickness, migraines or vertigo from movement on
screen, and both macOS and Windows have a system setting to ask for less of
it.

Aglyn honours that setting. A visitor who has turned on **Reduce motion**
sees your page with every element in its final position, fully visible, with
no movement at all — including elements set to animate on scroll. You do not
have to do anything, and there is no way to override it.

This is also why the presets are what they are. Every one of them only fades,
slides a short distance or changes size slightly; none of them spin, bounce
or parallax.

## Speed and layout

Animations are pure CSS. A published page loads no animation library, and a
page with no animations on it ships nothing extra at all — no stylesheet, no
script. A page that uses the scroll trigger adds a few hundred bytes of
inline code to watch for elements entering the viewport.

The presets only ever change an element's opacity and its position on the
screen, never the space it takes up. Nothing on the page moves to make room
for an animation, so animations cannot cause the layout shift that search
engines penalise.

## If a visitor has JavaScript turned off

Everything stays visible. Scroll-triggered elements simply appear in their
final state rather than animating in, and load and hover animations still
work normally. Search engines see the full text of the page either way.
