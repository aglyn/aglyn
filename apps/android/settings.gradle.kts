/*
 * The one Gradle root for the native Kotlin apps: Aglyn and Aglyn POS on
 * Android, and both on the JVM desktop (Compose Multiplatform).
 *
 * It includes the app modules, the shared foundation under libs/native/kotlin
 * and every plugin's src/android module. Plugins come from the plugin id ->
 * module dir properties file the manifest generator writes.
 */
import java.util.Properties

pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
    // Microsoft's NuGet feed, for the WebView2 SDK's loader only (the Windows
    // Besigner; approved 2026-10-07). Nothing else resolves from here.
    ivy {
      name = "nuget"
      url = uri("https://api.nuget.org/v3-flatcontainer/")
      patternLayout { artifact("[module]/[revision]/[module].[revision].[ext]") }
      metadataSources { artifact() }
      content { includeGroup("nuget.microsoft") }
    }
  }
}

rootProject.name = "aglyn-native"

for (module in listOf("app", "pos", "desktop", "plugin-manifest")) {
  if (file("$module/build.gradle.kts").isFile) include(":$module")
}

val nativeLibs = listOf("core", "ui", "webview", "plugin-host", "contracts", "hardware", "shell")
for (lib in nativeLibs) {
  include(":native-$lib")
  project(":native-$lib").projectDir = file("../../libs/native/kotlin/$lib")
}
// Android only: the camera barcode scanner, for the apps that scan.
include(":native-camera")
project(":native-camera").projectDir = file("../../libs/native/kotlin/camera")

// Plugin id -> module dir, from each plugin's mobile.android block.
val plugins = Properties()
file("native-plugins.generated.properties").inputStream().use { plugins.load(it) }
for (id in plugins.stringPropertyNames().sorted()) {
  include(":plugin-$id")
  project(":plugin-$id").projectDir = file(plugins.getProperty(id))
}
