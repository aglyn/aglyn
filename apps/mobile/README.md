# Aglyn app (`apps/mobile`)

The Aglyn app for iOS and Android, on phones and tablets (AGL-3620). It is built with Expo and React Native, and its bundle id is `com.aglyn.app`. The shell has sign-in, the workspace and site switcher, the dashboard, notifications and settings. Every other feature is either a plugin's mobile contribution or the console in an authenticated WebView.

## Layout

| Path | What it is |
| -- | -- |
| `apps/mobile` | The app shell. It is a standalone npm install with its own lockfile, so React Native never enters the root install. |
| `libs/mobile/core` | Firebase auth, the workspace and site switcher, the console API client, console sessions and the query cache |
| `libs/mobile/ui` | Theme tokens generated from the console palette, basic components, `useLayout()` and `SplitView` |
| `libs/mobile/webview` | The authenticated console WebView and its origin- and nonce-checked bridge |
| `libs/mobile/plugin-host` | The `registerMobile…` registrars, the registry, the manifest loader and deep links |
| `libs/plugins/<id>/src/mobile` | A plugin's mobile code, reached only through its `./mobile` export |
| `src/plugins.mobile.generated.ts` | The mobile plugin manifest, generated from each plugin's `mobile` block in `plugins.config.json` |
| `src/notification-catalog.generated.json` | The notification types, labels and defaults used by the push settings screen |

`check:mobile-isolation` makes sure the web and the apps never share a byte:

- No web file may import mobile code.
- Mobile code may reach only mobile code, mobile packages and the proven-pure modules listed in `tools/scripts/mobile-pure-modules.json`.

## Develop

```bash
npm ci --prefix apps/mobile
npm --prefix apps/mobile run typecheck   # the shell, libs/mobile/* and every plugin's src/mobile
npm --prefix apps/mobile test

# A local stack: the emulators on a demo- project, seeded with one member, one site and three redirects
(cd cloud && firebase emulators:start --only auth,firestore --project demo-aglyn)
node apps/mobile/scripts/seed-emulator.mjs     # prints the seeded sign-in

# Run on the iOS Simulator (needs CocoaPods)
EXPO_PUBLIC_CONSOLE_URL=http://localhost:4200 \
EXPO_PUBLIC_FIREBASE_API_KEY=emulator-api-key EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost \
EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-aglyn EXPO_PUBLIC_FIREBASE_APP_ID=1:000000000000:ios:emulator \
EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 \
npx --prefix apps/mobile expo run:ios
```

If a build fails with "No code signing certificates", the selected simulator runtime is not one Expo recognizes. Build with `xcodebuild -workspace ios/Aglyn.xcworkspace -scheme Aglyn -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO`, then install it with `xcrun simctl install`.

Regenerate the derived files after these changes:

| After you change | Run |
| -- | -- |
| A plugin's `mobile` block | `npm run generate:plugin-manifests` |
| A workspace alias | `npm run sync:next-tsconfigs` |
| The console palette | `npm run generate:mobile-theme-tokens` |
| A notification type | `npm run generate:mobile-notification-catalog` |

## Push notifications

- Each install registers `users/{uid}/devices/{installId}` with an Expo push token. Only the owner can read or write it, and the rules accept only the registry's own fields. Signing out removes the row.
- `notifyUsers` sends every notification the person's preferences allow to their devices through the Expo Push API. A type that has no push answer follows the console feed. The push code is server-only and loaded lazily, so published sites never load it.
- Each type has its own switch under Settings → Push notifications, stored at `notificationSettings.accountTypes.{type}.push`.
- Tapping a push opens its link natively when a plugin registered a deep link for it. Otherwise the link opens in the console WebView.
- Push is off until the server sets `MOBILE_PUSH_ENABLED=1`. Registration on the phone does nothing until the app is built with `EAS_PROJECT_ID`.

## What Zach owes before release

1. **Apple Developer:** register an App ID for `com.aglyn.app` with the Push Notifications and Associated Domains capabilities. Register `com.aglyn.pos` too, for AGL-3618.
2. **Expo / EAS:** create the Expo account and the EAS project `aglyn` (`eas.json` has the `development`, `preview` and `production` build profiles). Set `EAS_PROJECT_ID` for builds, and run `eas credentials` to upload the APNs key (`.p8`, Key ID, Team ID) and the FCM v1 service-account JSON. You can optionally turn on Expo's enhanced push security and set `EXPO_ACCESS_TOKEN` on the server.
3. **Firebase:** add an iOS app (`com.aglyn.app`) and an Android app (`com.aglyn.app`) to the production project. Their Firebase config goes into the `EXPO_PUBLIC_FIREBASE_*` build variables. The `GoogleService-Info.plist` and `google-services.json` files stay out of git.
4. **Google sign-in (optional):** create the iOS and web OAuth client ids, and set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. Until both are set, the button stays hidden.
5. **Google Play Console:** create the app "Aglyn" with package `com.aglyn.app`, and complete its store listing, content rating and data-safety form.
6. **App Store Connect:** create the app record, its store listing, its privacy labels and a TestFlight group.
7. **Legal:** add Expo (push relay) to the Subprocessors list, alongside Apple (APNs) and Google (FCM), before `MOBILE_PUSH_ENABLED=1` goes live in production. A notification's title and body pass through all three.
8. **Universal links:** set `EXPO_PUBLIC_CONSOLE_URL` to the production console, which adds `applinks:` for it, and serve `apple-app-site-association` and `assetlinks.json` from the console origin.
9. **npm:** hand-publish `@aglyn/mobile-core`, `-ui`, `-webview` and `-plugin-host` once (`npm run publish:packages -- --only <name> --publish`), then run `npm run trust:packages -- --set`. Until then they stay `private`.
