---
feature: E9.a Acesso ao sistema
epico: E9 Administração e segurança
milestone: E9 — Administração e segurança
modulo: auth (back e front)
sprint: Sprint 1 (14 a 25/09/2026), Equipe A
status: cards criados em 2026-09-16 (GUS-74 a GUS-89)
cards: .agents/artifacts/cards-e9a-acesso-ao-sistema.md
atualizado: 2026-09-16
---

# E9.a — Acesso ao sistema

## Contexto

Todo o resto do sistema pressupõe saber quem está logado e qual é o seu perfil: a matriz de permissões do plano (seção 2.1) define o que membro, diretor e coordenadora podem fazer, e cada endpoint dos módulos seguintes vai se apoiar nisso. Sem esta feature nenhuma outra pode ser protegida. Atende O2 indiretamente (histórico exige saber quem fez o quê) e é pré-requisito de RF-091, RF-092 e de toda a coluna de permissões.

Escopo pela linha do cronograma: "cada pessoa entra com seu login e enxerga só o que o seu perfil permite; a coordenadora gerencia quem tem acesso".

## Posição no roadmap

- **Depende de:** fundação dos dois repositórios (estrutura modular, `/health`, deploy, CI). Entregue: PRs de estrutura, deploy, compose e CI mergeados ou abertos em `projetotedi/tedi-back` e `tedi-front`. Não existe ainda: `BaseEntity`, `HttpExceptionFilter`/`ErroApiDto`, `config/` com validação de env, `openapi:export`. Esta feature vai criar o que precisar desses itens.
- **Bloqueia:** E1.a (cadastro de alunos precisa do guard para "só diretor e coordenadora"), E1.b (Membro se vincula a Usuario), e todos os demais módulos.
- **Roda em paralelo com:** E1.a (Equipe B), que começa sem guards e os aplica quando esta mergear. O contrato `@Roles()` / `RolesGuard` / `RequireRole` precisa estar definido cedo no sprint para a Equipe B não retrabalhar.
- **Decisões de reunião que afetam:** Q1.1 (aluno terá login?), Q1.2 e Q1.3 (quem cria conta de membro), Q1.5 (papel intermediário), Q1.6 (mais de uma conta com perfil máximo / super admin), Q8.3 (SSO institucional ou autenticação própria), Q9.4 (quem vê telefone e endereço).

## Escopo

### Dentro
- Entidade **Pessoa mínima** com credenciais embutidas (nome, e-mail, RA, hash de senha, perfil, acesso ativo, senha provisória, flag técnica super admin) e `BaseEntity` compartilhada. E1.a estende depois.
- **Contrato de autorização**: enum `Perfil` hierárquico (membro < diretor < coordenadora), `@Roles()`, `@Public()`, `@CurrentUser()`, guard global registrado por `auth` (ninguém importa `auth`), bypass de usuário fake só em desenvolvimento. Merge até 18/09.
- **Login por RA e senha** com cookie httpOnly, `GET /auth/me`, `POST /auth/logout`, rate limit no login, mensagens genéricas.
- **Link de convite por perfil**, gerado pela coordenadora e passado por fora (WhatsApp): uso único, 48 h, carrega o perfil; quem abre preenche nome, RA, e-mail e senha e a Pessoa nasce no aceite. Troca obrigatória quando a senha é provisória (seed).
- **Gestão de acessos** pela coordenadora: listar, gerar convite, revogar convite pendente, alterar perfil, ativar/desativar, gerar link de redefinição de senha. Regras: só coordenadora; não age sobre a própria conta; última coordenadora ativa protegida.
- **Seed** da coordenadora inicial por variáveis de ambiente.
- **Eventos auditáveis** emitidos por auth desde já (`AcaoAuditavel`).
- **Formato padrão de erro** (`ErroApiDto` + filtro global) e publicação do contrato OpenAPI (`operationIdFactory`, `openapi:export`/`check`).
- **Front**: proxy `/api` no Vercel e no Vite, mutator com cookie, sessão via `/auth/me`, `RequireRole`, tela de login, tela de definir senha (convite e troca obrigatória), tela de acessos, home com menu por perfil, páginas de 403 e sessão expirada.

