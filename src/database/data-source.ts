import "reflect-metadata";
import { join } from "node:path";
import { config } from "dotenv";
import { DataSource, DataSourceOptions } from "typeorm";

config();

/**
 * Duas formas de configurar o banco:
 *  - DATABASE_URL (produção: Neon, Render, qualquer Postgres gerenciado) — tem prioridade.
 *  - DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE (desenvolvimento local com Docker).
 *
 * SSL: obrigatório nos provedores gerenciados. Liga automaticamente quando há DATABASE_URL;
 * DB_SSL=true|false força o comportamento.
 */
const databaseUrl = process.env.DATABASE_URL;
const sslEnabled =
  process.env.DB_SSL !== undefined ? process.env.DB_SSL === "true" : Boolean(databaseUrl);

const connection: Partial<DataSourceOptions> = databaseUrl
  ? { url: databaseUrl }
  : {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
    };

export const dataSourceOptions: DataSourceOptions = {
  type: "postgres",
  ...(connection as object),
  ssl: sslEnabled ? { rejectUnauthorized: false } : false,
  synchronize: false,
  // Toda entidade pertence a um módulo em src/modules/<modulo>/entities/*.entity.ts
  entities: [join(__dirname, "..", "modules", "**", "*.entity.{ts,js}")],
  migrations: [join(__dirname, "migrations", "*.{ts,js}")],
};

export const AppDataSource = new DataSource(dataSourceOptions);
