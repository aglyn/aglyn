// POS peripherals: the printer-neutral receipt document, the ESC/POS
// encoder (receipt bytes and the drawer kick), receipt printers, HID barcode
// scanners and the card collector a register's card reader sits behind.
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
    commonTest.dependencies {
      implementation(kotlin("test"))
      implementation(libs.kotlinx.coroutines.test)
    }
  }
}
