#!/usr/bin/env node

import { startMcpHttpServer } from "./server.js";

async function main(): Promise<void> {
  const started = await startMcpHttpServer(process.env);
  process.stdout.write(
    `${JSON.stringify({
      status: "listening",
      host: started.host,
      port: started.port,
      healthUrl: started.healthUrl,
      mcpUrl: started.mcpUrl,
    })}\n`,
  );

  const shutdown = async () => {
    await started.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
