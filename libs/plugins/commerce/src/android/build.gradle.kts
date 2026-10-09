// The Commerce plugin's native code (Android + JVM desktop): the Aglyn POS
// register. Reached only through the generated native plugin manifest; the
// app shells never import it.
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
  alias(libs.plugins.kotlin.serialization)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.compose.multiplatform)
}

/** Embeds the plugin's spec files as string constants, so every target reads the same bytes. */
abstract class EmbedScreenSpecs : DefaultTask() {
  @get:InputFiles
  @get:PathSensitive(PathSensitivity.NAME_ONLY)
  abstract val sources: ConfigurableFileCollection

  @get:OutputDirectory
  abstract val outputDir: DirectoryProperty

  @TaskAction
  fun write() {
    val out = outputDir.get().asFile.resolve("com/aglyn/plugins/commerce").apply { deleteRecursively(); mkdirs() }
    val files = sources.files.filter { it.name.endsWith(".screens.json") }.sortedBy { it.name }
    val body = StringBuilder("// Embedded at build time from screens/.\npackage com.aglyn.plugins.commerce\n\n")
    body.append("internal object CommerceScreenJson {\n  val files: List<String> by lazy {\n    listOf(\n")
    for (file in files) {
      val chunks = file.readText().chunked(16_000).joinToString(" +\n      ") { chunk ->
        "\"" + chunk.replace("\\", "\\\\").replace("\"", "\\\"").replace("$", "\\$").replace("\n", "\\n") + "\""
      }
      body.append("      $chunks,\n")
    }
    body.append("    )\n  }\n}\n")
    out.resolve("CommerceScreenJson.kt").writeText(body.toString())
  }
}

val embedSpecs = tasks.register<EmbedScreenSpecs>("embedScreenSpecs") {
  sources.from(fileTree(layout.projectDirectory.dir("screens")) { include("*.screens.json") })
  outputDir.set(layout.buildDirectory.dir("generated/screenSpecs/main"))
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.plugins.commerce"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
    withHostTest {}
  }
  jvm("desktop")

  sourceSets {
    commonMain {
      kotlin.srcDir(embedSpecs.map { it.outputDir })
    }
    commonMain.dependencies {
      implementation(project(":native-plugin-host"))
      implementation(project(":native-screens"))
      implementation(project(":native-ui"))
      implementation(project(":native-contracts"))
      implementation(libs.kotlinx.serialization.json)
    }
    commonTest.dependencies {
      implementation(kotlin("test"))
      implementation(libs.kotlinx.coroutines.test)
    }
  }
}
