// The Workflows plugin's native screens: Automation (Android + JVM desktop). Reached only
// through the generated native plugin manifest; the app shells never import it.
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.compose.multiplatform)
}

/** Embeds the plugin's staff spec files as string constants, so every target reads the same bytes. */
abstract class EmbedScreenSpecs : DefaultTask() {
  @get:InputFiles
  @get:PathSensitive(PathSensitivity.NAME_ONLY)
  abstract val sources: ConfigurableFileCollection

  @get:OutputDirectory
  abstract val outputDir: DirectoryProperty

  @TaskAction
  fun write() {
    val out = outputDir.get().asFile.resolve("com/aglyn/plugins/workflows").apply { deleteRecursively(); mkdirs() }
    val files = sources.files.filter { it.name.endsWith(".screens.json") }.sortedBy { it.name }
    val body = StringBuilder("// Embedded at build time from screens/.\npackage com.aglyn.plugins.workflows\n\n")
    body.append("internal object WorkflowsScreenJson {\n  val files: List<String> by lazy {\n    listOf(\n")
    for (file in files) {
      val chunks = file.readText().replace("\r\n", "\n").chunked(16_000).joinToString(" +\n      ") { chunk ->
        "\"" + chunk.replace("\\", "\\\\").replace("\"", "\\\"").replace("$", "\\$").replace("\n", "\\n").replace("\r", "\\r") + "\""
      }
      body.append("      $chunks,\n")
    }
    body.append("    )\n  }\n}\n")
    out.resolve("WorkflowsScreenJson.kt").writeText(body.toString())
  }
}

val embedSpecs = tasks.register<EmbedScreenSpecs>("embedScreenSpecs") {
  sources.from(fileTree(layout.projectDirectory.dir("screens")) { include("*.screens.json") })
  outputDir.set(layout.buildDirectory.dir("generated/screenSpecs/main"))
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.plugins.workflows"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
    withHostTest {}
  }
  jvm("desktop")

  sourceSets {
    commonMain {
      kotlin.srcDir(embedSpecs.map { it.outputDir })
      dependencies {
        implementation(project(":native-plugin-host"))
        implementation(project(":native-screens"))
        implementation(project(":native-ui"))
        implementation(project(":native-contracts"))
      }
    }
    commonTest.dependencies {
      implementation(kotlin("test"))
      implementation(libs.kotlinx.coroutines.test)
    }
  }
}

// The production-shapes test reads the documents the native seed writes from libs/native/contracts (AGL-3993).
tasks.withType<Test>().configureEach {
  systemProperty("aglyn.contractsDir", file("../../../../native/contracts").absolutePath)
}
