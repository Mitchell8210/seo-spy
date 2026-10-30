import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { configureApp } from "./configure-app.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  await app.listen(
    config.getOrThrow<number>("PORT"),
    config.getOrThrow<string>("HOST"),
  );
}

void bootstrap().catch(() => {
  process.exitCode = 1;
});
