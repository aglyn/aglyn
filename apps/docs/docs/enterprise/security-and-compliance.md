---
sidebar_position: 5
title: Security & compliance
description: Where the security material for a procurement review lives, and what we do not have.
---

# Security & compliance

The full write-up lives on **[Trust & security](/trust)**. It is written for
the security review that precedes an enterprise purchase, and it is kept as one
page on purpose — a reviewer should be able to send a single link rather than
assemble an answer from several.

## What it covers

- **What we do not have**, first rather than buried: no SOC 2 report and no
  audit in progress, no ISO 27001 / HIPAA / FedRAMP, no third-party penetration
  test, no bug bounty.
- Authentication, including [SSO](./sso.md), and how sessions work.
- Data handling — where data lives, what is encrypted, and who can reach it.
- Availability, and the fact that there is **no committed uptime percentage**
  (see [Availability & status](./uptime-and-status.md)).
- How to report a security issue.

## Why the gaps are listed first

Because a reviewer needs them, and because a questionnaire surfaces them
anyway — three weeks later, with more people in the thread. Leading with the
absences is faster for both sides than leading with the controls.

If a certification is a hard requirement for your purchase, raise it at the
start. We would rather tell you early that we do not have it than discover it
at contract stage.

## Reporting a vulnerability

Security reports are read even though there is no bug bounty. The reporting
route is on [Trust & security](/trust).
