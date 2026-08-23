---
sidebar_position: 13
title: Element animations
description: Add fade, slide and zoom motion to any element, stagger a row of cards, choose when it plays, and keep the page fast and accessible.
---

# Element animations

Any element on a screen can animate. Pick a preset, choose when it plays,
and adjust a few numbers — there is no CSS to write.

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

### Easing

Easing is the *shape* of the motion — whether it starts fast and settles, or
moves at one steady speed. It changes how an animation feels far more than
its duration does.

| Easing | Feels like |
| --- | --- |
| **Smooth** (default) | Starts quickly and settles gently. The safe choice. |
| **Steady** | One constant speed from start to finish. Mechanical, good for subtle moves. |
| **Gentle start** | Eases in slowly, then arrives quickly. |
| **Gentle end** | Starts quickly, then slows into place. |
| **Gentle start and end** | Slow at both ends, quickest in the middle. |
| **Slight overshoot** | Travels a little past its resting place and settles back. Use sparingly. |

Leaving this alone gives you **Smooth**, which is the curve every animation
used before this setting existed — so nothing you built earlier has changed.

### Stagger children

Turn **Stagger children** on and the element stops animating as a whole.
Instead, the things *inside* it animate one after another. This is what you
want for a row of cards, a feature list or a grid of logos: they arrive in
sequence rather than all landing at once.

**Stagger step** is the gap between one child and the next, in milliseconds.
90 is a natural default. It is capped at 500, because this gap multiplies —
the tenth card in a row waits nine steps, so a large number turns into a very
long wait very quickly.

A few things worth knowing:

- The stagger applies to the element's **direct children** only.
- Your **Delay** still applies, to the whole group. Set a delay of 200 and a
  step of 90 and the first child waits 200ms, the second 290ms, and so on.
- Beyond the 24th child, everything remaining arrives together. This stops a
  long list from leaving its last rows invisible for a minute.
- Stagger is not offered for **on hover**, because a hover effect has to
  reverse the moment the pointer leaves and a staggered one would strand half
  a row mid-move.

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
slides a short distance or changes size slightly; none of them spin or
parallax, and the most emphatic thing on offer is the **Slight overshoot**
easing, which you have to choose deliberately.

## Speed and layout

Animations are pure CSS. A published page loads no animation library, and a
page with no animations on it ships nothing extra at all — no stylesheet, no
script. A page that uses the scroll trigger adds a few hundred bytes of
inline code to watch for elements entering the viewport.

Staggering a row costs nothing extra. The page watches the row, not each card
in it, so twelve cards arriving one after another is one thing to keep track
of rather than twelve — the spacing between them is plain CSS.

The presets only ever change an element's opacity and its position on the
screen, never the space it takes up. Nothing on the page moves to make room
for an animation, so animations cannot cause the layout shift that search
engines penalise.

## If a visitor has JavaScript turned off

Everything stays visible. Scroll-triggered elements simply appear in their
final state rather than animating in, and load and hover animations still
work normally. Search engines see the full text of the page either way.