### Fora (explicitamente)
- Consentimento LGPD e **persistência** do log de auditoria → E9.b (Sprint 3). Aqui só a emissão dos eventos.
- Vínculo Membro (curso, período, matrícula institucional como dado cadastral, data de saída) → E1.b (Sprint 2).
- Campos de Pessoa além do mínimo (nascimento, telefone, campos de aluno) → E1.a, em paralelo.
- Anonimização → E9.c.
- Envio de e-mail (convite e redefinição são links copiados; e-mail transacional fica para depois, se necessário), "esqueci minha senha" self-service, SSO institucional, refresh token deslizante, diretor gerenciando acessos, login de aluno/participante (Q1.1 segue aberta).

## Decisões

| # | Data | Pergunta | Decisão | Por quê | Quem | Status |
|---|---|---|---|---|---|---|
| 1 | 2026-09-16 | `Usuario` é entidade própria ou o login vive em Pessoa? | **Login dentro de Pessoa.** Não existe entidade Usuario; as credenciais e o perfil de acesso são campos de Pessoa. Coordenadora é uma Pessoa sem vínculo de Membro. | Decisão do usuário, contra o padrão sugerido (Usuario autônomo). Consequência: `auth` passa a depender de `pessoas`, invertendo o grafo previsto em `docs/ARCHITECTURE.md` §3; ver decisões 5 e 6. | Gustavo | confirmada |
| 2 | 2026-09-16 | Identificador de login | **Matrícula (RA)**, com e-mail e senha como campos da credencial. | Decisão do usuário. Pendente: como a coordenadora (professora, sem RA) entra; ver decisão 7. | Gustavo | confirmada |
| 3 | 2026-09-16 | "Super admin" (F9.1) existe? | **Só como flag técnica** (`superAdmin: boolean`), invisível nas telas; libera seed e operações de manutenção. Três perfis de produto: membro, diretor, coordenadora. RF-091 continua valendo: coordenadora altera perfis; super admin é exceção técnica. | Resolve a contradição F9.1 × matriz × RF-091 sem criar 4º perfil. | Gustavo | confirmada |
| 5 | 2026-09-16 | Quem cria a entidade Pessoa no Sprint 1, já que E1.a (Equipe B) também precisa dela? | **E9.a cria Pessoa mínima** (nome, e-mail, RA, credenciais, perfil, flags) no primeiro card, com meta de merge até 18/09. **E1.a estende** com nascimento, telefone e campos de aluno em migration própria. | Evita duas equipes criando a mesma tabela em paralelo. Cria dependência E1.a → card 1 da E9.a. | Gustavo | confirmada |
| 6 | 2026-09-16 | Onde ficam as credenciais e como evitar ciclo auth ↔ pessoas | **Colunas em Pessoa** (`ra`, `email`, `senhaHash`, `perfil`, `acessoAtivo`, `senhaProvisoria`, `superAdmin`). `auth` importa `PessoasModule` e registra o guard como **APP_GUARD global**; os demais módulos **não importam `auth`**, só usam `@Roles()` e `@Public()` de `shared/`. Grafo passa a ser `auth → pessoas`; ninguém depende de `auth`. | Quebra o ciclo e dispensa a Equipe B de importar auth. Exige atualizar `docs/ARCHITECTURE.md` §3 (card próprio). | Gustavo | confirmada |
| 7 | 2026-09-16 | Com o que a coordenadora entra, se não tem RA? | **Login só por RA.** Usuário acredita que a coordenadora (professora) também tem RA. RA obrigatório para quem tem acesso; opcional em Pessoa em geral (alunos idosos não têm). Único quando preenchido. | Se a coordenadora não tiver RA, o fallback é aceitar RA ou e-mail no mesmo campo (uma linha no service). | Gustavo; confirmar com a coordenadora até 19/09 | pendente |
| 8 | 2026-09-16 | Perfis hierárquicos ou exatos no guard? | **Hierárquico**: `membro < diretor < coordenadora`. `@Roles(Perfil.DIRETOR)` = diretor ou acima. `superAdmin` passa por qualquer `@Roles`. | Coerente com F9.1 e com a matriz; menos esquecimento nos endpoints da Equipe B. | Gustavo | confirmada |
| 9 | 2026-09-16 | Diretor gerencia acessos? | **Só coordenadora no Sprint 1** (criar, ativar/desativar, redefinir senha, alterar perfil). Abrir para diretor depois é trocar um `@Roles`. Resolve o 🟡 da matriz para este sprint. | Mais restritivo e reversível. | Gustavo | confirmada |
| 10 | 2026-09-16 | Várias coordenadoras? Proteger a última? | **N coordenadoras**; service impede rebaixar ou desativar a **última coordenadora ativa**. Sucessão = promover outra antes de sair. | Evita sistema travado sem ninguém para gerir acessos. | Gustavo | confirmada |
| 11 | 2026-09-16 | Gestão de acessos entra em E9.a? | **Sim, mínima**: tela "Acessos" para a coordenadora com listar, criar (nome, RA, e-mail, perfil), alterar perfil, ativar/desativar, redefinir senha. E1.b reaproveita o service ao cadastrar membro. | Sem isso o Sprint 1 entrega login sem forma de criar usuário. | Gustavo | confirmada |
| 12 | 2026-09-16 | SSO institucional ou senha própria (Q8.3)? | **Senha própria no MVP**; SSO fica isolado em `strategies/` como evolução. | Integração com a UTFPR não está no roadmap. | Gustavo | confirmada |
| 13 | 2026-09-16 | Bootstrap da primeira coordenadora | **Seed idempotente por env** (`ADMIN_RA`, `ADMIN_EMAIL`, `ADMIN_SENHA`): cria a coordenadora com `superAdmin=true` se não existir, com troca obrigatória no primeiro login. Roda no `start:prod` e no compose local. Variáveis entram em `render.yaml`, `.env.example` e `docs/DEPLOY.md`. | Sem bootstrap ninguém entra. | Gustavo | confirmada |
| 14 | 2026-09-16 | Como o usuário novo recebe a senha inicial? | **Convite por e-mail com link** (token de uso único com validade), em que a pessoa define a própria senha. **Traz dependência nova: serviço de e-mail transacional.** Provedor e conta a decidir (decisão 17). | Decisão do usuário, contra o padrão sugerido (senha provisória via WhatsApp). Mais seguro e sem senha trafegando por fora, ao custo de infra de e-mail no Sprint 1. | Gustavo | confirmada |
| 15 | 2026-09-16 | "Esqueci minha senha" no MVP? | **Coordenadora redefine** pela lista de acessos. Com e-mail disponível (decisão 14), redefinir = reenviar convite/link de nova senha. Tela de login: "Esqueceu a senha? Fale com a coordenação". Self-service fica para depois. | Padrão confirmado, adaptado ao e-mail. | Gustavo | confirmada |
| 16 | 2026-09-16 | Troca obrigatória de senha no primeiro acesso? | **Sim**, e após redefinição. Com convite por link a pessoa já define a senha ao aceitar; a flag `senhaProvisoria` cobre o caso do seed (coordenadora inicial) e qualquer caminho futuro de senha gerada. | Garante que só a pessoa conhece a senha. | Gustavo | confirmada |
| 17 | 2026-09-16 | Provedor de e-mail transacional | **Resend, plano free** (3.000/mês, 100/dia). `RESEND_API_KEY` e `EMAIL_FROM` no Render, `.env.example`, `render.yaml`, `docs/DEPLOY.md`. Conta e verificação de domínio são ação do usuário; até verificar domínio, o modo de teste só envia para o e-mail do dono da conta. Envio isolado em `shared/email/` com interface própria, para trocar de provedor sem tocar em auth. | Decisão do usuário. Dependência externa nova no Sprint 1. | Gustavo | confirmada |
| 18 | 2026-09-16 | UX de 403 e 401 | **403** → página "Você não tem acesso a esta área", sessão mantida. **401** → login com "Sua sessão expirou" e retorno à rota original após entrar. `http-client` só dispara `tedi:unauthorized` em 401. | Padrão confirmado. | Gustavo | confirmada |
| 19 | 2026-09-16 | Revogação: desativar/mudar perfil vale na hora? | **Na hora**: o guard carrega a Pessoa do banco a cada request e usa `perfil` e `acessoAtivo` atuais. O token só identifica; não carrega perfil como verdade. | RNF-22 de fato. Custo desprezível no volume do projeto. Também mitiga a decisão 20. | Gustavo | confirmada |
| 20 | 2026-09-16 | Duração da sessão (RNF-23) | **Token de 7 dias** a partir do login. **Desvio consciente de RNF-23** (expiração por inatividade): registrar no plano como requisito relaxado no MVP. Mitigação: revogação imediata pela decisão 19 e logout manual. | Decisão do usuário: membro quase não reloga. Reavaliar se a coordenadora pedir. | Gustavo | confirmada |
| 21 | 2026-09-16 | Auth emite eventos auditáveis já no Sprint 1? | **Sim.** Payload de `AcaoAuditavel` (autor, ação, alvo, antes/depois, quando) nasce em `shared/events/`; auth emite em criar acesso, alterar perfil, ativar/desativar, redefinir senha, aceitar convite. E9.b só adiciona ouvinte e persistência. | RF-092 exige trilha para mudança de perfil. | Gustavo | confirmada |
| 22 | 2026-09-16 | Token no localStorage ou cookie httpOnly? | **Cookie httpOnly**, `Secure`, `SameSite=None` (front e API em domínios diferentes). Front: `http-client.ts` deixa de guardar token e passa a usar `credentials: "include"`; endpoint `POST /auth/logout` limpa o cookie; 401 continua disparando `tedi:unauthorized`. CORS já está com `credentials: true`. **Risco:** Safari/iOS bloqueia cookie de terceiros por padrão; ver decisão 25. | Decisão do usuário, contra o padrão sugerido. Mais seguro contra XSS. | Gustavo | confirmada |
| 23 | 2026-09-16 | Coordenadora age sobre a própria conta? | **Não** altera o próprio perfil nem se desativa; outra coordenadora pode. Botões desabilitados na própria linha, validação no service. | Padrão confirmado. | Gustavo | confirmada |
| 24 | 2026-09-16 | Proteção contra força bruta no login | **Rate limit simples**: 10 tentativas por RA/IP em 15 min → "Aguarde alguns minutos". Sem bloqueio permanente. `@nestjs/throttler` só na rota de login. | Padrão confirmado. | Gustavo | confirmada |
| 25 | 2026-09-16 | Cookie de terceiros bloqueado por Safari/iOS | **Proxy no Vercel**: front chama `/api/*` e um rewrite no `vercel.json` repassa para o Render. Para o navegador vira mesma origem: cookie first-party, funciona em iPhone. `VITE_API_URL` passa a `/api` em produção; em dev, o proxy do Vite faz o mesmo para `localhost:3000`. CORS deixa de ser necessário para o front (mantido para Swagger/curl). | Chamada em aula é pelo celular; iPhone não pode ficar fora. Também serve quando houver domínio próprio. | Gustavo | confirmada |
| 26 | 2026-09-16 | Prazo do contrato de autorização para a Equipe B | **Até 18/09**: cards 1 (Pessoa mínima) e 2 (enum `Perfil`, `@Roles`, `@Public`, `@CurrentUser`, guard global) mergeados, com bypass de usuário fake **só em desenvolvimento** (`DEV_FAKE_PERFIL`, recusado em produção) para a Equipe B testar antes do login existir. No front, `RequireRole` no mesmo prazo. | E1.a roda em paralelo e anota `@Roles` desde o início. | Gustavo | confirmada |
| 27 | 2026-09-16 | Como o front descobre o perfil; `ErroApiDto` entra aqui? | **`GET /auth/me`** após login e ao recarregar (com cookie httpOnly o front não vê o token). **`ErroApiDto` + `HttpExceptionFilter` global entram nesta feature** como card próprio: auth é o primeiro a devolver erros e define o formato para todos. | Padrão confirmado. | Gustavo | confirmada |
| 28 | 2026-09-16 | Home após login no Sprint 1 (Q15) | Home única com saudação, perfil e menu filtrado por perfil; coordenadora vê "Acessos". Módulos seguintes plugam seus itens. | Padrão adotado sem contestação. | assumida | assumida |
| 29 | 2026-09-16 | Mensagem de erro do login distingue RA inexistente de senha errada? (Q20) | **Não**: "Matrícula ou senha incorretos". Conta desativada tem mensagem própria: "Seu acesso está inativo, fale com a coordenação". | Não revelar quem tem conta. Padrão adotado. | assumida | assumida |
| 30 | 2026-09-16 | Regra mínima de senha (Q23) | Mínimo 8 caracteres, sem exigência de composição. Validada no DTO e no formulário. | RNF-06 (uso sem treinamento). Padrão adotado. | assumida | assumida |
| 31 | 2026-09-16 | Convite: e-mail ou link gerado? | **Link de convite gerado pelo sistema**, sem envio de e-mail no MVP. A coordenadora copia o link e passa por WhatsApp. **Reverte as decisões 14 e 17** (Resend sai do sprint). | Correção do usuário na revisão dos cards. Tira a dependência externa do Sprint 1. | Gustavo | confirmada |
| 32 | 2026-09-16 | O link é por pessoa ou por perfil? | **Por perfil**: a coordenadora escolhe o perfil (membro, diretor, coordenadora) e o sistema gera um link que **carrega o perfil**. Quem abre preenche nome, RA, e-mail e senha. A Pessoa nasce no aceite (ou é reaproveitada por RA, RN-09). | Decisão do usuário. Reinterpreta RN-08: o cadastro do membro é feito pela pessoa, mas **só com convite emitido pela coordenadora**, então a coordenação continua controlando quem entra. | Gustavo | confirmada |
| 33 | 2026-09-16 | Validade e reuso do link | **Uso único, 48 h.** Expirado ou usado, a coordenadora gera outro. Convite pendente pode ser revogado. | Link por WhatsApp pode vazar; validade curta e uso único limitam o dano. | Gustavo | confirmada |
| 34 | 2026-09-16 | Redefinição de senha sem e-mail | **Coordenadora gera link de redefinição** (mesma entidade de convite, tipo `redefinicao`, ligado à Pessoa, uso único, 48 h) e passa à pessoa. **Substitui a decisão 15** na parte do envio. | Coerente com a decisão 31. | Gustavo | confirmada |
| 14 | — | (revertida) | Convite por e-mail | Substituída pela decisão 31. | — | revertida |
| 15 | — | (parcialmente revertida) | Coordenadora redefine: mantido; envio por e-mail: substituído pela decisão 34. | — | — | revertida |
| 17 | — | (revertida) | Resend como provedor de e-mail | Sem e-mail no MVP (decisão 31). Se voltar, reabrir. | — | revertida |
| 35 | 2026-09-17 | Idioma do código | **Tudo a nível de código em inglês** (regra geral do projeto, dada pelo usuário). Vale para módulos (`people`, não `pessoas`), entidades (`Person`), colunas (`passwordHash`, `role`, `accessEnabled`, `mustChangePassword`, `isSuperAdmin`), enums (`Role`: `member`/`director`/`coordinator`), DTOs (`ApiErrorDto`), rotas (`/access`, `/invites`, `/auth/password`), `operationId` (`listAccess`, `createInvite`), códigos de erro (`INVALID_CREDENTIALS`), eventos (`AuditableActionEvent`), env vars, chaves de i18n, nomes de testes. Textos de interface continuam em português via i18n. **As decisões 1 a 34 abaixo usam nomes em português por terem sido escritas antes; os nomes válidos são os do arquivo de cards e das issues, já convertidos.** | Padrão do projeto; evita mistura de idiomas no código. Reverte a regra "domínio em português" de `docs/ARCHITECTURE.md` §1.5 (corrigir em GUS-89). | Gustavo | confirmada |
| 4 | 2026-09-16 | Desativar acesso × inativar membro (RF-011) | **Flag `acessoAtivo`** na credencial. Login recusa inativo. `deletedAt` reservado para anonimização (E9.c). Inativar membro (E1.b) desativa o acesso e grava data de saída no Membro. | Padrão sugerido, confirmado. | Gustavo | confirmada |

