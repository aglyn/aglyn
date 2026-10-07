// The native plugin manifest: depends on every plugin module the generated
// properties file names, and lists each plugin's declaration and registrar.
import java.util.Properties

plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
}

val pluginIds: List<String> = Properties().apply {
  rootProject.file("native-plugins.generated.properties").inputStream().use { load(it) }
}.stringPropertyNames().sorted()

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.plugins.manifest"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
  }
  jvm("desktop")

  sourceSets {
    commonMain.dependencies {
      api(project(":native-plugin-host"))
      for (id in pluginIds) implementation(project(":plugin-$id"))
    }
    commonTest.dependencies {
      implementation(kotlin("test"))
    }
  }
}
