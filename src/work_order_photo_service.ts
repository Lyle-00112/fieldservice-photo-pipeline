import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { ensurePhotoBucket, InfraiError } from "./infrai_storage.js";
import { storeWorkOrderPhoto } from "./photo_workflow.js";

const bucket = process.env.INFRAI_BUCKET ?? "fieldservice-photos";
const port = Number(process.env.PORT ?? 3000);

const uploadBody = z.object({
  photoId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  imageBase64: z.string().min(1).max(20_000_000),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  dispatchStatus: z.enum(["dispatched", "on_site", "completed"]),
  technicianFollowUp: z.object({
    required: z.boolean(),
    note: z.string().trim().min(1).max(500).optional(),
  }),
}).superRefine((value, context) => {
  if (value.technicianFollowUp.required && !value.technicianFollowUp.note) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["technicianFollowUp", "note"],
      message: "A note is required when technician follow-up is requested.",
    });
  }
});

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request: AsyncIterable<Buffer | string>): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 21_000_000) throw new Error("Request body is too large.");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

await ensurePhotoBucket(bucket);

createServer(async (request, response) => {
  const match = request.url?.match(/^\/work-orders\/([a-zA-Z0-9_-]+)\/photos$/);
  if (request.method !== "POST" || !match) {
    json(response, 404, { error: "Route not found." });
    return;
  }

  try {
    const input = uploadBody.parse(await readJson(request));
    const result = await storeWorkOrderPhoto(bucket, {
      workOrderId: match[1],
      photoId: input.photoId!,
      imageBase64: input.imageBase64!,
      mediaType: input.mediaType!,
      dispatchStatus: input.dispatchStatus!,
      technicianFollowUp: {
        required: input.technicianFollowUp!.required!,
        note: input.technicianFollowUp!.note,
      },
    });
    json(response, 201, { workOrderId: match[1], photoId: input.photoId, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      json(response, 400, { error: "Invalid request body.", issues: error.issues });
      return;
    }
    if (error instanceof SyntaxError) {
      json(response, 400, { error: "Request body must be valid JSON." });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      json(response, status, { error: error.message, code: error.code });
      return;
    }
    const message = error instanceof Error ? error.message : "Unexpected request error.";
    json(response, 400, { error: message });
  }
}).listen(port, () => {
  console.log(`Work-order photo service listening on http://localhost:${port}`);
});
