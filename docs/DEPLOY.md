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
| `STATIC_DIR` | `./dist` | built app |
| `STORY_BUCKET` | unset | Cloud Storage bucket for shared stories; unset = local disk |
| `DATA_DIR` | `./.data/stories` | local story folder when no bucket is set |
| `STORY_TTL_DAYS` | `30` | how long a shared story lives |
| `MAX_STORY_BYTES` | 30 MB | largest upload (a 15-minute story with voice) |

With `STORY_BUCKET` set, the server uses the Cloud Run service account through
the metadata server (no keys in the image).

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
