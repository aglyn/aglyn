# Files that link the native apps to the passkey domain

A passkey belongs to the domain it was made for (`aglyn.com`, the same relying party the web console uses), so the
domain must say which apps may use it. The console also says which of its paths the apps open (universal links and
App Links).

Both files are served by the apps themselves, from the environment (AGL-3817), and the two templates here only show
their shape:

| File | Served at (exactly, no redirect, `application/json`) | Built from |
| -- | -- | -- |
| `apple-app-site-association.example.json` | `/.well-known/apple-app-site-association` | `NATIVE_APPLE_APP_IDS`: comma-separated `<team id>.<bundle id>` |
| `assetlinks.example.json` | `/.well-known/assetlinks.json` | `NATIVE_ANDROID_APPS`: `;`-separated `<package>=<sha256>,<sha256>` |

Where they answer:

- the console's own host (`NEXT_PUBLIC_CONSOLE_URL`): `webcredentials`, plus `applinks` for the console paths the
  native deep-link grammar resolves (workspace and site pages, the Besigner, account, billing, support and staff
  pages). Sign-in, sign-up, verification, password reset, SSO, sign-out, the admin bar's connect page, kiosk pages,
  `/api` and `/_*` stay in the browser. The list is `libs/aglyn/src/lib/app-utils/native-app-association.ts`, held to
  the console's route set and the native link specs by `apps/console/specs/native-app-association.spec.ts`;
- the platform home site (`NEXT_PUBLIC_PLATFORM_HOME_URL`'s host), served by the tenant app: `webcredentials` only,
  since its paths are site pages;
- every other host (a customer's site, a white-label console): 404, as is either file when its variable is unset.

`assetlinks.json` grants every listed package `delegate_permission/common.handle_all_urls` and
`delegate_permission/common.get_login_creds`. List both the Play app signing certificate and the upload certificate,
so locally signed release builds verify too.

Then, per platform:

- Apple: the Associated Domains capability `webcredentials:aglyn.com` on the `com.aglyn.app` target's entitlements, and
  `AGLYN_PASSKEY_RP_ID = aglyn.com` in `Config/Release.xcconfig` once production serves the file.
- Android: build the release with `-Paglyn.passkeyRpId=aglyn.com`, and list the certificate's hash in the console's
  `PASSKEY_ANDROID_APK_KEY_HASHES`. The hash is the same certificate as base64url without padding (43 characters):
  `echo <hex fingerprint without colons> | xxd -r -p | base64 | tr '+/' '-_' | tr -d =`.

The server needs nothing more for Apple: the credential's origin is `https://aglyn.com`, which it already accepts.
