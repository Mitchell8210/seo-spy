import { Injectable } from '@nestjs/common';
import type { Audit } from '../../contracts/domain.js';
import { createDemoBusiness, createDemoConnections, createSeedAudit } from '../../fixtures/demo.js';
import type { AuditRepository, BusinessRepository } from '../repositories.js';

@Injectable()
export class MemoryBusinessRepository implements BusinessRepository {
  private readonly business = createDemoBusiness();

  async findById(id: string) {
    return id === this.business.id ? structuredClone(this.business) : null;
  }

  async connections(businessId: string) {
    return businessId === this.business.id ? createDemoConnections(this.business) : [];
  }
}

@Injectable()
export class MemoryAuditRepository implements AuditRepository {
  private readonly audits = new Map<string, Audit>();

  constructor() {
    const seed = createSeedAudit('demo-guzman');
    this.audits.set(seed.id, seed);
  }

  async findById(id: string) {
    const audit = this.audits.get(id);
    return audit ? structuredClone(audit) : null;
  }

  async latestCompleted(businessId: string) {
    const audits = [...this.audits.values()].filter((audit) => audit.businessId === businessId && (audit.status === 'completed' || audit.status === 'partial'));
    audits.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    return audits[0] ? structuredClone(audits[0]) : null;
  }

  async active(businessId: string) {
    const audit = [...this.audits.values()].find((item) => item.businessId === businessId && (item.status === 'queued' || item.status === 'running'));
    return audit ? structuredClone(audit) : null;
  }

  async createIfIdle(audit: Audit) {
    // No awaits between the check and insertion: atomic in this single process.
    const busy = [...this.audits.values()].some((item) => item.businessId === audit.businessId && (item.status === 'queued' || item.status === 'running'));
    if (busy) return false;
    this.audits.set(audit.id, structuredClone(audit));
    return true;
  }

  async save(audit: Audit) {
    this.audits.set(audit.id, structuredClone(audit));
  }
}
