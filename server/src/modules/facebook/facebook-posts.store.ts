import { ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";
import { AppDatabase } from "../../persistence/sqlite/app-database.js";
import { interpretationHash as hash } from "../../reporting/investigation-interpretation.js";

export const postSchema = z.object({
  id: z.string().uuid(), actor: z.string().regex(/^[a-f0-9]{64}$/), businessId: z.string(), reportId: z.string().uuid(),
  recommendationId: z.string().min(1).max(256), pageId: z.string().regex(/^\d{1,40}$/), pageName: z.string().min(1).max(1024),
  createdAt: z.string().datetime(), status: z.enum(["generating", "draft", "generation_failed", "publishing", "published", "outcome_unknown", "discarded"]),
  text: z.string().max(5000), attemptId: z.string().nullable(), model: z.string().nullable(),
  approvalHash: z.string().nullable(), expiresAt: z.string().datetime().nullable(), postId: z.string().nullable(),
  permalink: z.string().url().nullable(), verified: z.boolean(), error: z.string().nullable(),
  executedAt: z.string().datetime().nullable().optional(), completedAt: z.string().datetime().nullable().optional(),
  previousPostId: z.string().uuid().nullable().optional(),
  discardedAt: z.string().datetime().optional(),
}).strict();
export type FacebookPost = z.infer<typeof postSchema>;

/** A durable single-use write journal. Publishing reservations survive crashes and cannot be replayed. */
@Injectable()
export class FacebookPostsStore {
  constructor(private readonly database: AppDatabase) {}
  private decode(row: Record<string, unknown>): FacebookPost {
    if (typeof row.payload !== "string" || row.payload.length > 50000) throw new Error();
    const value = postSchema.parse(JSON.parse(row.payload));
    if (hash(value) !== row.checksum || value.id !== row.id) throw new Error();
    return value;
  }
  private fail(): never { throw new ServiceUnavailableException("Facebook post storage is unavailable. No automatic publishing retry was started."); }
  read(actor: string, businessId: string, id?: string, sourceKey?: string) {
    try {
      const db = this.database.connection();
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='facebook_posts'").get()) return null;
      const row = id ? db.prepare("SELECT * FROM facebook_posts WHERE id=?").get(id)
        : db.prepare("SELECT * FROM facebook_posts WHERE source_key=?").get(sourceKey ?? "");
      if (!row) return null;
      const value = this.decode(row);
      return value.actor === actor && value.businessId === businessId ? value : null;
    } catch { this.fail(); }
  }
  reserve(sourceKey: string, value: FacebookPost) {
    try {
      return this.database.withTransaction(db => {
        db.exec("CREATE TABLE IF NOT EXISTS facebook_posts(id TEXT PRIMARY KEY,source_key TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,checksum TEXT NOT NULL)");
        const old = db.prepare("SELECT * FROM facebook_posts WHERE source_key=?").get(sourceKey);
        if (old) return { fresh: false, value: this.decode(old) };
        const parsed = postSchema.parse(value);
        db.prepare("INSERT INTO facebook_posts VALUES(?,?,?,?)").run(parsed.id, sourceKey, JSON.stringify(parsed), hash(parsed));
        return { fresh: true, value: parsed };
      });
    } catch { this.fail(); }
  }
  history(actor: string, businessId: string) {
    try {
      const db = this.database.connection();
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='facebook_posts'").get()) return [];
      return db.prepare("SELECT * FROM facebook_posts").all().map(row => this.decode(row))
        .filter(value => value.actor === actor && value.businessId === businessId && ["published", "publishing", "outcome_unknown"].includes(value.status))
        .sort((a, b) => (b.completedAt ?? b.executedAt ?? "").localeCompare(a.completedAt ?? a.executedAt ?? ""))
        .slice(0, 100);
    } catch { this.fail(); }
  }
  pageActions(businessId: string, pageId: string, includeDiscarded = false) {
    try {
      const db = this.database.connection();
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='facebook_posts'").get()) return [];
      return db.prepare("SELECT * FROM facebook_posts").all().map(row => this.decode(row))
        .filter(value => value.businessId === businessId && value.pageId === pageId && (["published", "publishing", "outcome_unknown"].includes(value.status) || includeDiscarded && value.status === "discarded"));
    } catch { this.fail(); }
  }
  change(actor: string, businessId: string, id: string, update: (value: FacebookPost) => FacebookPost) {
    let domainConflict: ConflictException | undefined;
    try {
      return this.database.withTransaction(db => {
        const row = db.prepare("SELECT * FROM facebook_posts WHERE id=?").get(id);
        if (!row) throw new Error();
        const old = this.decode(row);
        if (old.actor !== actor || old.businessId !== businessId) throw new Error();
        let updated: FacebookPost;
        try { updated = update(structuredClone(old)); }
        catch (error) { if (error instanceof ConflictException) domainConflict = error; throw error; }
        const value = postSchema.parse(updated);
        if (value.id !== old.id || value.actor !== actor || value.businessId !== businessId) throw new Error();
        db.prepare("UPDATE facebook_posts SET payload=?,checksum=? WHERE id=?").run(JSON.stringify(value), hash(value), id);
        return value;
      });
    } catch {
      // Domain conflicts must not be misreported as storage failures.
      if (domainConflict) throw domainConflict;
      this.fail();
    }
  }
}
