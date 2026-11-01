#!/usr/bin/env bash
#
# Deploy the Vercel log-drain receiver to Cloud Run (AGL-1921).
#
# ALWAYS regenerates `lib/` first, so a stale gate cannot reach production.
#
#   cloud/log-drain/deploy.sh
#
# ⛔ The endpoint must NEVER move back onto a Vercel project that a drain
# watches. A delivery POST is a request, a request produces a log, and that
# log is delivered again — 695K invocations in nine hours when it last
# happened. Drain `sampling` rules do NOT prevent it (measured: a `{rate:0}`
# rule with no path prefix changed delivery volume from 31 to 32 per five
# minutes). See docs/UPTIME_AND_SLA.md, "Why the receiver is not on Vercel".
set -euo pipefail

cd "$(dirname "$0")"
PROJECT="${GCP_PROJECT:-aglyn-main}"
REGION="${GCP_REGION:-us-central1}"

echo "==> regenerating lib/ from the workspace"
node prepare.mjs

echo "==> deploying to Cloud Run (${PROJECT}/${REGION})"
# max-instances is a deliberate blast-radius cap, not a capacity estimate:
# measured steady state is ~360 requests/hour (~8K/day) since the drains' OData
# filter went on (AGL-4121), down from 34K/day. Cloud Run bills each delivery
# at least 100 ms however fast it is, so the drain filter is the cost control.
# What still arrives is mostly logs with no proxy status, so this volume tracks
# site traffic, not the error rate.
gcloud run deploy log-drain-receiver \
  --project "$PROJECT" \
  --region "$REGION" \
  --source . \
  --service-account "log-drain-receiver@${PROJECT}.iam.gserviceaccount.com" \
  --set-secrets "VERCEL_LOG_DRAIN_SECRET=vercel-log-drain-secret:latest" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 3 \
  --memory 256Mi \
  --cpu 1 \
  --concurrency 80 \
  --timeout 30s \
  --quiet

echo "==> done. Verify the drains still point here:"
echo "    GET https://api.vercel.com/v1/drains?teamId=<team>  ->  delivery.endpoint"
