---
sidebar_position: 6.5
title: Video
description: The Video element — the poster frame that decides what a visitor downloads, captions, the lightbox, and the three fields a video search result needs.
---

# Video

The **Video** element plays a film from your media library, poster first. Almost
everything else on this page follows from that poster: with one, a visitor
downloads a single image and fetches the film only when they press play.

## Choosing the film {#video-source}

Set a **Video source** with **Browse media**. A video from your media library
arrives with a poster frame, its running time and its dimensions already filled
in — you only need **Poster image** to override the frame the library picked.

:::tip
Picking a video from the media library copies its dimensions onto the element, which
reserves the right-shaped box before anything loads and stops the rest of the page
shifting when it does. It fills in the duration too, so the only SEO fields left to
write are the title, the description and the date.
:::

## What a visitor downloads before pressing play {#video-preload}

The poster is what makes the element cheap. With one, **Preload** defaults to
fetching *nothing* — a visitor downloads the poster and not one byte of the film
until they press play. Without a poster the element falls back to fetching the
video's length and dimensions, because a video with neither a poster nor metadata
paints a black rectangle. If you want the old behaviour on a postered video, set
**Preload** to *Length and dimensions only*.

## Captions {#video-captions}

**Captions file** takes a WebVTT (`.vtt`) file — pick it with **Browse media**. Fill in
**Captions label** and **Captions language** so the player can name the track.

## Opening in a lightbox {#video-lightbox}

Turn on **Open in a lightbox** and the poster becomes a play button that opens the
film full size over the page, with a close button and `Esc` to dismiss. It needs a
poster; without one the player stays in the page as usual.

## The three fields a search result needs {#video-seo}

**Video title**, **Video description** and **Publication date** are what let search
engines list the video in results. They are not decoration: a video is only eligible
for a video result when all three are filled in, alongside the poster. The title is
also the name a screen reader announces for the player, and the tooltip on hover.
None of the three is ever displayed as text on the page.

## Related

- [Element catalog](element-catalog.md) — every other element in the drawer
- [SEO overview](../seo/overview.md) — how a page describes itself to search engines
- [The Besigner](overview.md)
