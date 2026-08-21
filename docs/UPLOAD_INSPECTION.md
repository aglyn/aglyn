# Upload inspection (AGL-1475)

What the platform does to an uploaded file before it stores it, what it
deliberately does not do, and the ordered runbook for adding real malware
scanning if and when that becomes affordable.

**Read the second section before writing any customer-facing sentence about
this.** The media docs claimed uploads received "virus scanning" for months.
That was never true of any path, AGL-2463 removed the sentence, and the
control described here is *not* the thing that would make it true again.

## What ships today: structural validation

`libs/aglyn/src/lib/app-utils/upload-inspection.ts`, called at every ingress
that accepts caller-supplied bytes. Four checks, all in-process, all free:

| Check | Refusal code | What it catches |
| -- | -- | -- |
| Executable containers | `executable_bytes` | Windows PE (`MZ`), Linux ELF, macOS Mach-O, Java class, `ar`/Debian, RPM, Windows `.lnk` — under **any** declared content type or file name. |
| Declared type vs bytes | `type_mismatch` | A file whose container header disagrees with its content type: an `.exe` labelled `application/pdf`, an HTML page labelled `image/png`, a `.docx` that is not a ZIP. |
| Office macro payload | `macro_payload` | A `vbaProject.bin` entry inside a `.docx`/`.xlsx`/`.pptx`, or a `_VBA_PROJECT` stream in a legacy `.doc`/`.xls`/`.ppt` — including a macro-enabled file simply renamed to a non-macro extension, which the AGL-1465 content-type gate could never see. |
| EICAR signature | `signature_match` | The industry-standard antivirus test string. **A signature list of one.** It is there so the platform answers the probe a reviewer will actually try, and so this module's tests are honest without a real sample in the repository. It is not an engine and must not be grown into one here. |

Text types — `text/plain`, `text/csv`, `text/markdown`, `application/json`,
`image/svg+xml` — have no container header, so the type-match check does not
apply to them. The executable check still does, which is the one that matters:
a PE renamed `notes.txt` is refused. SVGs are separately sanitized
(`sanitize-svg.ts`, AGL-1474).

### What it does NOT catch

Stated plainly, because the gap between these two lists is the whole risk:

- **A malicious PDF that is a genuine PDF.** Every structural check passes.
- **A document exploiting a reader** without using macros.
- **Anything inside a plain `application/zip`.** A brand kit may legitimately
  contain a build tool; the archive's own header is checked and its contents
  are not.
- **An obfuscated payload in a JSON or text file.**
- **Everything already in the bucket.** This runs at ingress only. The ~451
  objects stored before it existed have never been inspected, and nothing here
  inspects them retroactively.
- **Any novel malware, of any kind.** There are no malware signatures.

## Every ingress, and its coverage

Enforced by `apps/console/specs/upload-inspection-coverage.spec.ts`, which
fails if a new bucket write appears that is neither covered nor exempted.

| # | Ingress | Bytes reach us? | Covered |
| -- | -- | -- | -- |
| 1 | `apps/console/app/api/media/upload/route.ts` | Yes, base64 JSON | Yes |
| 2 | `apps/console/app/api/media/upload-url/route.ts` (finalize) | **No** — browser PUTs straight to GCS | Yes, via two ranged reads |
| 3 | `apps/console/app/api/media/replace/route.ts` | Yes | Yes |
| 4 | `apps/console/utils/api-v1-resources.ts` (`/v1` media write, AGL-2463) | Yes | Yes |
| 5 | `libs/plugins/marketplace/src/lib/server/preview-image.ts` | Yes | Yes |

