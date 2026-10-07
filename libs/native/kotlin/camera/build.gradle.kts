// The camera barcode scanner for the Android apps: a CameraX preview read by
// ML Kit's bundled barcode model, provided to the kit's scan sheet through
// LocalCameraScanner. Android only (the desktop reads keyboard-wedge
// scanners), and only the apps that scan include it.
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.compose.multiplatform)
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.camera"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
  }

  sourceSets {
    androidMain.dependencies {
      implementation(project(":native-ui"))
      implementation(libs.androidx.activity.compose)
      implementation(libs.androidx.camera.camera2)
      implementation(libs.androidx.camera.lifecycle)
      implementation(libs.androidx.camera.view)
      implementation(libs.androidx.camera.mlkit.vision)
      implementation(libs.mlkit.barcode.scanning)
    }
  }
}
