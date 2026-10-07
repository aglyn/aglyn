// The native plugin manifest: depends on every plugin module the properties
// files name, and lists each plugin's declaration and registrar.
import java.util.Properties

plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
}

val pluginIds: List<String> = Properties().apply {
  for (name in listOf("native-plugins.properties", "native-plugins.generated.properties")) {
    val source = rootProject.file(name)
    if (source.isFile) source.inputStream().use { load(it) }
  }
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
