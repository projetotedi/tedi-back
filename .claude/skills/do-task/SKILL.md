---
name: do-task
description: Executa uma issue do Linear do projeto TEDI de ponta a ponta na esteira do time: checa conectores, lê o card e o plano de produto anexado no Linear, cria a branch com o identificador GUS-nn, planeja com um agente (Opus 5 high ou Fable 5.1 low), implementa com agentes Sonnet 5 em esforço máximo, revisa com Opus 5 medium, abre o CRIT para a revisão manual do usuário e, se ele quiser, abre o PR para develop com assignee e labels. Use quando o usuário colar o link de uma issue do Linear e pedir para fazer, implementar, executar, "pegar", "tocar" ou "puxar" a task, ou disser "do-task"; também quando disser "implementa a GUS-74".
argument-hint: "[link ou identificador da issue, ex.: GUS-74]"
disable-model-invocation: false
---

# do-task

Skill versionada no repositório (`.claude/skills/do-task/`), com os agentes em `.claude/agents/`. Qualquer membro do time com Claude Code, o MCP do Linear e credencial do GitHub para a org `projetotedi` consegue rodá-la; a etapa 0 confere isso. Os comandos de script abaixo assumem a raiz do repositório como diretório atual.

Pega **uma** issue do Linear e a leva até o PR, com um humano decidindo nos pontos que importam: aprovar o plano, revisar no CRIT e autorizar o PR. A skill orquestra; quem planeja, implementa e revisa são agentes separados, cada um com o modelo e o esforço certos para o papel (`references/agentes.md`).

## Por que a esteira é assim

O time troca a cada semestre, e a qualidade do que entra em `develop` não pode depender de quem está de plantão. Por isso: planejamento separado da implementação (o plano é o que se aprova, não o código), um revisor que não escreveu o código, e uma revisão humana no CRIT antes do PR. A skill nunca faz merge; rulesets em `develop` e `main` exigem CI verde e uma aprovação humana.

## Etapa 0 — Conectores

Rode `node .claude/skills/do-task/scripts/check-connectors.mjs` e confirme que as ferramentas do Linear estão disponíveis (`get_issue` na lista de ferramentas). O script verifica: git, credencial do GitHub com acesso à org `projetotedi` (e devolve o `login`), binário `crit`, Node, Yarn e os clones locais de `tedi-back` e `tedi-front`.

- Falta o `crit`: pergunte se pode instalar (`references/crit.md`); é instalação de software, não instale sem sim. Sem CRIT a esteira ainda roda, mas a etapa 6 vira revisão do diff no chat; diga isso.
- Falta credencial do GitHub ou Linear: pare e explique o que o usuário precisa fazer. Sem isso não há PR nem card.
- Tudo verde: uma linha de confirmação e siga.

## Etapa 1 — Qual task

Se veio argumento (`$ARGUMENTS`), use-o. Se não, pergunte: "Qual issue? Cole o link do Linear." Extraia `GUS-<n>` (`references/linear.md`). Uma issue por execução.

## Etapa 2 — Entender o fim, não só o meio

1. `get_issue` GUS-<n>: descrição completa, labels, milestone, `blockedBy`, status, assignee.
2. `list_documents` (`query: "TEDI"`) → `get_document` do **"Plano de Produto — TEDI"** anexado ao projeto. Localize o épico da milestone e a feature, os requisitos RF/RN citados no card e o objetivo O1..O5 que a feature serve.
3. Leia o memory.md da feature (caminho na primeira linha da issue) e `AGENTS.md` + `docs/ARCHITECTURE.md` do repositório alvo.
4. Bloqueadoras não concluídas ou issue já `In Progress` com outra pessoa: avise e pergunte se segue.

Escreva para o usuário um **Contexto** de 5 a 8 linhas: para que fim esta task existe no escopo total (objetivo, épico, quem usa), o que ela destrava, o que ela assume das anteriores, e os sinais de alerta do card. Isso vai no prompt do planejador e, depois, no PR.

## Etapa 3 — Branch e estado

1. Repositório: linha `Repositório:` do guia técnico, senão label `Backend` → `tedi-back`, `Frontend` → `tedi-front`. Card com os dois lados: back primeiro.
2. Branch conforme `references/github.md`: base `develop` atualizada, nome da linha `Branch:` do card ou `<tipo>/GUS-<n>-<slug-em-ingles>`. O identificador `GUS-<n>` sempre está no nome.
3. Worktree limpo antes de criar a branch (`git status --short` vazio); se não estiver, pare e pergunte o que fazer com as mudanças.
4. Linear: `save_issue` com `state: In Progress` e assignee = usuário que roda a skill.

## Etapa 3.1 — Planejamento

