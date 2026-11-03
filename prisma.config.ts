import { defineConfig } from "prisma/config";
import * as dotenv from "dotenv";

dotenv.config({ quiet: true });

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
    },
    datasource: {
        url: process.env.DATABASE_URL!,
    },
});