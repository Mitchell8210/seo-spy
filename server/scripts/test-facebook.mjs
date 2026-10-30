// Explicit, read-only live developer test. Never prints tokens or provider bodies.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { ConfigService } from "@nestjs/config";
import {
  FacebookGraph,
  FacebookService,
} from "../dist/modules/facebook/facebook.service.js";
import { validateEnvironment } from "../dist/config/environment.js";
process.loadEnvFile(new URL("../.env", import.meta.url));
const config = new ConfigService(validateEnvironment(process.env));
const graph = new FacebookGraph(config);
const service = new FacebookService(config, graph);
try {
  if (process.argv.includes("--all-permissions")) {
    const { testAllPermissions } =
      await import("./test-facebook-permissions.mjs");
    await testAllPermissions(graph, config);
  } else {
    const result = await service.diagnose(service.useConfiguredToken());
    console.log(
      JSON.stringify(
        {
          ...result,
          pages: result.pages.map((page) => ({
            id: page.id,
            name: page.name,
            tasks: page.tasks,
            metadata: page.metadata,
            posts: {
              ...page.posts,
              data: undefined,
              count: page.posts.data?.length,
            },
            insights: page.insights,
          })),
        },
        null,
        2,
      ),
    );
    if (
      !result.requiredPermissionsGranted ||
      result.pageListFailure ||
      !result.pages.length
    )
      process.exitCode = 1;
  }
} catch (error) {
  const detail = error?.getResponse?.();
  console.error(
    JSON.stringify({
      status: "failed",
      code: detail?.code ?? "FACEBOOK_TEST_FAILED",
      providerCode: detail?.providerCode,
      providerSubcode: detail?.providerSubcode,
      message:
        "Facebook test failed. Verify token validity, app association and required permissions. No credentials were printed.",
    }),
  );
  process.exitCode = 1;
} finally {
  service.onModuleDestroy();
}
