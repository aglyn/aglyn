// POS peripherals: ESC/POS receipt printers, cash drawer and HID scanners.
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.hardware"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
  }
  jvm("desktop")

  sourceSets {
    commonMain.dependencies {
      api(libs.kotlinx.coroutines.core)
    }
  }
}
