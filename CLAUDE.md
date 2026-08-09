# Mappa de Salas — Handoff técnico para manutenção por IA

Atualizado em: 2026-08-07

Este arquivo descreve o estado operacional do projeto e as regras que devem ser preservadas por qualquer agente de código, incluindo Claude Code, Codex ou outro agente autorizado.

## 1. Identidade do projeto

- Nome: Mappa de Salas
- Versão do pacote: 0.5.0
- Produção: https://mappa-de-salas.vercel.app/
- Vercel Project ID: `prj_0W9n3FKqLLqR6Rpjt1o6hmDt5YJD`
- Vercel Team ID: `team_fzzmJxAZ54A99LbOn6UETGXk`
- Repositório pretendido: `samuelcarvalhoxy/mappa-de-salas`

Os identificadores acima não são segredos. Nunca inclua no repositório os valores reais de variáveis de ambiente, senhas, tokens, strings de conexão ou chaves privadas.

## 2. Regra operacional principal

Este projeto já possui produção, banco e usuários reais. Trate a infraestrutura existente como estado persistente que deve ser preservado.

Salvo autorização explícita do proprietário:

1. NÃO crie outro projeto Vercel para substituir o existente.
2. NÃO crie outro Postgres para substituir o existente.
3. NÃO altere, remova, revele ou rotacione variáveis de ambiente da produção.
4. NÃO altere o alias de produção `mappa-de-salas.vercel.app`.
5. NÃO execute DROP TABLE, TRUNCATE ou limpeza em massa de dados.
6. NÃO apague usuários, reservas, histórico ou configurações para “corrigir” migrações.
7. NÃO envie `.env`, credenciais ou dumps do banco ao GitHub, logs ou respostas ao usuário.
8. NÃO desative proteções do God proprietário.
9. Antes de deploy, valide o código e confirme que o destino é o Project ID acima.

Uma alteração comum de código não exige modificar nenhuma variável já armazenada na Vercel.

## 3. Stack

- Next.js 16.1.6 com App Router
- React 19.2.3
- TypeScript
- PostgreSQL via `@neondatabase/serverless`
- `bcryptjs` para hashes de senha e respostas de segurança
- `jose` para sessão JWT em cookie HttpOnly
- `web-push` para Web Push/VAPID
- `exceljs` disponível no projeto
- `zod` para validação de payloads de autenticação
- PWA com manifest e service worker próprios

## 4. Estrutura principal
