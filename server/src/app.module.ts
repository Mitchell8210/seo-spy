import { Controller, Get, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { validateEnvironment } from "./config/environment.js";
import { AuditsModule } from "./modules/audits/audits.module.js";
import { BusinessesModule } from "./modules/businesses/businesses.module.js";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HealthDto } from "./contracts/responses.dto.js";
import { FacebookModule } from "./modules/facebook/facebook.module.js";

@Controller("health")
@ApiTags("Health")
class HealthController {
  @Get()
  @ApiOperation({ summary: "Check server health" })
  @ApiOkResponse({ type: HealthDto })
  get(): HealthDto {
    return { status: "ok", service: "seo-spy-server", mode: "demo" };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
      ignoreEnvFile: process.env.NODE_ENV === "test",
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.getOrThrow<string>("LOG_LEVEL"),
          genReqId: (req) => req.id,
          // Log only minimal request metadata; bodies, headers and query strings may contain secrets.
          serializers: {
            req: (req: { id: string; method: string }) => ({
              id: req.id,
              method: req.method,
            }),
          },
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            'res.headers["set-cookie"]',
          ],
        },
      }),
    }),
    BusinessesModule,
    AuditsModule,
    FacebookModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
