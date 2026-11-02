import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../persistence/persistence.module.js";
import { WebsiteCollectionModule } from "../../integrations/website/website-collection.module.js";
import { WordPressClient, WordPressTransport } from "../../integrations/wordpress/wordpress.client.js";
import { WordPressActionsStore } from "./wordpress-actions.store.js";
import { WordPressController } from "./wordpress.controller.js";
import { WordPressOperatorGuard } from "./wordpress.guard.js";
import { WordPressService } from "./wordpress.service.js";
import { WordPressReportsStore } from "./wordpress-reports.store.js";
import { WordPressReportsService } from "./wordpress-reports.service.js";
import { AiModule } from "../ai/ai.module.js";
import { WordPressMuseService } from "./wordpress-muse.service.js";
import { WordPressMuseStore } from "./wordpress-muse.store.js";
import { WordPressVerificationService } from "./wordpress-verification.service.js";
import { ReportsModule } from "../../reports/reports.module.js";
import { WordPressFixService } from "./wordpress-fix.service.js";
import { WordPressFixStore } from "./wordpress-fix.store.js";
import { WordPressFixController, WordPressFixOperatorController } from "./wordpress-fix.controller.js";
import { WordPressFixSessions, WordPressFixSessionController, WordPressFixSessionGuard } from "./wordpress-fix-session.js";

@Module({ imports: [PersistenceModule, WebsiteCollectionModule, AiModule, ReportsModule], controllers: [WordPressController, WordPressFixController, WordPressFixOperatorController, WordPressFixSessionController], providers: [WordPressTransport, WordPressClient, WordPressActionsStore, WordPressOperatorGuard, WordPressService, WordPressReportsStore, WordPressReportsService, WordPressMuseService, WordPressMuseStore, WordPressVerificationService, WordPressFixService, WordPressFixStore, WordPressFixSessions, WordPressFixSessionGuard], exports: [WordPressService, WordPressReportsService, WordPressMuseService, WordPressOperatorGuard] })
export class WordPressModule {}
