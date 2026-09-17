# CRIT — revisão manual no navegador

Ferramenta: https://github.com/tomasz-tomczyk/crit (Go). Sobe um servidor local em `127.0.0.1` com porta aleatória, abre o navegador com o diff da branch e deixa o usuário comentar linha a linha. Os comentários ficam em `~/.crit/reviews/<sessão>/` como JSON.

**Plugin do Claude Code** (`crit@crit`): cada membro instala uma vez com `claude plugin marketplace add tomasz-tomczyk/crit` e `claude plugin install crit@crit`. Traz as skills `crit` (fluxo abrir → esperar → agir) e `crit-cli` (referência completa da CLI). Use `crit-cli` como referência quando precisar de um subcomando não descrito aqui. Dentro da `do-task` **não** invoque a skill `crit` do plugin: ela faz o agente principal editar o código direto, e na esteira as correções passam pelo `tedi-dev`. O usuário pode usar `/crit` sozinho para revisões avulsas fora da esteira.

## Instalação (etapa 0 da skill)

`scripts/check-connectors.mjs` já diz se o binário existe. Se não existir, **pergunte antes de instalar** (é instalação de software na máquina do usuário). Com Go 1.26+ funcionando:

```bash
go install github.com/tomasz-tomczyk/crit/cmd/crit@latest
```

O binário vai para `%USERPROFILE%\go\bin\crit.exe`. Se essa pasta não estiver no PATH, chame pelo caminho completo. Alternativa sem Go: baixar `crit-windows-amd64.exe` em Releases, renomear para `crit.exe` e colocar no PATH.

## Abrir a revisão (etapa 6)

Na raiz do repositório da task, com a branch da task ativa e a base atualizada:

```bash
crit --base-branch develop
```

- `--base-branch` define contra o que o diff é calculado (a skill usa a base do PR: `develop`).
- `--port <n>` fixa a porta se o usuário quiser; por padrão é aleatória e o navegador abre sozinho (`--no-open` desliga isso).
- **O comando bloqueia até o usuário clicar em "Finish Review" ou "Approve" no navegador.** Por isso a skill roda com `run_in_background: true` e segue esperando a notificação de término.

## Esperar o usuário

Duas coisas encerram a espera, o que vier primeiro:

1. A **notificação de tarefa concluída** do Bash em background (o usuário clicou em Finish/Approve). A saída traz `approved: true|false` e o prompt de finalização com os comentários não resolvidos.
2. O **usuário dizer no chat que terminou**. Nesse caso leia os comentários com `crit comments --json` (na raiz do repo) e encerre o processo em background com TaskStop.

Enquanto espera, não invente que o usuário terminou. Se ele mandar outra mensagem que não seja "terminei", responda e continue esperando.

## Ler e agir sobre os comentários

```bash
crit comments --json      # só não resolvidos (formato plano, um objeto por comentário)
crit comments --all       # inclui resolvidos
crit status --json        # sessões ativas, quando houver mais de uma
```

Comentários de nível de revisão (sem arquivo) vêm primeiro; não os ignore. Para cada comentário não resolvido, a skill decide: corrigir (via agente `tedi-dev`, um prompt com todos os comentários daquela rodada), ou responder explicando por que não muda:

```bash
crit comment --reply-to <id> --author 'Claude Code' 'texto da resposta'
```

Nunca marque comentário como resolvido; isso é do usuário. Depois da rodada de correções, pergunte se ele quer abrir o CRIT de novo (`crit --base-branch develop`) ou seguir para o PR.
