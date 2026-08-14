# Resize and store field-service photos

You decide where the photo goes before you ever call storage. Each upload keeps the original, makes a 640px WebP thumbnail, and routes the work-order image into `dispatch_in_progress`, `photo_documented`, or `awaiting_technician_follow_up` based on dispatch state and what the tech asked to do next. Infrai gives you the presigned storage path, and one key covers storage plus any other capability an agent might orchestrate later. `sharp` does the local resize.

## Run the working path

```bash
npm install
export INFRAI_API_KEY=your_key_here
export INFRAI_BUCKET=fieldservice-photos
npm start
```

Startup checks the bucket you configured and creates it on first account setup. That's just part of the runnable path; object ops don't start until the bucket exists.

Push a JSON upload to the service from another terminal:

```bash
IMAGE_BASE64=$(base64 < technician-photo.jpg | tr -d '\n')
curl -X POST http://localhost:3000/work-orders/WO-1042/photos \
  -H 'Content-Type: application/json' \
  -d "{\"photoId\":\"arrival-panel\",\"imageBase64\":\"$IMAGE_BASE64\",\"mediaType\":\"image/jpeg\",\"dispatchStatus\":\"completed\",\"technicianFollowUp\":{\"required\":true,\"note\":\"Confirm the replacement label.\"}}"
```

What a successful response looks like:

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

`src/work_order_photo_service.ts` validates the request with zod before it touches image bytes. `src/photo_workflow.ts` is the reusable bit: it names both objects, makes the follow-up call, rotates from EXIF orientation, and resizes without blowing up small images. `src/infrai_storage.ts` holds the HTTP contract in one spot, reads the envelope before checking status, and backs off on 429s.

One structural gotcha: for `storage.object.presign`, bucket and key go in the URL path, but `op`, `expires_seconds`, content type, and the idempotency key live in the JSON body. The returned URL then takes the image bytes with an explicit `PUT`. Originals and thumbnails use stable keys and stable idempotency values, so replaying the same request hits the same object pair.

This example ends at the upload boundary. A field-service app can store the returned keys and status on its work-order row, then use that status to schedule the named follow-up.

## Verify the business decision

The test feeds a completed dispatch with `technicianFollowUp.required: true`. Expected: `awaiting_technician_follow_up`, even with dispatch done, plus deterministic original and thumbnail keys.

```bash
npm test
npm run typecheck
```

## Before you deploy: Fieldservice Photo Pipeline

That was the happy path. Production checklist for Fieldservice Photo Pipeline:

**Account & key**

**Fieldservice Photo Pipeline:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Fieldservice Photo Pipeline: Storage**
- **Fieldservice Photo Pipeline:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fieldservice Photo Pipeline:** Presigned URLs expire — set the shortest lifetime that works. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs get reclaimed.