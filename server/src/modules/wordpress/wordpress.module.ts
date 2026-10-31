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

@Module({ imports: [PersistenceModule, WebsiteCollectionModule, AiModule], controllers: [WordPressController], providers: [WordPressTransport, WordPressClient, WordPressActionsStore, WordPressOperatorGuard, WordPressService, WordPressReportsStore, WordPressReportsService, WordPressMuseService, WordPressMuseStore, WordPressVerificationService], exports: [WordPressService, WordPressReportsService] })
export class WordPressModule {}
