// Aglyn's Material 3 theme and components for Compose Multiplatform
// (Android + JVM desktop): brand ColorScheme from the console tokens,
// list rows, empty states, skeletons, status chips and adaptive scaffolding.
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.compose.multiplatform)
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.ui"
    // Packs the composeResources (font, logo) into the AAR's assets.
    androidResources { enable = true }
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
  }
  jvm("desktop")

  sourceSets {
    commonMain.dependencies {
      api(libs.compose.runtime)
      api(libs.compose.foundation)
      api(libs.compose.ui)
      api(libs.compose.material3)
      api(libs.compose.material3.navigation.suite)
      api(libs.compose.material3.adaptive.layout)
      api(libs.compose.material.icons.extended)
      implementation(libs.compose.components.resources)
      implementation(libs.compose.ui.backhandler)
      // The calendars read days on a zone's wall clock (LocalDays).
      implementation(project(":native-contracts"))
    }
  }
}

compose.resources {
  packageOfResClass = "com.aglyn.ui.resources"
}
