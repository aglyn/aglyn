# @aglyn/plugins-live-chat

The merchant's own Tidio or LiveChat chat on their Aglyn site's pages
(AGL-3698). Aglyn holds no account with either vendor: a site admin pastes the
public key (Tidio) or license number (LiveChat) from the vendor's install code
into the **Live chat** card on the site's setup page.

- `@aglyn/plugins-live-chat` — constants, the provider and settings model, and
  the console registrar (the `hostSettings` card).
- `@aglyn/plugins-live-chat/site` — the site runtime: a launcher button drawn
  once the page is idle, and the vendor's widget loaded on a press, on a later
  page in the same tab, or — when the site chose "Load the chat with the page" —
  after idle for a visitor whose recorded consent grants analytics.
- `@aglyn/plugins-live-chat/server` — the tenant page enricher (`liveChat`
  slice, only on pages the chat shows on, so the site bundle loads only there)
  and the console route `/api/live-chat/settings` (read: any site member; save:
  a site admin; drops the site's cached pages).

Settings live in `hosts/{hostId}/pluginSettings/live-chat`, written only by the
route (the Firestore rules refuse client writes). The vendor hosts each widget
needs are declared under `siteCsp` in `plugins.config.json` and admitted to the
site's Content-Security-Policy only while the chat is on.

Off for a site until that site turns it on. No env, no release flag, every plan.
