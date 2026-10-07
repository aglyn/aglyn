// The Bookings plugin's native code (Android + JVM desktop): today's bookings
// at the Aglyn POS counter, paid on this device's card reader. Reached only
// through the generated native plugin manifest; the app shells never import it.
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.compose.multiplatform)
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.plugins.bookings"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
    withHostTest {}
  }
  jvm("desktop")

  sourceSets {
    commonMain.dependencies {
      implementation(project(":native-plugin-host"))
      implementation(project(":native-ui"))
      implementation(project(":native-contracts"))
    }
    commonTest.dependencies {
      implementation(kotlin("test"))
      implementation(libs.kotlinx.coroutines.test)
      implementation(libs.ktor.client.mock)
    }
  }
}
