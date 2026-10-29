import { WebsiteCollector, WebsiteDns, WebsiteTransport } from '../../integrations/website/collector.js';
import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import { AuditsController } from './audits.controller.js';
import { AuditsService } from './audits.service.js';
import { AuditRunner } from './audit-runner.service.js';
import { PageSpeedService, PageSpeedTransport } from '../../integrations/lighthouse/pagespeed.service.js';

@Module({ imports: [PersistenceModule], controllers: [AuditsController], providers: [AuditsService, AuditRunner, WebsiteCollector, WebsiteDns, WebsiteTransport, PageSpeedService, PageSpeedTransport] })
export class AuditsModule {}
