import { Module } from "@nestjs/common";
import { AiUsageStore } from "../../integrations/ai/ai-usage.store.js";
import { MetaMuseProvider, MetaMuseTransport } from "../../integrations/ai/meta-muse.provider.js";
import { AiAdminController } from "./ai-admin.controller.js";
import { AiAdminGuard } from "./ai-admin.guard.js";

// Every feature shares this one provider and durable spending ledger.
@Module({ controllers: [AiAdminController], providers: [AiUsageStore, MetaMuseProvider, MetaMuseTransport, AiAdminGuard], exports: [AiUsageStore, MetaMuseProvider] })
export class AiModule {}
