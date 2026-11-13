# Deploying Shadowplay

**Live:** https://shadowplay-1031148889398.us-central1.run.app (deployed 11 Oct 2026)

| | |
| --- | --- |
| Project / region | `quick-catcher-470218-b0` / `us-central1` |
| Service | Cloud Run `shadowplay` (max 1 instance, scales to zero, 3600 s timeout, session affinity) |
| Service account | `shadowplay-run@quick-catcher-470218-b0.iam.gserviceaccount.com` (objectAdmin on the bucket only) |
| Stories | `gs://quick-catcher-470218-b0-shadowplay-stories` (private, deleted after 30 days) |
| Family viewer | `<url>/?viewer` |

To redeploy after changes, run the `gcloud run deploy` command below with
`--service-account shadowplay-run@...` added.

One container serves everything:

- the web app (`dist/`, built by Vite),
- the private story-sharing API (`/api/stories`, family codes, 30-day expiry),
- Live rooms (`/live`, WebSockets; the server only relays, it stores nothing).

## Server configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` (`8080` in the image) | HTTP port |
| `TRUSTED_PROXY_HOPS` | `0` | Proxy hops to trust in X-Forwarded-For (`1` on Cloud Run) |
| `DIAG_DIR` | `./.data/diag` | Local folder for `?diag` diagnostics (production: `diag/` in the bucket) |
| `STATIC_DIR` | `./dist` | built app |
| `STORY_BUCKET` | unset | Cloud Storage bucket for shared stories; unset = local disk |
| `DATA_DIR` | `./.data/stories` | local story folder when no bucket is set |
| `STORY_TTL_DAYS` | `30` | how long a shared story lives |
| `MAX_STORY_BYTES` | 30 MB | largest upload (a 15-minute story with voice) |
| `ANTHROPIC_API_KEY` | unset | Mo's tips worded by Claude (`/api/coach`); unset = the app's own words. Set it from Secret Manager, never in the command line |
| `COACH_MODEL` | `claude-haiku-4-5-20251001` | the model for Mo's tips (short, fast) |
| `VOICE_STT` | unset | `google`: voice commands through Cloud Speech-to-Text when the headset browser has no speech recognition of its own (`/api/voice`); unset = unavailable |

With `STORY_BUCKET` set, the server uses the Cloud Run service account through
the metadata server (no keys in the image).

**Mo's tips (`ANTHROPIC_API_KEY`)**: keep the key in Secret Manager and give
the service account access to it, then deploy with
`--set-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest`:

```sh
printf '%s' "$KEY" | gcloud secrets create anthropic-api-key --project $PROJECT --data-file=-
gcloud secrets add-iam-policy-binding anthropic-api-key --project $PROJECT \
  --member serviceAccount:$SA --role roles/secretmanager.secretAccessor
```

A tip is one short request (about 150 tokens in, 30 out) and repeats are
cached, so a whole evening of stories costs well under a cent.

**Voice commands (`VOICE_STT=google`)** need the Speech-to-Text API enabled in
the project (`gcloud services enable speech.googleapis.com --project $PROJECT`)
and are billed per request (about $0.016 per minute of audio; a command clip is
1-3 seconds). The service account needs no extra role for `speech:recognize`.
Clips are forwarded and forgotten: nothing is stored or logged.

## Cloud Run (once approved)

Live rooms are kept in memory, so the service must run as **one instance**
with long-lived connections allowed.

```sh
PROJECT=<project-id>
REGION=<region>
BUCKET=$PROJECT-shadowplay-stories

gcloud storage buckets create gs://$BUCKET --project $PROJECT --location $REGION \
  --uniform-bucket-level-access --public-access-prevention
# Shared stories expire after 30 days.
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > /tmp/lifecycle.json
gcloud storage buckets update gs://$BUCKET --lifecycle-file=/tmp/lifecycle.json

gcloud run deploy shadowplay --project $PROJECT --region $REGION --source . \
  --allow-unauthenticated \
  --set-env-vars STORY_BUCKET=$BUCKET,TRUSTED_PROXY_HOPS=1 \
  --min-instances 0 --max-instances 1 --timeout 3600 --session-affinity \
  --memory 512Mi --cpu 1

# Let the service account read and write only that bucket.
SA=$(gcloud run services describe shadowplay --project $PROJECT --region $REGION \
  --format 'value(spec.template.spec.serviceAccountName)')
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member serviceAccount:$SA --role roles/storage.objectAdmin
```

WebXR needs HTTPS, which Cloud Run provides. Family viewer links use the page's
own address, so they work on the deployed URL without configuration.

## Device-test deploys (before the freeze)

A test build for headset sessions, beside the public one: a new revision with
**no traffic** and its own tagged URL, so the public URL never changes.

