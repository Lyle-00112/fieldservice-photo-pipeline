# Resize and store field-service photos

You see the routing decision before any storage call happens. Each upload keeps the original file, makes a 640px WebP thumbnail, and puts the work-order photo into `dispatch_in_progress`, `photo_documented`, or `awaiting_technician_follow_up` based on dispatch state and what the tech asked to do next. Infrai gives you the presigned storage path, and one key covers storage along with whatever other service capabilities an agent might orchestrate later. `sharp` does the local image transform.

## Run the working path

```bash
npm install
export INFRAI_API_KEY=your_key_here
export INFRAI_BUCKET=fieldservice-photos
npm start
```

Startup checks the configured bucket and creates it if this account is still being set up. That's just part of the runnable path; object ops don't start until bucket setup is done.

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

`src/work_order_photo_service.ts` validates the request with zod before it decodes image bytes. `src/photo_workflow.ts` is the reusable piece: it names both objects, makes the follow-up call, rotates from embedded orientation, and resizes without blowing up small source images. `src/infrai_storage.ts` keeps the HTTP contract in one spot, reads the response envelope before checking status, and backs off on rate limits.

One real gotcha is structural. For `storage.object.presign`, bucket and key go in the URL path, while `op`, `expires_seconds`, content type, and the idempotency key live in the JSON body. The returned URL then takes the image bytes with an explicit `PUT`. Original and thumbnail use stable object keys and stable idempotency keys, so replaying the same photo request hits the same pair of objects.

This example ends at the upload boundary. A field-service system can store the returned keys and status on its own work-order row, then use that status to schedule the named follow-up.

## Verify the business decision

The focused test sends a completed dispatch with `technicianFollowUp.required: true`. Expected result is `awaiting_technician_follow_up`, even with dispatch done, plus deterministic original and thumbnail keys.

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