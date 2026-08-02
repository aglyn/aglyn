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

## Sign-in methods

You can link **both** methods to one account, and then sign in either way — same
profile, same workspaces, no duplicate account. Manage them under
[Manage Account → Account](manage-account.md#sign-in-methods):

- **Continue with Google** links Google to an account that signed up with a password.
- **Disconnect** unlinks Google again.
- **Email & password** is marked **Required** and can't be disconnected — it's the
  method that always works.

Your last remaining sign-in method can never be removed, so there's no way to lock
yourself out.

**Single sign-on accounts are the exception.** If your company signs you in through
its own identity provider, no other method can be linked — see
[Manage Account](manage-account.md#sign-in-methods) for why, and for what happens
to methods linked before your organization enabled enforcement.

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

If you signed up with Google and have never set a password, there's nothing to reset —
connect **Email & password** from [Manage Account](manage-account.md#sign-in-methods)
first.

:::note Self-hosting
Aglyn composes and sends the reset and verification emails itself, through your configured
mail provider — **you do not need to set a Firebase action URL**, and the Firebase email
templates are not used at all. Firebase still mints the one-time code; only the message
and the link's host are Aglyn's, and the link is built from your own console origin.

What you do still need: the console domain listed under **Authentication → Settings →
Authorized domains**, and a working mail provider. If mail is unconfigured, account
recovery still returns its usual "check your email" screen — deliberately, so the screen
can't be used to probe who has an account — but no message goes out. Check your server
logs for `[auth/send-password-reset] email is not configured`.
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

## Closing your account

**Manage Account → Close account** permanently deletes your personal account. It removes
your profile and contact details, your avatar, your notifications, and your sign-in, and
takes you off every workspace roster you're on.

This cannot be undone, and support cannot restore it.

**Workspaces are never deleted by closing an account.** A workspace outlives the person
who created it, and deleting one as a side effect of someone closing their personal
account would take its sites and data with it. So if you are the **sole owner** of a
workspace, closing your account is refused until you hand that workspace over — the
message names each one, along with whether it has an active subscription and how many
other members it has. Transfer ownership from **Team → Permissions**, then come back here.

Being a member, editor, admin or site collaborator is never a blocker; only sole
ownership is.

You'll be asked to confirm twice: once by proving it's you (your password, or a fresh
sign-in through your provider), and once by typing `DELETE`. Both are required, and the
confirmation of identity has to be recent — starting the flow and leaving it open for an
hour will ask you again.

:::note Single sign-on
If your organization uses SSO, your account also exists in your identity provider's
directory. Closing it here removes you from Aglyn; it does not touch your account with
your identity provider, and an administrator there may be able to provision you again.
:::
