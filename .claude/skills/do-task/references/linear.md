# Linear — o que a skill lê e escreve

Workspace `gustavo-pessoal`, time `Gustavo Pessoal` (chave `GUS`), projeto `TEDI`. Ferramentas: o MCP do Linear (`get_issue`, `get_document`, `list_documents`, `save_issue`, `save_comment`, `create_attachment`, `list_issue_statuses`, `list_users`).

## Identificador a partir do link

`https://linear.app/gustavo-pessoal/issue/GUS-74/people-entidade-person...` → `GUS-74`. Aceite também só o identificador (`GUS-74`) ou o número (`74`). Se não bater com `GUS-\d+`, pergunte de novo.

## Leitura da issue (`get_issue`)

Campos que a skill usa:

- `description`: tem duas metades separadas por `---`. Em cima, produto: **Descrição**, **Critérios de aceite**, **Casos de teste**. Embaixo, **🔧 Guia técnico**: `Repositório`, `Módulo`, `Branch`, `Onde mexer`, `Contrato com a API`, `Checklist técnico`, `Definição de pronto`, `Sinais de alerta`. A primeira linha traz `Feature`, `Memória` (caminho do memory.md da feature, dentro do `tedi-back`), `Esforço`, `Depende de` e `Idioma do código`.
- `labels`: lado (`Backend`/`Frontend`/`INFRA`) define o repositório quando o guia não diz; tipo (`Feature`/`Improvement`/`Bug`) e `Migration` viram labels do PR.
- `projectMilestone`: épico (E1..E12) para situar no plano de produto.
- Relações `blockedBy`: se alguma bloqueadora não estiver `Done`/`Merged`, avise antes de começar e pergunte se segue mesmo assim.
- `status`: se já estiver `In Progress` com outro `assignee`, avise: alguém pode estar trabalhando nela.

Issues antigas sem guia técnico (ex.: criadas à mão) ainda funcionam: o planejador deriva módulo e repositório da descrição; se nem isso der, pergunte ao usuário o repositório.

## Documento do projeto

O plano de produto está anexado ao projeto no Linear como documento **"Plano de Produto — TEDI (v0.2)"** (`list_documents` com `query: "TEDI"`, depois `get_document` pelo `id`). É a fonte para a etapa 2: objetivos O1..O5, épicos, requisitos RF/RNF/RN, cronograma. Prefira ele à cópia local `TEDI-plano-de-produto.md` (v0.1), que pode estar defasada. A descrição do projeto (`get_project`) resume o mesmo conteúdo e serve de fallback.

Memória da feature: caminho na primeira linha da issue (ex.: `tedi-back/.agents/memory/features/e9a-acesso-ao-sistema.md`). Traz as decisões numeradas que o card cita; leia inteira.

## Escrita

- Ao começar (etapa 3): `save_issue` com `state: "In Progress"` e `assignee` = usuário que roda a skill (descubra o nome dele no Linear com `list_users` e confirme na primeira execução; guarde a resposta em `.agents/memory/equipe.md` se ainda não estiver lá).
- Ao abrir o PR (etapa 7): `create_attachment` com a URL do PR e título `PR tedi-back#<n>`; `save_issue` para o estado de revisão do time se existir (`list_issue_statuses`).
- Comentários (`save_comment`) só para registrar decisões tomadas durante a implementação que divergem do card (ex.: "decisão 7 confirmada: coordenadora tem RA"). Não poluir a issue com log de passos.
- Nunca altere título, descrição, estimativa ou milestone da issue a partir desta skill; isso é da `create-task`.