**The signed route (#2) is the interesting one.** Its whole purpose is that a
200 MB video never enters the function, so downloading it back to inspect it
would cost more than the feature. It does not have to: every signature this
module knows lives in the first few bytes, or — for a document archive's
central directory — the last few. Finalize therefore issues one ranged GET of
at most 4 KB from the front, plus a 64 KB tail read **only** for the OOXML and
legacy Office types whose macro entries live there, and never for a video. A
refusal deletes the orphaned object, matching the quarantine branch beside it.

Exempt, with reasons recorded in the coverage spec:

- `apps/console/app/api/admin/audit-archive/route.ts` — server-generated JSONL.
- `libs/plugins/marketplace/src/lib/server/publish-plugin.ts` — the bundle is
  JavaScript by design. Its controls are static verification, a
  content-addressed immutable path, review on the version, and an Ed25519
  signature checked before the realm executes it.

## What a detection can and cannot undo

Structural refusals are **synchronous and pre-storage**: nothing is written, no
object exists, `counters/media` does not move, and there is nothing to undo.
The merchant sees the reason in the media library (the snackbar persists for a
structural refusal rather than auto-dismissing); `/v1` callers get `415` with
the code.

For a file that is *already stored* — which is every pre-existing object, and
anything real AV would find later — the lever is asset quarantine
(`/api/media/quarantine`, AGL-1512/1613), keyed by content digest, enforced at
delivery and at re-upload, with download-token rotation for lockdowns
(AGL-1526). Staff surface: `/admin/media-quarantine`.

**A takedown cannot recall bytes already served (AGL-1615).** Quarantine stops
future delivery from our origin. It does not reach a CDN edge cache that has
already stored the object, a browser cache, a proxy, or any copy a visitor
downloaded. Treat a detection on a public asset as "stop the bleeding", never
as "it was never published", and assume anything with meaningful traffic has
already been distributed.

## Options considered, with costs

At current volume: ~451 objects, 46.9 MiB total, against a **$20/month** GCP
budget alert.

| Option | Realistic monthly cost | Verdict |
| -- | -- | -- |
| **ClamAV on Cloud Run, `min-instances=1`** | ~$35–50. ClamAV holds a ~250 MB signature database in memory and wants 2 GB RAM; an always-warm 2 GB / 1 vCPU instance alone exceeds the entire budget. | **Unaffordable today.** The correct answer eventually. |
| **ClamAV on Cloud Run, scale-to-zero** | ~$1–3 at our volume. | **Rejected on behaviour, not price.** A cold start loads the signature DB: 30–60 s before the first byte is scanned. Every upload after an idle period would hang or need an async queue, which is most uploads at 451 objects of lifetime traffic. |
| **Firebase "Storage malware scanner" extension** | Same as above — it *is* ClamAV on Cloud Run underneath, plus Eventarc. | Same verdict; no saving from the packaging. |
| **Google Cloud Web Risk** | ~$0 at our volume. | **Wrong tool.** Web Risk is a malicious-URL blocklist. It does not scan file contents and cannot answer any question asked here. Listed only because it keeps being suggested. |
| **VirusTotal public API** | $0 | **Cannot be used.** 4 requests/minute, 500/day, and the terms forbid commercial use. The premium tier is enterprise-priced (thousands/year). |
| **Structural validation in-process** | **$0.** No new service, no new dependency, a few KB of egress on one route. | **Shipped.** Catches type confusion, disguised executables and macro payloads. Catches no malware. |

**Recommendation, and what was built:** the honest answer before Sept 1 is that
full AV does not fit the budget, so the structural half was built properly and
named accurately rather than shipping something that reads like AV and is not.
The seam for the other half already exists — `inspectUploadBytes` is a pure
function returning a refusal, called at all five ingresses, and an async
scanner would slot in beside it feeding detections into the existing quarantine
deny list rather than a parallel path.

## Runbook — adding ClamAV later (owner: Zach)

Not done, and **deliberately not started**: it creates billable GCP resources.
In order:

1. **Decide the budget first.** Raise the `aglyn-main monthly spend` budget
   alert from $20 before creating anything, or the first invoice trips it.
   Expect ~$35–50/month for an always-warm instance.
2. **Build the image.** `clamav/clamav:stable` plus a `freshclam` sidecar or an
   entrypoint that refreshes signatures on boot and every 6 h. Push to Artifact
   Registry (a small additional storage charge).
3. **Deploy to Cloud Run** in the same region as the media bucket: 2 GB memory,
   1 vCPU, `--min-instances=1` (see the cold-start note above),
   `--no-allow-unauthenticated`.
4. **Grant a service account** `roles/run.invoker` on the service and
   `roles/storage.objectViewer` on the media bucket.
5. **Wire the async path, not the sync one.** An Eventarc `object.finalize`
   trigger on the media bucket, or a queue fed from the five ingresses. Do not
   put a network scan in the upload request path — the direct route already
   sits under Vercel's function timeout.
6. **Feed detections into quarantine, not a new table.** A detection writes the
   asset's `contentSha256` into the existing deny list
   (`MEDIA_QUARANTINES_COLLECTION`, index doc) with `reason: 'malware'`. That
   is already enforced at delivery, at re-upload, and surfaced to staff at
   `/admin/media-quarantine` and to owners on the asset card.
7. **Decide the pre-scan visibility rule.** Today an asset is servable the
   instant it finalizes. With an async scan there is a window; either accept it
   (and say so) or withhold `cdnPath` until the scan returns, which changes the
   upload UX and needs a product decision.
8. **Then, and only then, update the docs.** `apps/docs/api/resources/media.md`
   and `apps/docs/docs/content-and-data/media/overview.md` both state plainly
   that no malware scanning exists. Those sentences become false the day this
   ships and must be changed in the same PR — and must describe the async
   window from step 7, not imply the scan is synchronous.
