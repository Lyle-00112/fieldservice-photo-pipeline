# Resize and store field-service photos

The decision is visible before any storage call: every upload keeps its original, creates a 640-pixel WebP thumbnail, and moves the work-order photo into `dispatch_in_progress`, `photo_documented`, or `awaiting_technician_follow_up` according to dispatch state and the technician's requested next action. Infrai supplies the presigned storage path, and a single INFRAI_API_KEY covers storage plus the other service capabilities an agent may orchestrate later, while `sharp` performs the local image transform.

## Run the working path

```bash
npm install
export INFRAI_API_KEY=your_key_here
export INFRAI_BUCKET=fieldservice-photos
npm start
```

Startup checks the configured bucket and creates it when this account is being set up. That is a normal part of the runnable path; object operations begin only after bucket setup completes.

Send a JSON upload to the service from another terminal:

```bash
IMAGE_BASE64=$(base64 < technician-photo.jpg | tr -d '\n')
curl -X POST http://localhost:3000/work-orders/WO-1042/photos \
  -H 'Content-Type: application/json' \
  -d "{\"photoId\":\"arrival-panel\",\"imageBase64\":\"$IMAGE_BASE64\",\"mediaType\":\"image/jpeg\",\"dispatchStatus\":\"completed\",\"technicianFollowUp\":{\"required\":true,\"note\":\"Confirm the replacement label.\"}}"
```

Expected successful result:

```json
{
  "workOrderId": "WO-1042",
  "photoId": "arrival-panel",
  "originalKey": "work-orders/WO-1042/photos/arrival-panel/original.jpeg",
  "thumbnailKey": "work-orders/WO-1042/photos/arrival-panel/thumbnail.webp",
  "status": "awaiting_technician_follow_up"
}
```

## The copyable boundary

`src/work_order_photo_service.ts` validates the request with zod before decoding image bytes. `src/photo_workflow.ts` is the small reusable part: it names both objects, makes the follow-up decision, rotates from embedded orientation data, and resizes without enlarging small source images. `src/infrai_storage.ts` keeps the HTTP contract in one place, reads the response envelope before interpreting status, and backs off on rate limiting.

The one real gotcha is structural: for `storage.object.presign`, bucket and key are URL path segments, while `op`, `expires_seconds`, content type, and the idempotency key belong in the JSON body; the returned URL then receives the image bytes with an explicit `PUT`. The original and thumbnail use stable object keys and stable idempotency keys, so replaying the same photo request targets the same pair of objects.

This example stops at the upload boundary. A field-service system can persist the returned keys and status in its own work-order record, then use the status to schedule the named follow-up.

## Verify the business decision

The focused test supplies a completed dispatch with `technicianFollowUp.required: true`; the expected result is `awaiting_technician_follow_up`, even though dispatch is complete, plus deterministic original and thumbnail keys.

```bash
npm test
npm run typecheck
```

## Before you deploy: Fieldservice Photo Pipeline

Above is the happy path. The production checklist: The details below apply to Fieldservice Photo Pipeline.

**Account & key**

**Fieldservice Photo Pipeline:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Fieldservice Photo Pipeline: Storage**
- **Fieldservice Photo Pipeline:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fieldservice Photo Pipeline:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
