# GitHub — branch, PR, labels e assignee

## Acesso

A org `projetotedi` é privada e a integração GitHub do Claude devolve 404 nela. O que funciona é a credencial salva no Git Credential Manager de quem roda a skill (uma conta GitHub com acesso à org). Todo acesso à API passa por `scripts/github-pr.mjs` e `scripts/check-connectors.mjs`, que fazem `git credential fill` dentro do processo. **O token nunca é impresso nem colocado em variável de ambiente.**

## Branch da task

1. `git fetch origin` e base atualizada: `git checkout develop && git pull --ff-only` (ou `git checkout -b develop origin/develop` se ainda não existir local).
2. Se `origin/develop` **não existir** no repositório (hoje é o caso do `tedi-front`), pergunte ao usuário se pode criar a partir de `main`. Com sim, o próprio `github-pr.mjs` cria na hora do PR (`createBaseFrom: "main"`); para trabalhar antes disso, crie local: `git checkout -b develop origin/main`.
3. Nome da branch: use a linha `**Branch:**` do guia técnico da issue quando existir (ex.: `feature/GUS-74-person-entity`). Se não existir, monte `<tipo>/GUS-<n>-<slug-em-ingles>`, com tipo `feature` (label Feature), `fix` (Bug), `chore` (Improvement/INFRA) ou `docs` (prefixo `[docs]` no título). Slug curto, em inglês, kebab-case, sem acento.
4. `git checkout -b <branch> develop`. O identificador `GUS-<n>` **sempre** está no nome; o Linear liga a branch à issue por ele.

## Título do PR

Formato convencional, escopo = módulo em inglês, identificador no fim:

```
feat(people): entidade Person mínima com credenciais e BaseEntity (GUS-74)
```

Tipos: `feat`, `fix`, `chore`, `docs`, `ci`, `test`, `refactor`.

## Corpo do PR

Cada repositório tem seu template em `.github/pull_request_template.md`; leia o arquivo na hora e preencha **todas** as seções. Não troque o template.

**tedi-back** (Resumo, Impacto funcional, Migração, Validações, Observações):

- Resumo: 2 a 5 linhas com o que muda e por quê, linkando a issue do Linear.
- Impacto funcional: endpoints novos/alterados, tabelas, comportamento.
- Migração: marcar a opção certa e citar o nome (`Migration: CreatePeople`).
- Validações: marcar só o que rodou de verdade, com base no relatório do `tedi-dev`.
- Observações: decisões do memory citadas por número, variáveis de ambiente novas, o que o revisor deve olhar primeiro.

**tedi-front** (Descrição, Tipo de PR, Links Relacionados, Contexto, Checklist, Variáveis de ambiente, Evidências, Observações):

- Tipo de PR: marcar um.
- Links Relacionados: `Card:` = URL da issue do Linear; `Issue:` = a mesma ou vazia; protótipo se houver.
- Checklist: marcar só o verificado. Variáveis: preencher os blocos `env` ou escrever "não se aplica".
- Evidências: cite os testes que provam os critérios; screenshot só se o usuário fornecer.

Rodapé obrigatório em ambos, na última linha:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Labels (Linear → GitHub)

Os repositórios só têm as labels padrão do GitHub. O script cria as que faltarem, com cor fixa:

| Label da issue no Linear   | Label no PR                 |
| -------------------------- | --------------------------- |
| Backend                    | `backend`                   |
| Frontend                   | `frontend`                  |
| INFRA                      | `infra`                     |
| Feature                    | `feature`                   |
| Improvement                | `improvement`               |
| Bug                        | `bug` (já existe)           |
| Migration                  | `migration`                 |
| prefixo `[docs]` no título | `documentation` (já existe) |

## Assignee

Sempre o usuário que está rodando a skill, pelo login que `check-connectors.mjs` devolve em `githubLogin`. Nunca outra pessoa.

## Chamada do script

```bash
node .claude/skills/do-task/scripts/github-pr.mjs <spec.json>
```

```json
{
  "repo": "tedi-back",
  "head": "feature/GUS-74-person-entity",
  "base": "develop",
  "title": "feat(people): entidade Person mínima com credenciais e BaseEntity (GUS-74)",
  "bodyFile": ".agents/artifacts/PR-GUS-74.md",
  "assignees": ["<login devolvido pelo check-connectors>"],
  "labels": ["backend", "feature", "migration"],
  "createBaseFrom": "main"
}
```

O spec e o corpo ficam em `.agents/artifacts/` do repositório (pasta não versionada). O script é idempotente: se já houver PR aberto para a mesma `head`, atualiza título, corpo, base, labels e assignee em vez de duplicar. Ele imprime a URL do PR; repasse-a ao usuário.

## Depois do PR

- Linear: anexe a URL do PR à issue (`create_attachment`) e mova para o estado de revisão que existir no time (`list_issue_statuses`; hoje: `In Review` se existir, senão deixe `In Progress` e diga).
- Não habilite auto-merge, não aprove o próprio PR, não faça merge. Rulesets em `develop`/`main` exigem CI verde e uma aprovação humana.
