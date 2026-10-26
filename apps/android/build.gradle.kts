// Plugins are declared once here and applied per module.
plugins {
  alias(libs.plugins.android.application) apply false
  alias(libs.plugins.android.kmp.library) apply false
  alias(libs.plugins.kotlin.multiplatform) apply false
  alias(libs.plugins.kotlin.serialization) apply false
  alias(libs.plugins.compose.compiler) apply false
  alias(libs.plugins.compose.multiplatform) apply false
  alias(libs.plugins.firebase.crashlytics) apply false
  // On the classpath for its GoogleServicesTask only (gradle/libs.versions.toml); never applied.
  alias(libs.plugins.google.services) apply false
}
