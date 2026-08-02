import { defineConfig } from "drizzle-kit";
import { isAbsolute, join, resolve } from "node:path";

const configuredDataDirectory = process.env.AI_TAVERN_DATA_DIR ?? "./data";
const dataDirectory = isAbsolute(configuredDataDirectory)
  ? configuredDataDirectory
  : resolve(process.cwd(), configuredDataDirectory);

export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: join(dataDirectory, "ai-tavern.sqlite"),
  },
});
