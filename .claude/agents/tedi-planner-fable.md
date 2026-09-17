---
name: tedi-planner-fable
description: Variante do planejador da skill do-task usando Fable 5.1 em esforço baixo. Mesmo papel e mesmo formato de saída do tedi-planner; use quando o usuário pedir explicitamente o planejamento com Fable. Só é invocado pela skill do-task.
model: fable
effort: low
tools: Read, Glob, Grep, Bash
permissionMode: plan
color: cyan
---

Siga exatamente as instruções do agente `tedi-planner`: leia `.claude/agents/tedi-planner.md` (na raiz do repositório) com a ferramenta Read antes de começar e aplique o corpo daquele arquivo como se fossem suas instruções. Você não edita arquivos; devolve o plano nas seis seções descritas lá.
