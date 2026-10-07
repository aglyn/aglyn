// Shared contracts generated from the console's pure TypeScript modules
// (Contracts.generated.kt, written by tools/scripts/generate-native-contracts.mjs).
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
  alias(libs.plugins.kotlin.serialization)
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.contracts"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
  }
  jvm("desktop")

  sourceSets {
    commonMain.dependencies {
      api(libs.kotlinx.serialization.json)
    }
  }
}
