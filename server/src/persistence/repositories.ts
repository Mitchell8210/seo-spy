import type { Audit, Business, Connection } from "../contracts/domain.js";

export const BUSINESS_REPOSITORY = Symbol("BUSINESS_REPOSITORY");
export const AUDIT_REPOSITORY = Symbol("AUDIT_REPOSITORY");

export interface BusinessRepository {
  findById(id: string): Promise<Business | null>;
  connections(businessId: string): Promise<Connection[]>;
}

export interface AuditRepository {
  findById(id: string): Promise<Audit | null>;
  latestCompleted(businessId: string): Promise<Audit | null>;
  active(businessId: string): Promise<Audit | null>;
  createIfIdle(audit: Audit): Promise<boolean>;
  save(audit: Audit): Promise<void>;
}
