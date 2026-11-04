import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../persistence/persistence.module.js";
import { GOOGLE_TOKEN_PROVIDER, ServiceAccountGoogleTokenProvider } from "../../integrations/google/google-auth.js";
import { GoogleTransport } from "../../integrations/google/google-transport.js";
import { GoogleReportingClient } from "../../integrations/google/google-reporting.js";
import { GoogleCacheStore } from "./google-cache.store.js";
import { GoogleReportingController } from "./google.controller.js";
import { GoogleOperatorGuard } from "./google.guard.js";
import { GoogleReportingService } from "./google.service.js";
import { GoogleFacebookVisitsService } from "./facebook-visits.service.js";
import { GoogleAnalysisService } from "./google-analysis.service.js";
import { GoogleAnalysisController, GoogleAnalysisReadGuard } from "./google-analysis.controller.js";

@Module({ imports: [PersistenceModule], controllers: [GoogleReportingController, GoogleAnalysisController], providers: [GoogleTransport, ServiceAccountGoogleTokenProvider, { provide: GOOGLE_TOKEN_PROVIDER, useExisting: ServiceAccountGoogleTokenProvider }, GoogleReportingClient, GoogleCacheStore, GoogleOperatorGuard, GoogleReportingService, GoogleFacebookVisitsService, GoogleAnalysisService, GoogleAnalysisReadGuard], exports: [GoogleReportingService, GoogleFacebookVisitsService] })
export class GoogleReportingModule {}
