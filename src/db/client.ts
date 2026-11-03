import { PrismaPg } from "@prisma/adapter-pg";
import * as dotenv from "dotenv";
import { PrismaClient } from "../generated/prisma/client.js";

dotenv.config({ quiet: true });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

export const prisma = new PrismaClient({ adapter });