## Regras de negócio confirmadas

- RN-08: cadastro de novos membros é feito por coordenadora ou diretoria; não há autocadastro.
- RF-090: autenticar usuários e aplicar permissões por perfil.
- RF-091: apenas a coordenadora altera o perfil de acesso de um usuário.
- RNF-20 (hash forte), RNF-21 (HTTPS), RNF-22 (autorização no servidor), RNF-23 (sessão expira por inatividade).

## Permissões

| Ação | Membro | Diretor | Coordenadora |
|---|---|---|---|
| Entrar, ver `/auth/me`, sair, trocar a própria senha | ✅ | ✅ | ✅ |
| Listar acessos | ❌ | ❌ | ✅ |
| Gerar link de convite (com perfil) e revogar convite pendente | ❌ | ❌ | ✅ |
| Aceitar convite (preencher dados e senha) | qualquer pessoa com link válido | | |
| Alterar perfil de outro usuário | ❌ | ❌ | ✅ (RF-091) |
| Ativar / desativar acesso de outro usuário | ❌ | ❌ | ✅ |
| Gerar link de redefinição de senha para outro usuário | ❌ | ❌ | ✅ |
| Alterar o próprio perfil ou desativar a si mesma | ❌ | ❌ | ❌ (decisão 23) |
| Rebaixar/desativar a última coordenadora ativa | ❌ | ❌ | ❌ (decisão 10) |

