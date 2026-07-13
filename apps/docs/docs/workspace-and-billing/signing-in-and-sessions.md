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

:::note Self-hosting
The idle window is configurable via the `NEXT_PUBLIC_AUTH_IDLE_TIMEOUT_MINUTES`
environment variable (default `60`; set `0` to disable).
:::
