# Agentes da esteira

Definições em `.claude/agents/` deste repositório (versionadas; valem para quem clonar). O modelo pode ser sobrescrito por chamada (parâmetro `model` da ferramenta Agent), mas o **esforço só vem da definição**; por isso cada papel tem seu arquivo.

| Papel | `subagent_type` | Modelo | Esforço | Edita? |
|---|---|---|---|---|
| Planejamento | `tedi-planner` | Opus 5 | high | não (Read/Glob/Grep/Bash, plan) |
| Planejamento (alternativa) | `tedi-planner-fable` | Fable 5.1 | low | não |
| Implementação | `tedi-dev` | Sonnet 5 | max | sim (acceptEdits) |
| Revisão | `tedi-reviewer` | Opus 5 | medium | não |

Padrão: `tedi-planner`. Use `tedi-planner-fable` quando o usuário pedir Fable ou quando o Opus não estiver disponível.

## O que vai no prompt de cada agente

O agente não vê a conversa. Tudo que ele precisa vai no prompt, em blocos com títulos:

**tedi-planner / tedi-planner-fable**

1. `## Card` — identificador, título, URL e a descrição inteira da issue (as duas metades).
2. `## Contexto de produto` — o resumo da etapa 2 (para que fim a task serve, objetivo O#, épico, feature, o que já foi entregue das dependências).
3. `## Memória da feature` — o conteúdo do memory.md, ou o caminho absoluto se for grande demais (ele lê).
4. `## Repositório` — caminho absoluto do clone e branch atual; base do diff (`develop`).
5. `## Saída esperada` — "plano nas seis seções do seu arquivo de definição; não edite nada".

A skill grava a resposta em `.agents/artifacts/plan-GUS-<n>.md` no repositório e **confere o mapa card → plano**: cada critério de aceite e cada caso de teste do card precisa aparecer na tabela. Se faltar algum, mande o agente completar (SendMessage para o mesmo agente, com a lista do que faltou) antes de mostrar ao usuário.

**tedi-dev**

1. `## Card` — idem.
2. `## Plano aprovado` — o plano inteiro (ou caminho absoluto do arquivo).
3. `## Repositório e branch` — caminho absoluto, nome da branch (já ativa), base.
4. `## Ambiente` — se o Docker/Postgres está de pé (a skill testa antes com `docker compose ps` e diz o resultado), quais comandos de qualidade valem para este repo.
5. `## Saída esperada` — "relatório final no formato do seu arquivo de definição; commits na branch; sem push".

Um agente por repositório tocado. Card que mexe nos dois repos (raro; a `plan-feature` separa por lado) roda o back primeiro, depois o front, porque o front regenera o cliente a partir do contrato do back.

**tedi-reviewer**

1. `## Card`, `## Plano`, `## Relatório do dev` — os três inteiros.
2. `## Repositório` — caminho absoluto, branch, base (`develop`), comando `git diff develop...HEAD`.
3. `## Saída esperada` — "veredito, achados por severidade, cobertura, fora do card".

Depois da revisão, a skill separa os achados: `bloqueante` e `importante` voltam para o `tedi-dev` em **uma** rodada de correção (prompt com a lista de achados e a instrução "corrija só isto, commite, rode a qualidade de novo"); `menor` fica registrado no relatório para o usuário decidir no CRIT. Uma segunda rodada de revisão só se houve correção bloqueante, e só sobre o diff novo.

## Falhas

- Agente encerrou sem relatório ou com testes vermelhos: mostre o que veio, não avance para a etapa seguinte e pergunte ao usuário como seguir (tentar de novo com mais contexto, ou assumir manualmente).
- Agente saiu do escopo (arquivos fora do plano): a skill lista os arquivos extras no relatório; o revisor e o CRIT pegam.
- Nunca reexecute um agente "por segurança" sem dizer ao usuário: cada rodada tem custo.
