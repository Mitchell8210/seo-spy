import { z } from "zod";

export type FacebookAvailability = "available" | "missing" | "unavailable";
export interface FacebookField {
  status: FacebookAvailability;
  value:
    | string
    | number
    | boolean
    | Record<string, string | number>
    | string[]
    | null;
  collectedAt: string;
  failureCode?: string;
}
export interface FacebookMetric {
  name: string;
  status: FacebookAvailability;
  period: "day";
  points: { endTime: string; value: number }[];
  aggregation: "sum" | "snapshot";
  total: number | null;
  collectedAt: string;
  failureCode?: string;
}
export interface FacebookReport {
  provider: "facebook-graph";
  version: "facebook-v1";
  analysisVersion?: "facebook-analysis-v1";
  graphVersion: string;
  pageId: string;
  pageName: string;
  collectedAt: string;
  window: { since: string; until: string; requestedDays: number };
  profile: Record<string, FacebookField>;
  posts: {
    status: FacebookAvailability;
    items: {
      id: string;
      message: string | null;
      createdTime: string | null;
      url: string;
    }[];
    truncated: boolean;
    collectedAt: string;
    failureCode?: string;
  };
  metrics: FacebookMetric[];
  summary: {
    followersStart: number | null;
    followersEnd: number | null;
    followersChange: number | null;
    latestPostAt: string | null;
    postsInWindow: number | null;
    postsInWindowComplete: boolean;
  };
  coverage: {
    profileFieldsAvailable: number;
    profileFieldsMissing: number;
    profileFieldsUnavailable: number;
    metricsAvailable: number;
    metricsRequested: number;
    postsLimit: number;
  };
  limitations: string[];
}

export class FacebookCollectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const timestamp = z
  .string()
  .max(64)
  .refine((value) => Number.isFinite(Date.parse(value)));
const availability = z.enum(["available", "missing", "unavailable"]);
const field = (value: z.ZodType) =>
  z
    .object({
      status: availability,
      value: value.nullable(),
      collectedAt: timestamp,
      failureCode: z.string().max(128).optional(),
    })
    .optional();
const text = z.string().max(30000);
const number = z.number().finite().nonnegative();
const location = z.object({
  street: text.optional(),
  city: text.optional(),
  state: text.optional(),
  country: text.optional(),
  zip: text.optional(),
  latitude: z.number().finite().optional(),
  longitude: z.number().finite().optional(),
});
const hoursKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].flatMap(
  (day) =>
    [1, 2].flatMap((index) => [
      `${day}_${index}_open`,
      `${day}_${index}_close`,
    ]),
);
const hours = z.object(
  Object.fromEntries(
    hoursKeys.map((key) => [key, z.string().max(128).optional()]),
  ),
);
export const facebookReportSchema = z
  .object({
    analysisVersion: z.literal("facebook-analysis-v1").optional(),
    provider: z.literal("facebook-graph"),
    version: z.literal("facebook-v1"),
    graphVersion: z.string().regex(/^v\d+\.0$/),
    pageId: z.string().regex(/^\d+$/),
    pageName: z.string().max(1024),
    collectedAt: timestamp,
    window: z.object({
      since: timestamp,
      until: timestamp,
      requestedDays: z.number().int().positive().max(90),
    }),
    profile: z.object({
      name: field(text),
      about: field(text),
      description: field(text),
      website: field(text),
      phone: field(text),
      emails: field(z.array(z.string().max(512)).max(50)),
      hours: field(hours),
      location: field(location),
      category: field(text),
      username: field(text),
      followers_count: field(number),
      fan_count: field(number),
      is_published: field(z.boolean()),
      is_verified: field(z.boolean()),
      overall_star_rating: field(number),
      rating_count: field(number),
    }),
    posts: z.object({
      status: availability,
      items: z
        .array(
          z.object({
            id: z.string().regex(/^\d+_\d+$/),
            message: z.string().max(100000).nullable(),
            createdTime: timestamp.nullable(),
            url: z
              .string()
              .regex(
                /^https:\/\/www\.facebook\.com\/\d+(?:_\d+|\/posts\/\d+)?$/,
              ),
          }),
        )
        .max(50),
      truncated: z.boolean(),
      collectedAt: timestamp,
      failureCode: z.string().max(128).optional(),
    }),
    metrics: z
      .array(
        z.object({
          name: z.enum([
            "page_follows",
            "page_daily_follows_unique",
            "page_daily_unfollows_unique",
            "page_media_view",
            "page_views_total",
            "page_post_engagements",
            "page_video_views",
          ]),
          status: availability,
          period: z.literal("day"),
          points: z
            .array(z.object({ endTime: timestamp, value: number }))
            .max(100),
          aggregation: z.enum(["sum", "snapshot"]),
          total: number.nullable(),
          collectedAt: timestamp,
          failureCode: z.string().max(128).optional(),
        }),
      )
      .max(7),
    summary: z.object({
      followersStart: number.nullable(),
      followersEnd: number.nullable(),
      followersChange: z.number().finite().nullable(),
      latestPostAt: timestamp.nullable(),
      postsInWindow: z.number().int().nonnegative().nullable(),
      postsInWindowComplete: z.boolean(),
    }),
    coverage: z.object({
      profileFieldsAvailable: number,
      profileFieldsMissing: number,
      profileFieldsUnavailable: number,
      metricsAvailable: number,
      metricsRequested: number,
      postsLimit: number,
    }),
    limitations: z.array(z.string().max(5000)).max(100),
  })
  .transform((value) => value as FacebookReport);
