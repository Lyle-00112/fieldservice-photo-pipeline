import sharp from "sharp";
import { infrai, putSignedObject } from "./infrai_storage.js";

export type DispatchStatus = "dispatched" | "on_site" | "completed";
export type PhotoStatus =
  | "dispatch_in_progress"
  | "photo_documented"
  | "awaiting_technician_follow_up";

export type WorkOrderPhotoInput = {
  workOrderId: string;
  photoId: string;
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  dispatchStatus: DispatchStatus;
  technicianFollowUp: {
    required: boolean;
    note?: string;
  };
};

export type PhotoPlan = {
  originalKey: string;
  thumbnailKey: string;
  status: PhotoStatus;
};

export function planPhoto(input: Pick<WorkOrderPhotoInput,
  "workOrderId" | "photoId" | "mediaType" | "dispatchStatus" | "technicianFollowUp"
>): PhotoPlan {
  const extension = input.mediaType.split("/")[1];
  const prefix = `work-orders/${input.workOrderId}/photos/${input.photoId}`;
  const status = input.technicianFollowUp.required
    ? "awaiting_technician_follow_up"
    : input.dispatchStatus === "completed"
      ? "photo_documented"
      : "dispatch_in_progress";

  return {
    originalKey: `${prefix}/original.${extension}`,
    thumbnailKey: `${prefix}/thumbnail.webp`,
    status,
  };
}

export async function storeWorkOrderPhoto(
  bucket: string,
  input: WorkOrderPhotoInput,
): Promise<PhotoPlan> {
  const plan = planPhoto(input);
  const original = Buffer.from(input.imageBase64, "base64");
  const thumbnail = await sharp(original)
    .rotate()
    .resize({ width: 640, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const [originalUpload, thumbnailUpload] = await Promise.all([
    infrai.storage.object.presign(
      bucket,
      plan.originalKey,
      input.mediaType,
      `${input.workOrderId}:${input.photoId}:original`,
    ),
    infrai.storage.object.presign(
      bucket,
      plan.thumbnailKey,
      "image/webp",
      `${input.workOrderId}:${input.photoId}:thumbnail`,
    ),
  ]);

  await Promise.all([
    putSignedObject(originalUpload.url, original, input.mediaType),
    putSignedObject(thumbnailUpload.url, thumbnail, "image/webp"),
  ]);
  return plan;
}
