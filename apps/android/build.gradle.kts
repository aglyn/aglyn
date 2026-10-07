// Plugins are declared once here and applied per module.
plugins {
  alias(libs.plugins.android.application) apply false
  alias(libs.plugins.android.kmp.library) apply false
  alias(libs.plugins.kotlin.multiplatform) apply false
  alias(libs.plugins.kotlin.serialization) apply false
  alias(libs.plugins.compose.compiler) apply false
  alias(libs.plugins.compose.multiplatform) apply false
}
