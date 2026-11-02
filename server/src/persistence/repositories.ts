import type { Audit, Business, Connection } from "../contracts/domain.js";
export type { PlannerRepository } from "../modules/smart-planner/planner.types.js";

export const SMART_PLANNER_REPOSITORY = Symbol("SMART_PLANNER_REPOSITORY");

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
