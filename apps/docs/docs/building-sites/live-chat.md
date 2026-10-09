---
sidebar_position: 13
title: Live chat
description: Chat with your site's visitors through your own Tidio or LiveChat account. The chat loads only when a visitor asks for it, so it never slows your pages.
---

# Live chat

Put your own **Tidio** or **LiveChat** chat on your site. Visitors press the chat
button in the corner of the page, and you answer them from your Tidio or LiveChat
inbox, as you would on any other site. Your conversations, agents, greetings and
chatbots stay in your Tidio or LiveChat account; Aglyn only puts the chat on your
pages.

Live chat is included on every plan. You need your own Tidio or LiveChat account.

## Set up live chat

1. Turn on **Live chat** for the site under **Admin → Plugins → Live chat**. It is off
   for every site until you turn it on.
2. Open the site's **Setup** page and find the **Live chat** card.
3. Choose your **Chat service**: Tidio or LiveChat.
4. Paste the identifier from your chat service's install code. You can paste the
   whole install code and Aglyn takes the identifier out of it.
   - **Tidio**: the **Public key**, under **Settings → Developer** in Tidio.
   - **LiveChat**: the **License number**, in the install code under
     **Settings → Channels → Website** in LiveChat.
5. Turn on **Show the chat on this site** and press **Save**.

Saving refreshes your live pages, so the chat button appears within a minute. Only
a **site admin** can change the card; everyone else on the site can see how it is
set.

To pause the chat without losing your settings, turn off **Show the chat on this
site** and save. Switching **Live chat** off under **Admin → Plugins** removes it
from the site's pages too, and keeps the settings for later.

## Which pages show the chat

Under **Pages**, choose:

- **Every page** (the default).
- **Only these pages**, then list them.
- **Every page except these**, then list them.

List one page address per line, such as `/contact`. End an address with `/*` to
cover a whole section: `/shop/*` covers `/shop` and every page under it. You can
list up to 50.

The chat never appears in the Besigner or anywhere else in the console, only on
your published pages.

**Chat button** sets the corner the button sits in. Choose the same side you chose
in Tidio or LiveChat, so the button and the chat open in the same place.

## How the chat loads {#how-the-chat-loads}

The chat is built to keep your pages fast. Until a visitor asks for it, the page
carries only a small chat button, drawn after the page has finished loading. Tidio
or LiveChat loads when:

- **A visitor presses the chat button.** The chat loads and opens.
- **The same visitor opens another page in the same browser tab.** Their chat comes
  with them, so a conversation is not cut off.
- **You turned on Load the chat with the page**, once the page has finished loading,
  for visitors who allowed analytics. With it on, your chat service's own greetings,
  proactive messages and visitor list work before anyone presses the button. A
  visitor who has not allowed analytics still gets the chat when they press the
  button.

**Load the chat with the page** is off by default. It needs your site's
[cookie consent](../marketing-and-automation/analytics/cookie-consent.md) to be
running, which it is whenever the site has a Google Analytics or Google Tag Manager
ID. On a site with neither, or one that turned the consent tool off, the chat loads
only when a visitor presses the button.

## Privacy and cookies {#privacy-and-cookies}

Tidio and LiveChat keep the visitor's conversation and recognize them when they come
back, in the visitor's browser: Tidio mostly in local storage (`tidio_state_…`,
`tidio_token`), LiveChat in the `__lc_cid` and `__lc_cst` cookies. Neither uses them
for advertising.

- When a visitor presses the chat button, they are asking for the chat, so it loads
  whatever they answered on your consent banner.
- When the chat loads with the page, it waits for the visitor's analytics consent,
  and your consent banner names your chat service beside Google Analytics. A visitor
  who later withdraws consent has the chat taken off the page and its storage
  deleted, unless they had pressed the chat button themselves.

Your chat service receives what visitors type into the chat, the page they are on and
their browser's details. It is your account with that service, under your agreement
with it; list it in your site's privacy policy.

Your site's security policy admits the addresses Tidio or LiveChat need only while the
chat is on, so you do not need to add them under **Security** yourself.