Lance o agente `tedi-planner` (Opus 5, high). Se o usuário pedir Fable, ou o Opus não estiver disponível, `tedi-planner-fable` (Fable 5.1, low). Prompt conforme `references/agentes.md`: card inteiro, contexto, memory, repositório, base.

Ao receber o plano:

1. Grave em `.agents/artifacts/plan-GUS-<n>.md` no repositório.
2. **Confira o mapa card → plano**: todo critério de aceite e todo caso de teste do card precisa estar na tabela do plano com um passo e um teste. Faltou algum: devolva ao mesmo agente (SendMessage) a lista do que faltou; não complete você.
3. Mostre ao usuário o plano (objetivo, passos resumidos, contrato, riscos) e pergunte: aprova, ajusta ou refaz. Nada é implementado sem aprovação explícita do plano. Ajustes viram nova versão do arquivo.

## Etapa 4 — Implementação

Lance o agente `tedi-dev` (Sonnet 5, esforço máximo), um por repositório tocado, com card, plano aprovado, repositório/branch e estado do ambiente (`docker compose ps` antes, para dizer se há Postgres). Rode em background e espere a notificação; não faça edições paralelas no mesmo repositório enquanto ele trabalha.

Ao receber o relatório: confira que há commits na branch (`git log develop..HEAD --oneline`) e que os comandos de qualidade saíram verdes. Testes vermelhos ou relatório incompleto: mostre ao usuário e pergunte antes de qualquer nova rodada.

## Etapa 5 — Revisão automática

Lance `tedi-reviewer` (Opus 5, medium) com card, plano, relatório do dev e `git diff develop...HEAD`. Achados `bloqueante` e `importante` voltam ao `tedi-dev` em **uma** rodada de correção; `menor` fica listado para o usuário. Re-revisão só do diff novo e só se houve bloqueante.

Mostre ao usuário: veredito, tabela de cobertura dos critérios, achados corrigidos e os que ficaram.

## Etapa 6 — Revisão manual no CRIT

Na raiz do repositório: `crit --base-branch develop` com `run_in_background: true` (`references/crit.md`). Avise: "O CRIT abriu no navegador. Comente o que quiser e clique em Finish Review, ou me diga 'terminei'." Depois **espere**: a notificação da tarefa em background ou a palavra do usuário, o que vier primeiro. Não avance sozinho.

Com a revisão encerrada: leia os comentários (saída do processo ou `crit comments --json`). Para cada um: corrigir via `tedi-dev` (uma rodada com todos os comentários) ou responder no CRIT explicando. Pergunte se ele quer reabrir o CRIT para conferir ou seguir.

## Etapa 7 — PR

Pergunte: "Quer que eu abra o PR para `develop`?" Só com sim explícito:

1. Título, corpo pelo template do repositório, labels mapeadas das labels da issue e assignee = login do usuário, tudo conforme `references/github.md`. Corpo em `.agents/artifacts/PR-GUS-<n>.md`, spec em `.agents/artifacts/pr-GUS-<n>.json`.
2. `git push -u origin <branch>`; depois `node .claude/skills/do-task/scripts/github-pr.mjs <spec>`. Se `develop` não existir no remoto, o script cria a partir de `main` só se o usuário tiver autorizado na etapa 3 (`createBaseFrom`).
3. Linear: anexar a URL do PR à issue e mover para o estado de revisão do time, se existir.
4. Relate: link do PR, o que o CI vai rodar, o que o revisor humano deve olhar primeiro, pendências.

Com não: deixe a branch local com os commits, diga o nome dela e o comando para abrir o PR depois.

## O que não fazer

- Não implementar sem plano aprovado; não abrir PR sem sim explícito; nunca mergear.
- Não sobrescrever o esforço dos agentes por conveniência: os arquivos em `.claude/agents/tedi-*.md` deste repositório são a fonte.
- Não editar código pela própria skill enquanto um `tedi-dev` está rodando no mesmo repositório.
- Não fazer push antes da etapa 7.
- Não inventar que o usuário terminou a revisão no CRIT.
- Não mudar título, descrição, estimativa ou milestone da issue: isso é da `create-task`.

## Arquivos de referência

- `references/agentes.md` — papéis, modelos, esforços, conteúdo do prompt de cada agente, tratamento de falhas.
- `references/linear.md` — como ler a issue e o documento do projeto, o que escrever de volta.
- `references/github.md` — branch, título, corpo pelo template de cada repo, labels, assignee, script.
- `references/crit.md` — instalação, abertura, espera, leitura dos comentários.
- `scripts/check-connectors.mjs` — etapa 0. `scripts/github-pr.mjs` — etapa 7.
