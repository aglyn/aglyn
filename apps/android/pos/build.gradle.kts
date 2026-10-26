// "Aglyn POS" for Android: com.aglyn.pos. Configured by build fields, never by a
// google-services.json; the debug build points at the local emulator stack.
import com.google.firebase.crashlytics.buildtools.gradle.CrashlyticsExtension

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  // Crash reports (AGL-4067): the build id every report is matched by, and the R8 mapping upload for release bundles.
  alias(libs.plugins.firebase.crashlytics)
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
    // The repo's release version (the root package.json): tools/scripts/native-release.mjs passes
    // -Paglyn.versionName, so a store build and the web name one release. 1.0.0 is Xcode's default too.
    versionName = setting("versionName", "1.0.0")
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
    // google_app_id for Analytics (buildTypes below).
    resValues = true
  }

  buildTypes {
    val releaseFirebaseAppId = setting("firebaseAppId", "1:543499566626:android:c66921bb5d51cf8b0d147b")
    crashlyticsAppId(releaseFirebaseAppId)
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
      val debugFirebaseAppId = setting("firebaseAppId", "1:000000000000:android:emulator")
      buildConfigField("String", "FIREBASE_APP_ID", quoted(debugFirebaseAppId))
      // Analytics reads the app id from this resource, not from FirebaseOptions (AGL-4067); collection stays off here.
      resValue("string", "google_app_id", debugFirebaseAppId)
      buildConfigField("String", "FIREBASE_MESSAGING_SENDER_ID", quoted(setting("firebaseMessagingSenderId", "000000000000")))
      buildConfigField("String", "AUTH_EMULATOR_HOST", quoted(setting("authEmulatorHost", "10.0.2.2:9099")))
      buildConfigField("String", "FIRESTORE_EMULATOR_HOST", quoted(setting("firestoreEmulatorHost", "10.0.2.2:8082")))
      // Firebase App Check: off, since the emulators do not enforce it (there is no App Check emulator).
      buildConfigField("String", "APP_CHECK", quoted(setting("appCheck", "off")))
      // Crash reports and Analytics: never from a debug build (AGL-4067).
      buildConfigField("String", "TELEMETRY", quoted("off"))
      configure<CrashlyticsExtension> { mappingFileUploadEnabled = false }
      // The seeded emulator member (tools/scripts/seed-native-emulator.mjs), for the debug sign-in form only.
      buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", quoted(setting("debugGoogleWebClientId", "")))
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
      buildConfigField("String", "FIREBASE_APP_ID", quoted(releaseFirebaseAppId))
      // Analytics reads the app id from this resource, not from FirebaseOptions (AGL-4067). The manifest removes Firebase's
      // init provider, so the resource never starts Firebase by itself.
      resValue("string", "google_app_id", releaseFirebaseAppId)
      buildConfigField("String", "FIREBASE_MESSAGING_SENDER_ID", quoted(setting("firebaseMessagingSenderId", "543499566626")))
      buildConfigField("String", "AUTH_EMULATOR_HOST", quoted(""))
      buildConfigField("String", "FIRESTORE_EMULATOR_HOST", quoted(""))
      // Firebase App Check (AGL-3818): production enforces it on Auth and Firestore, so a release build attests itself
      // through Play Integrity.
      buildConfigField("String", "APP_CHECK", quoted(setting("appCheck", "on")))
      // Crash reports, non-fatal errors and Analytics (AGL-4067): on for a release build on production; -Paglyn.telemetry=off
      // turns them off for a build that must not report.
      buildConfigField("String", "TELEMETRY", quoted(setting("telemetry", "on")))
      // The R8 mapping file goes to Crashlytics only from tools/scripts/native-release.mjs (-Paglyn.crashlyticsMappingUpload=true),
      // never from a local or CI build.
      configure<CrashlyticsExtension> { mappingFileUploadEnabled = setting("crashlyticsMappingUpload", "false").toBoolean() }
      // The Firebase project's Web OAuth client id, the audience of Google's ID token for "Continue with Google". Google also
      // needs an Android OAuth client for com.aglyn.pos and its signing certificates (apps/android/README.md, "What Zach owes").
      buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", quoted(setting("googleWebClientId", "543499566626-j9srpjdgmqtjk7rk1a0a1lbmf1l1l4e1.apps.googleusercontent.com")))
      buildConfigField("String", "DEBUG_EMAIL", quoted(""))
      buildConfigField("String", "DEBUG_PASSWORD", quoted(""))
      buildConfigField("boolean", "TERMINAL_LIVE_READERS", liveReaders)
    }
  }
}

// Stripe Terminal calls okhttp3.internal.Util, which OkHttp 5 (Ktor 3's engine) no longer has: without this pin every
// reader connect failed with "Unexpected failure" (NoClassDefFoundError) once a reader was found. Ktor's OkHttp engine
// runs on 4.12, the version Stripe Terminal ships against; Aglyn POS only, never the Aglyn app.
configurations.configureEach {
  resolutionStrategy.eachDependency {
    if (requested.group == "com.squareup.okhttp3" && requested.name in setOf("okhttp", "okhttp-tls")) {
      useVersion(libs.versions.stripe.terminal.okhttp.get())
      because("Stripe Terminal is built against OkHttp 4 and calls its internals")
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
  // The permission prompts' Activity Result API needs fragment 1.3+ (gradle/libs.versions.toml).
  constraints { implementation(libs.androidx.fragment) }
  // Card-on-device: Tap to Pay and Bluetooth readers (Aglyn POS only, never the Aglyn app).
  implementation(libs.stripe.terminal)
  implementation(libs.stripe.terminal.taptopay)
  // Card-not-present: Stripe's own card form takes a card typed in at the register, so the number never
  // touches our code (Aglyn POS only, never the Aglyn app).
  implementation(libs.stripe.paymentsheet)
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
}

/**
 * The Firebase app id the Crashlytics plugin uploads the release mapping file under. The plugin reads it from the
 * google-services plugin's task for the variant (`processReleaseGoogleServices`, its `gmpAppId` file); with Firebase
 * configured in code there is no google-services.json and that plugin is not applied, so a stand-in task of that name
 * carries the file this build writes from its own setting. The stand-in does no work of its own and adds no resources:
 * Firebase still starts from AndroidFirebase alone.
 */
abstract class WriteFirebaseAppId : DefaultTask() {
  @get:Input abstract val appId: Property<String>
  @get:OutputFile abstract val file: RegularFileProperty

  @TaskAction fun write() = file.get().asFile.writeText(appId.get())
}

fun crashlyticsAppId(appId: String) {
  val file = layout.buildDirectory.file("generated/crashlytics/release/gmpAppId.txt")
  val write = tasks.register<WriteFirebaseAppId>("writeReleaseFirebaseAppId") {
    this.appId.set(appId)
    this.file.set(file)
  }
  tasks.register<com.google.gms.googleservices.GoogleServicesTask>("processReleaseGoogleServices") {
    dependsOn(write)
    enabled = false
    gmpAppId.set(file)
  }
}
