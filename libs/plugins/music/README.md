# @aglyn/plugins-music

The Music player plugin (AGL-3716): the **Music player** element and its
**Track** rows, which play a site owner's own audio (MP3, M4A, AAC, OGG or WAV)
from the media library, one track or a playlist.

- Surface: `site` only (`registerMusicPlugin`, from `./site`).
- Plays library audio through the media CDN, which serves it with its own
  `Content-Type` and byte ranges for seeking.
- An external `https:` address plays only when the element records the
  author's rights confirmation (`rightsConfirmed`).
- No download control. A copyright takedown is the platform's media
  quarantine (reason `dmca`); the CDN answers 410 and the player shows
  "This track is unavailable".

Docs: `apps/docs/docs/building-sites/besigner/music-player.md`.