```sh
PROJECT=quick-catcher-470218-b0
REGION=us-central1
SA=shadowplay-run@$PROJECT.iam.gserviceaccount.com
BUCKET=$PROJECT-shadowplay-stories
N=1   # next devtest number: gcloud run revisions list --service shadowplay --project $PROJECT --region $REGION

git checkout main && git pull --ff-only
gcloud run deploy shadowplay --project $PROJECT --region $REGION --source . \
  --service-account $SA --allow-unauthenticated \
  --set-env-vars STORY_BUCKET=$BUCKET,TRUSTED_PROXY_HOPS=1 \
  --min-instances 0 --max-instances 1 --timeout 3600 --session-affinity \
  --memory 512Mi --cpu 1 \
  --revision-suffix devtest-$N --tag devtest --no-traffic

# Check it (diagnostics beacon must land in the bucket):
node scripts/sim/smoke.mjs https://devtest---shadowplay-1031148889398.us-central1.run.app \
  --diag-bucket gs://$BUCKET
```

- **Headset URL:** `https://devtest---shadowplay-1031148889398.us-central1.run.app/?diag`
  (phone: the same address with `?viewer`; a Live session must use the devtest
  URL on both devices, since rooms live in that revision's memory).
- Same service account, bucket and settings as production, with
  `--min-instances 0` (a cold start of a few seconds on the first request).
- `--no-traffic` pins the public traffic to the revision that was serving, so
  from then on a plain `gcloud run deploy` no longer goes live by itself. To put
  a build live, use the freeze procedure below, or
  `gcloud run services update-traffic shadowplay --project $PROJECT --region $REGION --to-latest`.
- After a session: `scripts/diag/pull.sh` (today and yesterday, UTC) or
  `scripts/diag/pull.sh <UTC date> <session id>`.

Delete old devtest revisions (a tagged revision can't be deleted; the newest
devtest deploy carries the tag, so the older ones are free):

```sh
gcloud run revisions list --service shadowplay --project $PROJECT --region $REGION \
  --filter='metadata.name~devtest' --format='value(metadata.name)'
gcloud run revisions delete shadowplay-devtest-1 --project $PROJECT --region $REGION --quiet
# All devtest builds at once, the tag first:
gcloud run services update-traffic shadowplay --project $PROJECT --region $REGION --remove-tags devtest
for r in $(gcloud run revisions list --service shadowplay --project $PROJECT --region $REGION \
    --filter='metadata.name~devtest' --format='value(metadata.name)'); do
  gcloud run revisions delete "$r" --project $PROJECT --region $REGION --quiet
done
```

## Judging configuration (freeze, then leave running)

Run these yourself on freeze day: **17 Nov, by 6:00 PM CT**. Judging uses the
build as it stands at 18 Nov 12:00 PT and runs until about 11 Dec, so after this
**do not deploy**.

### 0. Before the freeze (on `main`, everything merged)

```sh
gcloud auth login            # if the deploy asks for it
git checkout main && git pull --ff-only
npm ci && npm test && npm run build
# The simulations need the dev server (npm run dev) on https://localhost:8082 and port
# 8787 free (live-family runs its own API server there).
node scripts/sim/playtest.mjs --gpu                      # six bot children, budget check
node scripts/sim/live-family.mjs --seconds-per-phase 45  # parent and child, Live
node scripts/sim/rooms.mjs --gpu                         # 17 room cases
node scripts/sim/session-life.mjs --gpu                  # pause/resume, first screen, welcome back
node scripts/sim/hands-only.mjs --gpu                    # every interaction by hand
node scripts/sim/narration-stall.mjs --gpu               # a stalled clip never stalls the story
```

All must pass. The local submission pack (`submission/`), raw footage and the
video are never uploaded (`.gcloudignore`).

### 1-4. Freeze, deploy, pin, watch

```sh
PROJECT=quick-catcher-470218-b0
REGION=us-central1
SA=shadowplay-run@$PROJECT.iam.gserviceaccount.com
BUCKET=$PROJECT-shadowplay-stories

# 1. Freeze the code and deploy it as a tagged revision called "competition".
git checkout main && git pull --ff-only
git tag v1.0-competition && git push origin v1.0-competition
gcloud run deploy shadowplay --project $PROJECT --region $REGION --source . \
  --service-account $SA --allow-unauthenticated \
  --set-env-vars STORY_BUCKET=$BUCKET,TRUSTED_PROXY_HOPS=1 \
  --min-instances 1 --max-instances 1 \
  --no-cpu-throttling --cpu 1 --memory 1Gi \
  --timeout 3600 --session-affinity \
  --revision-suffix competition --tag competition --no-traffic

# 2. Pin 100% of traffic to that revision (later deploys would then not go live by accident).
gcloud run services update-traffic shadowplay --project $PROJECT --region $REGION \
  --to-revisions shadowplay-competition=100

# 3. Uptime check on /api/health every 5 minutes, emailing you when it fails.
#    (Not /healthz: Cloud Run reserves URL paths ending in 'z', so that one only works locally.)
gcloud beta monitoring channels create --project $PROJECT \
  --display-name="Shadowplay alerts" --type=email --channel-labels=email_address=YOU@example.com
CHANNEL=$(gcloud beta monitoring channels list --project $PROJECT \
  --filter='displayName="Shadowplay alerts"' --format='value(name)')
gcloud monitoring uptime create shadowplay-health --project $PROJECT \
  --resource-type=uptime-url \
  --resource-labels=host=shadowplay-1031148889398.us-central1.run.app,project_id=$PROJECT \
  --path=/api/health --protocol=https --period=5 --timeout=10
CHECK=$(gcloud monitoring uptime list-configs --project $PROJECT \
  --filter='displayName="shadowplay-health"' --format='value(name.basename())')
cat > /tmp/shadowplay-uptime-policy.json <<JSON
{
  "displayName": "Shadowplay is down",
  "combiner": "OR",
  "conditions": [{
    "displayName": "health check failing",
    "conditionThreshold": {
      "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"$CHECK\"",
      "aggregations": [{ "alignmentPeriod": "600s", "perSeriesAligner": "ALIGN_FRACTION_TRUE" }],
      "comparison": "COMPARISON_LT", "thresholdValue": 0.5, "duration": "600s"
    }
  }],
  "notificationChannels": ["$CHANNEL"]
}
JSON
gcloud monitoring policies create --project $PROJECT --policy-from-file=/tmp/shadowplay-uptime-policy.json

# 4. Check it: the smoke test, the health endpoint, the judged revision serving.
node scripts/sim/smoke.mjs https://shadowplay-1031148889398.us-central1.run.app
curl -s https://shadowplay-1031148889398.us-central1.run.app/api/health
gcloud run services describe shadowplay --project $PROJECT --region $REGION \
  --format='value(status.traffic)'   # expect shadowplay-competition at 100
```

`--revision-suffix competition` names the revision `shadowplay-competition`; a
name can be used once. If a fix has to go in before the deadline, deploy it with
`--revision-suffix competition-2` (and pin traffic to `shadowplay-competition-2`),
then move the tag: `git tag -f v1.0-competition && git push -f origin v1.0-competition`.

### Rollback

Traffic can go back to any earlier revision in seconds (nothing is rebuilt):

```sh
gcloud run revisions list --service shadowplay --project $PROJECT --region $REGION
gcloud run services update-traffic shadowplay --project $PROJECT --region $REGION \
  --to-revisions REVISION_NAME=100
```

### After the deadline (18 Nov 12:00 PT to about 11 Dec)

- Do not deploy, and do not change traffic, except to restore the judged
  revision if something external breaks it.
- Keep the project and its billing active until the winners are announced.
- Watching: the uptime alert emails you; logs with
  `gcloud run services logs read shadowplay --project $PROJECT --region $REGION --limit 100`.

Why these settings:

| Setting | Reason |
| --- | --- |
| `--min-instances 1 --max-instances 1` | No cold start for a judge; Live rooms live in memory, so exactly one instance |
| `--no-cpu-throttling` | CPU stays allocated between requests (WebSocket rooms, diagnostics flushes) |
| `--memory 1Gi` | Headroom for compressed assets in memory and Live rooms |
| `--tag competition` + traffic pinned | The judged build cannot change by accident |

Cost: one always-on instance (1 vCPU, 1 GiB) for about four weeks, roughly
US$50-70 at list price; check the pricing calculator for your account.

## Verified locally

- `npm run build` succeeds.
- `node server/main.ts` with `STATIC_DIR=dist` serves the app, story files,
  MediaPipe wasm (`application/wasm`), uploads and lookups, and Live rooms.
- The Cloud Storage store was exercised against a local fake of the Storage
  JSON API (`STORAGE_API` / `STORAGE_TOKEN_URL` override the endpoints).
- The image builds in Cloud Build from the Dockerfile.
- Deployed smoke test: health, app, bundle, story files, hand model, wasm,
  upload, fetch, replies, wrong-code 404, live room, guest join and relay over
  `wss://` all pass; stories land in the bucket. A headless browser loads the
  desk and phone pages with no console errors.

## Before a public launch

- Scale-out for Live rooms (more than one instance) needs a shared room
  registry or a dedicated relay; one instance is plenty for the competition.
- Rate limits are per instance and in memory.
- Consider abuse reporting for shared codes and a takedown path.
