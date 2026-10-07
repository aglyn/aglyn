# Aglyn POS

The register app for iOS and Android: bundle `com.aglyn.pos`, display name
"Aglyn POS" (AGL-3618). It takes card payments with **Tap to Pay on iPhone**,
**Tap to Pay on Android** and **Bluetooth card readers** (Stripe Reader M2,
BBPOS WisePad 3) through the Stripe Terminal React Native SDK, and it takes
payment for **bookings** at the counter.

## How it works

1. Sign in with the Aglyn console account (Firebase Auth, JS SDK).
2. Pick the store (sites where you are an `admin` or `editor`) and register.
3. **Register.** The console's own POS page runs in an authenticated WebView.
   The app injects `window.AglynPosBridge`. When the cashier chooses
   "Tap to Pay / card reader", the page asks the server for a card-present
   PaymentIntent (`commerce/pos-payment`, action `card-present-sdk`) and hands
   its client secret to the app. The app collects the card with the Terminal
   SDK and reports `collected`, `canceled` or `failed`. The page then asks
   the server to settle it, and the server re-reads the intent from Stripe.
   The app never creates, prices or captures money.
4. **Bookings.** Today's bookings list in the app. For one not paid online,
   staff enter the amount and the customer taps. `bookings/in-person-payment`
   prices it (plus the merchant's service tax), creates the intent, and
   captures it after collection. The console's existing booking refund works
   on it.
5. **Readers panel.** Tap to Pay (with Apple's "How to Tap" education before
   first use), Bluetooth discovery, connect, reader software updates, battery,
   and automatic reconnect. In test mode, Stripe's simulated readers are on
   by default.

The SDK's connection token comes from
`POST /api/commerce/pos-terminal-connection-token`. It is gated exactly like
a register sale (`managePos`, a site role that may sell, the `pos` plan
entitlement) and scoped to the store's own Terminal Location. A store with no
Location registers its address from the readers panel (action `location`).

Phone uses a full-screen register with the readers as a sheet. A tablet
(shorter side at least 600pt) keeps the readers and bookings beside the
register.

## Develop

```bash
cd apps/pos-mobile
npm install                       # the app's own node_modules (React Native, Expo)
# .env.development (git-ignored): the seeded emulator stack, below
npx expo prebuild --clean         # generates ios/ and android/ (ignored)
npx expo run:ios                  # iPhone or iPad simulator
npx expo run:android              # emulator or device
npx jest                          # app specs, plus libs/mobile and the bookings ./mobile entry
npx tsc --noEmit -p tsconfig.json
```

Tap to Pay cannot run on a simulator. Use the readers panel's simulated
readers (test mode), which exercise the same SDK calls.

### Local stack

Create `apps/pos-mobile/.env.development` (git-ignored) to point the app at
the seeded Firebase emulators and the console on localhost. Never use live
data.

```bash
EXPO_PUBLIC_CONSOLE_URL=http://localhost:4200
EXPO_PUBLIC_FIREBASE_API_KEY=emulator-api-key
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost
EXPO_PUBLIC_FIREBASE_PROJECT_ID=aglyn-main
EXPO_PUBLIC_FIREBASE_APP_ID=1:000000000000:ios:emulator
EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8082
```

### Environment

| Variable | Where | What |
| -- | -- | -- |
| `EXPO_PUBLIC_CONSOLE_URL` | app | The console origin the app signs into and the WebView loads. |
| `EXPO_PUBLIC_FIREBASE_*` | app | The Firebase web config: `API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `APP_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`. |
| `EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST`, `EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST` | app | Local emulator stack only. |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | app | Google sign-in. |
| `AGLYN_POS_TAP_TO_PAY_ENTITLEMENT=1` | build | Signs the Tap to Pay entitlement into the iOS build. Set it only once Apple has granted it, or the build will not install. |
| `EXPO_OWNER` | build | The EAS account. |
| `STRIPE_SECRET_KEY` | server | `sk_test_…` offers simulated readers. |
| `STRIPE_TERMINAL_LIVE_ENABLED=true` | server | Live card readers. Until it is set, live mode offers no reader at all. |

## What Zach owes before release

- [ ] **Apple Tap to Pay on iPhone entitlement.** Request
      `com.apple.developer.proximity-reader.payment.acceptance` for the team,
      then build with `AGLYN_POS_TAP_TO_PAY_ENTITLEMENT=1`. Live testing
      needs a physical iPhone XS or later on iOS 16.4+.
- [ ] **Apple App ID** `com.aglyn.pos` with the entitlement above, and an
      App Store Connect app named "Aglyn POS".
- [ ] **EAS project** for `aglyn-pos` (`eas init`), with iOS and Android
      credentials (distribution certificate, provisioning profile, upload key).
- [ ] **Firebase apps.** An iOS app and an Android app for `com.aglyn.pos` in
      the production Firebase project. Their web config goes in the
      `EXPO_PUBLIC_FIREBASE_*` EAS secrets, and their OAuth client ids in
      `EXPO_PUBLIC_GOOGLE_*`.
- [ ] **Google Play Console app** "Aglyn POS", package `com.aglyn.pos`. Tap
      to Pay on Android needs an NFC phone on Android 13+, and Stripe's
      Tap to Pay process check is already in the build.
- [ ] **Stripe Terminal live mode.** Activate Terminal for live payments on
      the platform account, enable Tap to Pay for iPhone and Android in the
      Stripe Dashboard, then set `STRIPE_TERMINAL_LIVE_ENABLED=true`.
- [ ] **Bluetooth readers.** Order an M2 or a WisePad 3 to test live.

## Boundaries

- The app imports only `libs/mobile/*`, RN/Expo packages, pure shared
  modules, and plugin `./mobile` entries through the generated mobile
  manifest. `check-mobile-isolation` enforces this in both directions.
- Nothing here reaches a web bundle. The web register only feature-detects
  `window.AglynPosBridge`.
