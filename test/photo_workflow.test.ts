import assert from "node:assert/strict";
import test from "node:test";
import { planPhoto } from "../src/photo_workflow.js";

test("a requested technician follow-up takes priority after dispatch completion", () => {
  const plan = planPhoto({
    workOrderId: "WO-1042",
    photoId: "arrival-panel",
    mediaType: "image/jpeg",
    dispatchStatus: "completed",
    technicianFollowUp: { required: true, note: "Confirm the replacement label." },
  });

  assert.deepEqual(plan, {
    originalKey: "work-orders/WO-1042/photos/arrival-panel/original.jpeg",
    thumbnailKey: "work-orders/WO-1042/photos/arrival-panel/thumbnail.webp",
    status: "awaiting_technician_follow_up",
  });
});

test("a completed dispatch without follow-up records the photo as documented", () => {
  const plan = planPhoto({
    workOrderId: "WO-1042",
    photoId: "finished-panel",
    mediaType: "image/png",
    dispatchStatus: "completed",
    technicianFollowUp: { required: false },
  });

  assert.equal(plan.status, "photo_documented");
  assert.match(plan.originalKey, /original\.png$/);
});
