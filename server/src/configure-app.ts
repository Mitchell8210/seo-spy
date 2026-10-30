import { INestApplication, ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter.js";
import { configureSwagger } from "./swagger.js";

export function configureApp(app: INestApplication) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.id = randomUUID();
    res.setHeader("x-request-id", req.id);
    next();
  });
  app.setGlobalPrefix("api");
  // Local HTTP Swagger assets must not be upgraded to HTTPS by the CSP.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  configureSwagger(app);
  return app;
}
