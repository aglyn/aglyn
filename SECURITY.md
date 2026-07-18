# Security Policy

We take the security of Aglyn seriously. Thank you for helping keep the project
and its users safe.

## Supported versions

Aglyn is pre-1.0 and ships from `main`. Security fixes are applied to the latest
`main` and the current production deployment. Older commits/tags are not
separately patched.

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a security
vulnerability.** Public disclosure before a fix is available puts users at risk.

Instead, report it privately through GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (Security advisories → Report a vulnerability).
3. Fill in the advisory form.

This opens a private channel visible only to you and the maintainers.

When reporting, please include as much of the following as you can:

- The type of issue (e.g. cross-tenant data access, XSS, auth bypass, RCE).
- The affected component or route (app, file path, or URL).
- Step-by-step reproduction, proof-of-concept, or a minimal test case.
- The impact and any suggested remediation.

Please **do not** run tests that could exfiltrate other users' data, degrade
service for others, or access accounts you do not own. If a proof-of-concept
would require any of those, describe it rather than executing it.

## Our commitment

- We will acknowledge your report within **3 business days**.
- We will provide an assessment and expected timeline within **7 business days**.
- We will keep you informed as we work on a fix and will credit you in the
  advisory once it is published, unless you prefer to remain anonymous.
- We ask for a reasonable disclosure window (typically up to 90 days) so a fix
  can ship before details are made public.

## Scope

In scope: the code in this repository (the console, tenant runtime, marketing
site, shared libraries, Firebase security rules, and the plugin platform).

Out of scope: findings that require physical access to a user's device,
social-engineering of Aglyn staff, denial-of-service via sheer request volume,
and reports about third-party services (Firebase, Stripe, Vercel) that are not
caused by an Aglyn misconfiguration.

Thank you for practicing responsible disclosure.
