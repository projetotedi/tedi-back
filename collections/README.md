# Bruno collection — tedi-back

Coleção do [Bruno](https://www.usebruno.com/) com todas as rotas HTTP da API.

## Como usar

1. Instale o Bruno: `winget install Bruno.Bruno` (ou baixe em usebruno.com).
2. No Bruno, `File → Open Collection` e aponte para esta pasta (`tedi-back/collections/`).
3. Selecione o ambiente no canto superior direito (`production` ou `development`).

## Ambientes

- `production` — API no Render (`baseUrl = https://tedi-back.onrender.com`).
- `development` — API local em `http://localhost:3000` (rode `yarn dev` com o Postgres do compose de pé).

Adicione novos ambientes copiando `environments/production.bru`.

## Organização

Uma subpasta por tag Swagger / módulo do domínio (`health/`, `auth/`, `people/`, ...). Cada arquivo `.bru` é uma request, nomeada com o `operationId` do Swagger (`check.bru`, `login.bru`, `me.bru`, ...). Assim o nome no Bruno bate com o nome do hook gerado pelo Orval no front.

## Manutenção

**Regra do time:** todo PR que adicionar ou alterar uma rota HTTP precisa criar/atualizar a request correspondente aqui, no mesmo commit. A esteira `do-task` faz isso automaticamente; se estiver mexendo à mão, não esqueça.
