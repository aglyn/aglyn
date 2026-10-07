// Console screens drawn from specs (docs/mobile/native-architecture.md §13):
// the grammar's reader and renderer, and core's own screens, whose specs in
// libs/native/screens are embedded at build time. Android + JVM desktop.
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.compose.multiplatform)
}

/** Embeds the core spec files as string constants, so every target reads the same bytes. */
abstract class EmbedScreenSpecs : DefaultTask() {
  @get:InputFiles
  @get:PathSensitive(PathSensitivity.NAME_ONLY)
  abstract val sources: ConfigurableFileCollection

  @get:OutputDirectory
  abstract val outputDir: DirectoryProperty

  @TaskAction
  fun write() {
    val out = outputDir.get().asFile.resolve("com/aglyn/screens").apply { deleteRecursively(); mkdirs() }
    val files = sources.files.filter { it.name.endsWith(".screens.json") }.sortedBy { it.name }
    val body = StringBuilder("// Embedded at build time from libs/native/screens.\npackage com.aglyn.screens\n\n")
    body.append("internal object CoreScreenJson {\n  val files: List<String> by lazy {\n    listOf(\n")
    for (file in files) {
      val chunks = file.readText().chunked(16_000).joinToString(" +\n      ") { chunk ->
        "\"" + chunk.replace("\\", "\\\\").replace("\"", "\\\"").replace("$", "\\$").replace("\n", "\\n") + "\""
      }
      body.append("      // ${file.name}\n      $chunks,\n")
    }
    body.append("    )\n  }\n}\n")
    out.resolve("CoreScreenJson.kt").writeText(body.toString())
  }
}

val screensDir = rootProject.file("../../libs/native/screens")
val embedSpecs = tasks.register<EmbedScreenSpecs>("embedScreenSpecs") {
  sources.from(fileTree(screensDir) { include("*.screens.json") })
  outputDir.set(layout.buildDirectory.dir("generated/screenSpecs/main"))
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.screens"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
    withHostTest {}
  }
  jvm("desktop")

  sourceSets {
    commonMain {
      kotlin.srcDir(embedSpecs.map { it.outputDir })
      dependencies {
        api(project(":native-plugin-host"))
        api(project(":native-ui"))
        implementation(project(":native-contracts"))
      }
    }
    commonTest.dependencies {
      implementation(kotlin("test"))
      implementation(libs.kotlinx.coroutines.test)
      implementation(libs.ktor.client.mock)
    }
    named("desktopTest") {
      dependencies {
        implementation(libs.compose.ui.test)
        implementation(compose.desktop.currentOs)
      }
    }
  }
}

// The snapshot renderer (SnapshotRenderTest) writes PNGs only when asked:
//   ./gradlew :native-screens:desktopTest -Paglyn.snapshotDir=/path
tasks.withType<Test>().configureEach {
  (findProperty("aglyn.snapshotDir") as String?)?.let { systemProperty("aglyn.snapshotDir", it) }
  inputs.property("aglyn.snapshotDir", findProperty("aglyn.snapshotDir") ?: "")
}
