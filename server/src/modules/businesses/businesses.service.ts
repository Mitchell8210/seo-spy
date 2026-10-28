import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { HOMEPAGE_NOTICE } from '../../integrations/website/analyze.js';
import { DEMO_NOTICE } from '../../fixtures/demo.js';
import { AUDIT_REPOSITORY, BUSINESS_REPOSITORY, type AuditRepository, type BusinessRepository } from '../../persistence/repositories.js';
import { auditSummary } from '../audits/audits.service.js';

@Injectable()
export class BusinessesService {
  constructor(
    @Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audits: AuditRepository,
  ) {}

  async dashboard(id: string) {
    const business = await this.businesses.findById(id);
    if (!business) throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found.' });
    const [connections, completed, active] = await Promise.all([
      this.businesses.connections(id), this.audits.latestCompleted(id), this.audits.active(id),
    ]);
    return {
      mode: completed?.mode ?? 'demo', notice: completed?.mode === 'live' ? HOMEPAGE_NOTICE : DEMO_NOTICE, business, connections: completed?.mode === 'live' ? connections.map((connection) => ({
        ...connection, mode: 'live' as const,
        status: connection.platform === 'website' ? 'connected' as const : 'authorization_required' as const,
        identity: connection.platform === 'website' ? completed.results?.evidence.find((e) => e.checkId === 'collection')?.sourceUrl ?? business.website : connection.identity,
      })) : connections,
      latestAudit: completed ? auditSummary(completed) : null,
      activeAudit: active ? auditSummary(active) : null,
      scores: completed?.results?.scores ?? [],
      findings: completed?.results?.findings ?? [],
      recommendations: completed?.results?.recommendations ?? [],
      priorityOpportunities: completed?.results?.recommendations.length ?? 0,
    };
  }
}
