// The native plugin surface: registrar, registry, plugin context and the
// deep-link grammar. The app shells read only this registry, never a plugin.
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.compose.multiplatform)
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.pluginhost"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
    withHostTest {}
  }
  jvm("desktop")

  sourceSets {
    commonMain.dependencies {
      api(project(":native-core"))
      api(libs.compose.runtime)
    }
    commonTest.dependencies {
      implementation(kotlin("test"))
    }
  }
}
