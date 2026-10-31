import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export function configureSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("SEO Spy API")
    .setDescription(
      'Local API. Website scopes: demo, homepage, lighthouse. Facebook routes provide local OAuth/report creation and saved analysis. WordPress local-operator endpoints support immutable evidence reports, reviewed content-update proposals, public image-alt verification and explicitly requested Rank Math audits. Muse interpretation is read-only, disabled by default and requires confirmed generation plus configured model/key/call limits. WordPress writes/audit triggers require their separate write gate and exact approval. Saved reads make no provider calls.',
    )
    .setVersion("0.2.0")
    .addBearerAuth({ type: "http", scheme: "bearer", description: "Private WORDPRESS_OPERATOR_KEY for local operator endpoints only; never send the WordPress application password here." })
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    () => SwaggerModule.createDocument(app, config),
    {
      jsonDocumentUrl: "api/docs-json",
      swaggerOptions: {
        persistAuthorization: false,
        defaultModelsExpandDepth: 1,
      },
      customSiteTitle: "SEO Spy API docs",
    },
  );
}