Hierarquia no guard: `@Roles(Perfil.DIRETOR)` admite diretor e coordenadora. `superAdmin=true` passa por qualquer `@Roles`, é invisível nas telas e só nasce pelo seed.

## Riscos e pendências

- **Pendência (decisão 7):** confirmar com a coordenadora até 19/09 que ela tem RA. Se não tiver, aceitar RA ou e-mail no mesmo campo.
- **Ação do usuário:** colocar `JWT_SECRET`, `ADMIN_RA`, `ADMIN_NOME`, `ADMIN_EMAIL`, `ADMIN_SENHA` e `APP_URL` (base dos links de convite) no Render.
- **Link por WhatsApp:** o convite carrega o perfil e qualquer pessoa com o link entra até ele ser usado ou expirar (48 h). Mitigações: uso único, revogação pela tela de acessos, e o convite mostra na tela de aceite qual perfil está sendo concedido.
- **Carga do sprint:** duas pessoas, duas semanas, e a feature carrega fundações (BaseEntity, ErroApiDto, openapi:export, proxy). Se apertar, o corte natural é a tela de acessos ficar só com listar + criar; alterar perfil e ativar/desativar via API são cobertos por e2e e a tela completa vai para o Sprint 2.
- **Dependência cruzada:** E1.a depende dos cards 1 e 2 até 18/09. Qualquer mudança posterior no contrato (`@Roles`, hierarquia, `RequireRole`) quebra a Equipe B.
- **RNF-23 relaxado** (decisão 20): sessão de 7 dias. Registrar no plano de produto como desvio aceito no MVP.
- **Cookie cross-site**: mitigado pelo proxy (decisão 25). Se alguém acessar a API direto pelo domínio do Render num navegador, o cookie não funciona; Swagger continua funcionando com o botão Authorize? Não: com cookie httpOnly o Swagger precisa de `withCredentials` no mesmo domínio. Aceito: Swagger é para leitura do contrato.
- **Render free hiberna**: tela de login mostra "conectando ao servidor" após 3 s de espera.
- Q1.1 (aluno com login), Q1.4, Q1.5 e Q9.4 seguem abertas de propósito; não bloqueiam esta feature.

## Issues no Linear

GUS-74 Person mínima · GUS-75 Contrato de autorização · GUS-76 ApiErrorDto · GUS-77 OpenAPI export · GUS-78 Login · GUS-79 Seed e troca de senha · GUS-80 Convite por perfil · GUS-81 Gestão de acessos · GUS-82 Proxy /api · GUS-83 Sessão no front · GUS-84 Tela de login · GUS-85 Aceite do convite · GUS-86 Home e menu · GUS-87 Tela de acessos (lista/gerar) · GUS-88 Tela de acessos (ações) · GUS-89 Docs. Relacionada pré-existente: GUS-72 "Login" (João), vinculada a GUS-78.

## Referências

- Plano de produto: seção 2 (papéis e matriz), F9.1, RF-090, RF-091, RN-08, RNF-20 a RNF-25, Q1, Q8.3.
- Arquitetura: `tedi-back/docs/ARCHITECTURE.md` §2 e §3 (`auth` não depende de ninguém; todos dependem dele); `tedi-front/docs/ARCHITECTURE.md` (`RequireRole`, `AppLayout` por perfil, `http-client.ts` com token em `localStorage` e evento `tedi:unauthorized`).
