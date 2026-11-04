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
import { WordPressFixController, WordPressFixOperatorController, WordPressLocalFixReadController } from "./wordpress-fix.controller.js";
import { WordPressFixSessions, WordPressFixSessionController, WordPressFixSessionGuard, WordPressLocalFixReadGuard } from "./wordpress-fix-session.js";
import { WordPressPageEvidenceService } from "./wordpress-page-evidence.service.js";
import { WordPressAltReceiptService } from "./wordpress-alt-receipt.service.js";
import { WordPressPurposeService } from "./wordpress-purpose.service.js";
import { WordPressImageContent } from "../../integrations/wordpress/image-content.js";
import { WordPressFixCandidatesService } from "./wordpress-fix-candidates.service.js";

@Module({ imports: [PersistenceModule, WebsiteCollectionModule, AiModule, ReportsModule], controllers: [WordPressLocalFixReadController, WordPressController, WordPressFixController, WordPressFixOperatorController, WordPressFixSessionController], providers: [WordPressFixCandidatesService, WordPressLocalFixReadGuard, WordPressTransport, WordPressClient, WordPressActionsStore, WordPressOperatorGuard, WordPressService, WordPressReportsStore, WordPressReportsService, WordPressMuseService, WordPressMuseStore, WordPressVerificationService, WordPressFixService, WordPressFixStore, WordPressFixSessions, WordPressFixSessionGuard, WordPressPageEvidenceService, WordPressAltReceiptService, WordPressPurposeService, WordPressImageContent], exports: [WordPressService, WordPressReportsService, WordPressMuseService, WordPressOperatorGuard, WordPressFixSessions] })
export class WordPressModule {}
