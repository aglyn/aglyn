# Files that link the native apps to the passkey domain

A passkey belongs to the domain it was made for (`aglyn.com`, the same relying party the web console uses), so the
domain must say which apps may use it. Both files below are templates: each `<PLACEHOLDER>` is a value only the owner of
the developer accounts has, and nothing is published from here. Until they are served and the build setting is set,
"Set up a passkey" stays hidden in the apps.

| File | Served at (exactly, no redirect, `application/json`) | Placeholder | Where it comes from |
| -- | -- | -- | -- |
| `apple-app-site-association.example.json` | `https://aglyn.com/.well-known/apple-app-site-association` | `<APPLE_TEAM_ID>` | Apple Developer account, Membership details (10 characters) |
| `assetlinks.example.json` | `https://aglyn.com/.well-known/assetlinks.json` | `<ANDROID_SIGNING_CERTIFICATE_SHA256_FINGERPRINT>` | Play Console, App signing (the app signing key certificate's SHA-256, `AA:BB:...`) |

Then, per platform:

- Apple: add the Associated Domains capability `webcredentials:aglyn.com` to the `com.aglyn.app` target's entitlements and
  set `AGLYN_PASSKEY_RP_ID = aglyn.com` in `Config/Production.xcconfig` (`apps/ios/Config/Production.xcconfig.example`).
- Android: build the release with `-Paglyn.passkeyRpId=aglyn.com`, and list the certificate's hash in the console's
  `PASSKEY_ANDROID_APK_KEY_HASHES`. The hash is the same certificate as base64url without padding (43 characters):
  `echo <hex fingerprint without colons> | xxd -r -p | base64 | tr '+/' '-_' | tr -d =`.

The server needs nothing for Apple: the credential's origin is `https://aglyn.com`, which it already accepts.
