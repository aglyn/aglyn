---
sidebar_position: 6.6
title: Music player
description: The Music player element — play your own tracks from the media library, one or a playlist, the rights confirmation every audio upload needs, and how copyright takedowns work.
---

# Music player

The **Music player** element plays your own music on your site: one track, or a playlist
of **Track** elements. It plays audio from your media library, with its own controls —
play and pause, previous and next for a playlist, a seek bar with the time, and volume —
that work with a keyboard and a screen reader.

## Adding tracks {#adding-tracks}

1. Upload your audio to the media library. MP3, M4A, AAC, OGG and WAV files are accepted.
2. Add a **Music player** to the page. A new player shows *add your tracks* in the
   Besigner and nothing on the published page until it has one.
3. Choose its **Audio** with **Browse media**, which lists only audio files, and fill in
   the **Track title**, the **Artist** and, if you like, the **Cover art**.
4. For a playlist, use the **Music playlist** preset, or add **Track** elements inside the
   player. They play in the order the page shows them, and each one plays when a visitor
   presses it.

A player can also play a track from an `https:` address somewhere else, but only once you
switch on **I own this audio or have a license to use it on my site** for that track. Until
then the published player says the track is unavailable.

:::note Plan availability
Audio uploads are file uploads, so they follow the same plan as video and document uploads,
and they count toward your media storage.
:::

## Your rights to the music {#rights}

Only put music on your site that you made, or that you have a license to publish. A song by
another artist cannot be played on your site without the rights holder's permission, however
it reaches the page.

- **Every audio upload asks first.** Before an audio file is uploaded — and before one
  replaces another — the media library asks you to confirm that you own it or have a license
  to use it on your site. The file is not sent until you do. Your answer is stored with the
  file, with who gave it and when. The REST API asks the same question: an audio upload to
  `POST /v1/media` needs `"rightsConfirmed": true`.
- **External addresses need the same answer**, given on the track itself.
- **No download button.** The player has no download control and does not offer the browser's
  save menu on its audio.
- **Aglyn AI never adds music.** Assist and AI site jobs place an empty player for you to fill
  with your own uploads. They do not find, link or embed recordings, and Assist declines a
  request for a named artist's songs.

## Copyright takedowns {#takedowns}

When a rights holder reports a track, Aglyn takes the file down. It stays in your media
library, but it stops being served everywhere it is used: a Music player shows **This track
is unavailable**, and your media library shows the notice. A takedown is reversible, and
a file that was taken down by mistake is restored.

Rights holders send notices, and site owners send counter-notices, through the
[copyright (DMCA) page](https://aglyn.com/legal/dmca). Repeated infringement can close an
account under the [Acceptable Use Policy](https://aglyn.com/legal/acceptable-use).

## Related

- [Media Library & CDN](../../content-and-data/media/overview.md) — uploads, folders and delivery
- [Video](video.md) — the Video element, for films
