// The shared app shells for Aglyn and Aglyn POS: sign-in, workspace and site
// switcher, Home, plugin destinations, Notifications and Settings. Android
// and desktop entry points host these; plugins arrive only through the
// manifest the app module passes in.
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.compose.multiplatform)
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.shell"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
  }
  jvm("desktop")

  sourceSets {
    commonMain.dependencies {
      api(project(":native-core"))
      api(project(":native-ui"))
      api(project(":native-plugin-host"))
      implementation(project(":native-webview"))
      implementation(libs.compose.ui.backhandler)
    }
    androidMain.dependencies {
      implementation(libs.androidx.activity.compose)
    }
    named("desktopTest") {
      dependencies {
        implementation(kotlin("test"))
        implementation(libs.compose.ui.test)
        implementation(compose.desktop.currentOs)
      }
    }
  }
}
