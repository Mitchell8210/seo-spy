import { Module } from '@nestjs/common';
import { AUDIT_REPOSITORY, BUSINESS_REPOSITORY } from './repositories.js';
import { MemoryAuditRepository, MemoryBusinessRepository } from './memory/memory.repositories.js';

@Module({
  providers: [
    { provide: BUSINESS_REPOSITORY, useClass: MemoryBusinessRepository },
    { provide: AUDIT_REPOSITORY, useClass: MemoryAuditRepository },
  ],
  exports: [BUSINESS_REPOSITORY, AUDIT_REPOSITORY],
})
export class PersistenceModule {}
