// "Aglyn POS" for Android: com.aglyn.pos. Configured by build fields, never by a
// google-services.json; the debug build points at the local emulator stack.
plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
}

/** A build setting from -Paglyn.<name>=… or the environment, else [fallback]. */
fun setting(name: String, fallback: String): String =
  (findProperty("aglyn.$name") as String?)
    ?: System.getenv("AGLYN_" + name.replace(Regex("([A-Z])"), "_$1").uppercase())
    ?: fallback

fun quoted(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

kotlin { jvmToolchain(21) }

android {
  namespace = "com.aglyn.pos"
  compileSdk = libs.versions.android.compileSdk.get().toInt()

  defaultConfig {
    applicationId = "com.aglyn.pos"
    minSdk = libs.versions.android.minSdk.get().toInt()
    targetSdk = libs.versions.android.targetSdk.get().toInt()
    // Every store upload needs a higher code: tools/scripts/native-release.mjs passes
    // -Paglyn.versionCode=<minutes since 1970, UTC>, which stays under Play's 2,100,000,000 for millennia.
    versionCode = setting("versionCode", "1").toInt()
    versionName = "0.1.0"
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  // The upload key (Play App Signing re-signs for the store). Applied only when the
  // keystore is named (-Paglyn.uploadKeystore or AGLYN_UPLOAD_KEYSTORE, plus the alias and
  // both passwords), so CI and local release builds without it still build, unsigned.
  // The keystore and its passwords never live in the repo (apps/android/README.md, "Release").
  val uploadKeystore = setting("uploadKeystore", "")
  val uploadSigning = if (uploadKeystore.isEmpty()) null else signingConfigs.create("upload") {
    storeFile = file(uploadKeystore)
    storePassword = setting("uploadStorePassword", "")
    keyAlias = setting("uploadKeyAlias", "aglyn-upload")
    keyPassword = setting("uploadKeyPassword", setting("uploadStorePassword", ""))
  }

  buildFeatures {
    buildConfig = true
    compose = true
  }

  buildTypes {
    // Stripe Terminal's real readers (Tap to Pay, Bluetooth). Off: the SDK's
    // simulated readers only, until Stripe Terminal live mode is set up.
    val liveReaders = setting("terminalLiveReaders", "false").toBoolean().toString()
    val emulatorProject = setting("firebaseProjectId", "demo-aglyn")
    debug {
      applicationIdSuffix = ".dev"
      buildConfigField("String", "CONSOLE_URL", quoted(setting("consoleUrl", "http://10.0.2.2:4200")))
      buildConfigField("String", "FIREBASE_API_KEY", quoted(setting("firebaseApiKey", "emulator-api-key")))
      buildConfigField("String", "FIREBASE_AUTH_DOMAIN", quoted(setting("firebaseAuthDomain", "localhost")))
      buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(emulatorProject))
      buildConfigField("String", "FIREBASE_APP_ID", quoted(setting("firebaseAppId", "1:000000000000:android:emulator")))
      buildConfigField("String", "FIREBASE_MESSAGING_SENDER_ID", quoted(setting("firebaseMessagingSenderId", "000000000000")))
      buildConfigField("String", "AUTH_EMULATOR_HOST", quoted(setting("authEmulatorHost", "10.0.2.2:9099")))
      buildConfigField("String", "FIRESTORE_EMULATOR_HOST", quoted(setting("firestoreEmulatorHost", "10.0.2.2:8082")))
      // The seeded emulator member (tools/scripts/seed-native-emulator.mjs), for the debug sign-in form only.
      buildConfigField("String", "DEBUG_EMAIL", quoted("mobile-owner@example.test"))
      buildConfigField("String", "DEBUG_PASSWORD", quoted("seed-$emulatorProject-mobile"))
      buildConfigField("boolean", "TERMINAL_LIVE_READERS", "false")
    }
    release {
      isMinifyEnabled = true
      uploadSigning?.let { signingConfig = it }
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      // The production project (aglyn-main): PUBLIC client config, the same kind the console's
      // NEXT_PUBLIC_FIREBASE_* carry. Any of it can be overridden with -Paglyn.<name>.
      buildConfigField("String", "CONSOLE_URL", quoted(setting("consoleUrl", "https://app.aglyn.com")))
      buildConfigField("String", "FIREBASE_API_KEY", quoted(setting("firebaseApiKey", "AIzaSyCZwXDRwRP_fhDsmG_xDC3zKfYfwEh42D4")))
      buildConfigField("String", "FIREBASE_AUTH_DOMAIN", quoted(setting("firebaseAuthDomain", "aglyn-main.firebaseapp.com")))
      buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(setting("firebaseProjectId", "aglyn-main")))
      buildConfigField("String", "FIREBASE_APP_ID", quoted(setting("firebaseAppId", "1:543499566626:android:c66921bb5d51cf8b0d147b")))
      buildConfigField("String", "FIREBASE_MESSAGING_SENDER_ID", quoted(setting("firebaseMessagingSenderId", "543499566626")))
      buildConfigField("String", "AUTH_EMULATOR_HOST", quoted(""))
      buildConfigField("String", "FIRESTORE_EMULATOR_HOST", quoted(""))
      buildConfigField("String", "DEBUG_EMAIL", quoted(""))
      buildConfigField("String", "DEBUG_PASSWORD", quoted(""))
      buildConfigField("boolean", "TERMINAL_LIVE_READERS", liveReaders)
    }
  }
}

dependencies {
  implementation(project(":native-shell"))
  implementation(project(":plugin-manifest"))
  implementation(project(":native-camera"))
  implementation(libs.androidx.activity.compose)
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.core.splashscreen)
  // Card-on-device: Tap to Pay and Bluetooth readers (Aglyn POS only, never the Aglyn app).
  implementation(libs.stripe.terminal)
  implementation(libs.stripe.terminal.taptopay)
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
}
