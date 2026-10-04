import { z } from "zod";
import type { ClientMessage } from "@snapland/shared";

// Saving appends the closing coordinate; REST permits 500 ring points total.
export const MAX_DRAW_POINTS = 499;
export const MAX_WS_PAYLOAD_BYTES = 64 * 1024;

const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);
const point = z.tuple([longitude, latitude]);

export const clientMessageSchema: z.ZodType<ClientMessage> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("draw:progress"),
    payload: z.object({ points: z.array(point).max(MAX_DRAW_POINTS) }).strict(),
  }).strict(),
  z.object({
    type: z.literal("draw:cancel"),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    type: z.literal("viewport:update"),
    payload: z.object({
      bbox: z.tuple([longitude, latitude, longitude, latitude])
        .refine(([west, south, east, north]) => west <= east && south <= north, {
          message: "Bounds must be ordered west, south, east, north",
        }),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("area:editing:start"),
    payload: z.object({ areaId: z.string().min(1).max(100) }).strict(),
  }).strict(),
  z.object({
    type: z.literal("area:editing:stop"),
    payload: z.object({ areaId: z.string().min(1).max(100) }).strict(),
  }).strict(),
]);
