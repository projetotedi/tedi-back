import "reflect-metadata";
import { join } from "node:path";
import { config } from "dotenv";
import { DataSource, DataSourceOptions } from "typeorm";

config();

export const dataSourceOptions: DataSourceOptions = {
  type: "postgres",
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  synchronize: false,
  // Toda entidade pertence a um módulo em src/modules/<modulo>/entities/*.entity.ts
  entities: [join(__dirname, "..", "modules", "**", "*.entity.{ts,js}")],
  migrations: [join(__dirname, "migrations", "*.{ts,js}")],
};

export const AppDataSource = new DataSource(dataSourceOptions);
