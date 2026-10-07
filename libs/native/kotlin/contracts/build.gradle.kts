// Shared contracts generated from the console's pure TypeScript modules
// (Contracts.generated.kt, written by tools/scripts/generate-native-contracts.mjs),
// the values and catalogs in libs/native/contracts/*.generated.json, and the
// formatters ported once from those modules.
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
  alias(libs.plugins.kotlin.serialization)
}

/**
 * Embeds JSON files as Kotlin string constants, so every target reads the
 * same bytes with no platform resource loader. Build output only.
 */
abstract class EmbedJson : DefaultTask() {
  @get:InputFiles
  @get:PathSensitive(PathSensitivity.NAME_ONLY)
  abstract val sources: ConfigurableFileCollection

  @get:Input
  abstract val objectName: Property<String>

  @get:OutputDirectory
  abstract val outputDir: DirectoryProperty

  @TaskAction
  fun write() {
    val out = outputDir.get().asFile.resolve("com/aglyn/contracts").apply { deleteRecursively(); mkdirs() }
    val body = StringBuilder("// Embedded at build time from libs/native/contracts.\npackage com.aglyn.contracts\n\n")
    body.append("internal object ${objectName.get()} {\n")
    for (file in sources.files.sortedBy { it.name }) {
      val name = file.name.removeSuffix(".generated.json").split('-')
        .mapIndexed { i, part -> if (i == 0) part else part.replaceFirstChar { it.uppercase() } }.joinToString("")
      val chunks = file.readText().chunked(16_000).joinToString(",\n    ") { chunk ->
        "\"" + chunk.replace("\\", "\\\\").replace("\"", "\\\"").replace("$", "\\$").replace("\n", "\\n") + "\""
      }
      body.append("  val $name: String by lazy {\n    listOf(\n    $chunks,\n    ).joinToString(\"\")\n  }\n")
    }
    body.append("}\n")
    out.resolve("${objectName.get()}.kt").writeText(body.toString())
  }
}

val contractsDir = rootProject.file("../../libs/native/contracts")
val embedMainJson = tasks.register<EmbedJson>("embedContractJson") {
  sources.from(contractsDir.resolve("contracts.generated.json"), contractsDir.resolve("notification-catalog.generated.json"))
  objectName.set("ContractJson")
  outputDir.set(layout.buildDirectory.dir("generated/contractJson/main"))
}
val embedTestJson = tasks.register<EmbedJson>("embedContractCaseJson") {
  sources.from(contractsDir.resolve("function-cases.generated.json"), contractsDir.resolve("list-query-cases.generated.json"), contractsDir.resolve("notification-settings-cases.generated.json"))
  objectName.set("ContractCaseJson")
  outputDir.set(layout.buildDirectory.dir("generated/contractJson/test"))
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.contracts"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
    withHostTest {}
  }
  jvm("desktop")

  sourceSets {
    commonMain {
      kotlin.srcDir(embedMainJson)
      dependencies {
        api(libs.kotlinx.serialization.json)
      }
    }
    commonTest {
      kotlin.srcDir(embedTestJson)
      dependencies {
        implementation(kotlin("test"))
      }
    }
  }
}
