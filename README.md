# tedi-back

API do TEDI — sistema de gestão do projeto de extensão (pessoas, turmas, aulas, alocação de voluntários e banco de horas).

Stack: NestJS 11 + TypeORM 0.3 + PostgreSQL 16, TypeScript, Yarn.

## Rodando localmente

```bash
cp .env.example .env        # ajuste DB_HOST para localhost se o Postgres não estiver no Docker
yarn install
yarn migration:run
yarn dev                    # http://localhost:3000/api/docs
```

## Comandos

| Comando                                                | O que faz                                  |
| ------------------------------------------------------ | ------------------------------------------ |
| `yarn dev`                                             | sobe a API em watch mode                   |
| `yarn test`                                            | testes unitários (sem banco)               |
| `yarn test:int`                                        | testes de integração (precisa de Postgres) |
| `yarn lint` / `yarn format:check`                      | qualidade                                  |
| `yarn build`                                           | compila para `dist/`                       |
| `yarn migration:create src/database/migrations/<Nome>` | nova migration                             |
| `yarn migration:run`                                   | aplica migrations                          |

## Arquitetura

Monólito modular: um módulo por área do domínio em `src/modules/`, transversal em `src/shared/`. Mapa de módulos, dependências permitidas, template de módulo e regras de teste e de Swagger em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Convenções para quem contribui (humano ou agente) em [`AGENTS.md`](AGENTS.md).
