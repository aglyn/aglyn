---
sidebar_position: 3
title: Signing In & Sessions
description: How console sign-in works — Google sign-in on desktop and mobile, one session across all your workspaces, and automatic sign-out after inactivity.
---

# Signing In & Sessions

Sign in to the console with **email & password** or **Google**. A few behaviors are worth
knowing about, especially if you work across devices or multiple organization workspaces.

## Google sign-in

- On **desktop**, Google sign-in opens a popup window and returns you to the console when
  it completes.
- On **mobile browsers**, the console uses a full-page redirect instead: you're taken to
  Google, sign in there, and land back on the console already authenticated. (Mobile
  browsers can't reliably hand a popup's result back to the opening page.)

## Resetting your password

Forgot your password? From the sign-in screen, choose **Account recovery** and enter your
email. We email you a secure reset link, then walk you through the rest:

1. **Request** — enter your email on the account recovery screen and submit. We always show
   the same "check your email" confirmation, whether or not an account exists for that
   address (so the screen can't be used to probe who has an account).
2. **Email** — open the message and follow the reset link. Links expire after a short
   while and can only be used once.
3. **Choose a new password** — the link opens the reset screen, which confirms whose
   account it's for and asks for a new password (entered twice). Password rules match the
   sign-up screen.
4. **Done** — once saved, head back to the sign-in screen and sign in with your new
   password.

If a link has expired or was already used, the reset screen offers to send a fresh one.

:::note Self-hosting
Password reset uses Firebase's out-of-band email action flow. Point the Firebase console
action URL (**Authentication → Templates → Password reset → edit → Customize action URL**)
at `https://<your-console-domain>/reset-password` so the emailed link opens the console's
own reset screen instead of Firebase's default page. The console domain must be listed
under **Authentication → Settings → Authorized domains**.
:::

## One session across workspaces

Signing in on the main console signs you in to every `{org}` workspace subdomain too — the
session is shared at the parent domain, so hopping between workspaces never re-prompts for
credentials. Signing out anywhere retires the shared session everywhere.

## Automatic sign-out after inactivity

For security, an idle console session expires after **1 hour of no activity** (in any open
tab, on any of your workspace subdomains). When that happens you're returned to the
sign-in screen, and the page you were on is preserved — after signing back in you resume
exactly where you left off.

Activity means any interaction: pointer movement, typing, scrolling, or touching. Active
work in one tab keeps your other tabs alive too.

Inactivity is the **only** thing that ends a session early: a background tab losing its
own authentication (a laptop waking from sleep, a suspended tab, a network blip) recovers
silently from the shared session instead of signing you out everywhere. Only an explicit
sign-out — yours, or a staff-initiated revocation — retires the shared session.

:::note Self-hosting
The idle window is configurable via the `NEXT_PUBLIC_AUTH_IDLE_TIMEOUT_MINUTES`
environment variable (default `60`; set `0` to disable).
:::
