// Aglyn native core: config, auth and Firestore seams, the console API client,
// the workspace store and deep-link grammar. commonMain is platform-free;
// androidMain binds the Firebase Android SDK, desktopMain the REST APIs.
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
  alias(libs.plugins.kotlin.serialization)
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.core"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
    withHostTest {}
  }
  jvm("desktop")

  sourceSets {
    commonMain.dependencies {
      api(libs.kotlinx.coroutines.core)
      api(libs.kotlinx.serialization.json)
      api(libs.ktor.client.core)
    }
    commonTest.dependencies {
      implementation(kotlin("test"))
      implementation(libs.kotlinx.coroutines.test)
      implementation(libs.ktor.client.mock)
    }
    androidMain.dependencies {
      implementation(libs.ktor.client.okhttp)
      implementation(libs.kotlinx.coroutines.android)
      implementation(libs.kotlinx.coroutines.play.services)
      api(libs.firebase.auth)
      api(libs.firebase.firestore)
    }
    named("desktopMain") {
      dependencies {
        implementation(libs.ktor.client.java)
      }
    }
  }
}
