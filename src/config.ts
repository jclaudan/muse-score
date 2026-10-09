import { join } from "node:path";

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 8000),
    host: process.env.HOST ?? "0.0.0.0",
    dataDir: process.env.DATA_DIR ?? join(process.cwd(), "data"),
  };
}
