/*
 * The one Gradle root for the native Kotlin apps: Aglyn and Aglyn POS on
 * Android, and both on the JVM desktop (Compose Multiplatform).
 *
 * It includes the app modules, the shared foundation under libs/native/kotlin
 * and every plugin's src/android module. Plugins come from the plugin id ->
 * module dir properties file the manifest generator writes; until that file
 * exists, the hand-written native-plugins.properties stands in with the same
 * shape.
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

/*
 * Plugin id -> module dir. The generated file is the source of truth; the
 * hand-written native-plugins.properties lists plugins whose native module
 * exists before plugins.config.json names it, and goes once the generator
 * covers them. A generated entry wins over a hand-written one.
 */
val plugins = Properties()
for (name in listOf("native-plugins.properties", "native-plugins.generated.properties")) {
  val source = file(name)
  if (source.isFile) source.inputStream().use { plugins.load(it) }
}
for (id in plugins.stringPropertyNames().sorted()) {
  include(":plugin-$id")
  project(":plugin-$id").projectDir = file(plugins.getProperty(id))
}
