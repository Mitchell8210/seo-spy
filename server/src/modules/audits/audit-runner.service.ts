import { Inject, Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as delay } from 'node:timers/promises';
import { WebsiteCollector, CollectionError } from '../../integrations/website/collector.js';
import { analyzeHomepage } from '../../integrations/website/analyze.js';
import type { AuditStage } from '../../contracts/domain.js';
import { createDemoResults } from '../../fixtures/demo.js';
import { AUDIT_REPOSITORY, BUSINESS_REPOSITORY, type BusinessRepository, type AuditRepository } from '../../persistence/repositories.js';

@Injectable()
export class AuditRunner implements OnModuleDestroy {
  private readonly logger = new Logger(AuditRunner.name);
  private readonly abort = new AbortController();
  private readonly jobs = new Set<Promise<void>>();
  private closing = false;

  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly audits: AuditRepository,
    private readonly config: ConfigService,
    private readonly collector: WebsiteCollector,
    @Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository,
  ) {}

  assertAcceptingWork() {
    if (this.closing) throw new ServiceUnavailableException({ code: 'SERVER_STOPPING', message: 'The server is stopping. Try again after it restarts.' });
  }

  enqueue(id: string) {
    this.assertAcceptingWork();
    const job = this.run(id).catch((error: unknown) => {
      this.logger.error(error instanceof Error ? error.stack : 'Audit runner failed');
    });
    this.jobs.add(job);
    void job.then(() => this.jobs.delete(job));
  }

  private async run(id: string) {
    try {
      const initial = await this.audits.findById(id);
      if (initial?.scope === 'homepage') {
        initial.startedAt = new Date().toISOString();
        initial.status = 'running'; initial.stage = 'collecting_evidence';
        await this.audits.save(initial);
        const business = await this.businesses.findById(initial.businessId);
        if (!business) throw new Error('Business not found');
        const page = await this.collector.collect(business.website, this.abort.signal);
        initial.stage = 'evaluating_checks'; await this.audits.save(initial);
        initial.results = analyzeHomepage(page, id);
        initial.stage = 'preparing_recommendations'; await this.audits.save(initial);
        this.abort.signal.throwIfAborted();
        initial.status = 'completed'; initial.stage = 'complete'; initial.completedAt = new Date().toISOString();
        await this.audits.save(initial);
        return;
      }
      const stages: AuditStage[] = ['collecting_evidence', 'evaluating_checks', 'preparing_recommendations', 'complete'];
      for (const stage of stages) {
        await delay(this.config.getOrThrow<number>('DEMO_STAGE_DELAY_MS'), undefined, { signal: this.abort.signal });
        const audit = await this.audits.findById(id);
        if (!audit) throw new Error('Queued audit was not found');
        audit.startedAt ??= new Date().toISOString();
        audit.stage = stage;
        audit.status = stage === 'complete' ? 'completed' : 'running';
        if (stage === 'complete') {
          audit.completedAt = new Date().toISOString();
          audit.results = createDemoResults(id, audit.completedAt);
        }
        await this.audits.save(audit);
      }
    } catch (error) {
      const audit = await this.audits.findById(id);
      if (audit) {
        audit.status = 'failed';
        audit.stage = 'failed';
        audit.completedAt = new Date().toISOString();
        audit.failure = this.abort.signal.aborted
          ? { code: 'SERVER_STOPPING', message: 'The audit was interrupted by server shutdown.' }
          : error instanceof CollectionError ? { code: error.code, message: error.message }
            : { code: 'AUDIT_FAILED', message: 'The audit could not be completed.' };
        await this.audits.save(audit);
      }
      if (!this.abort.signal.aborted) throw error;
    }
  }

  async onModuleDestroy() {
    this.closing = true;
    this.abort.abort();
    await Promise.allSettled(this.jobs);
  }
}
