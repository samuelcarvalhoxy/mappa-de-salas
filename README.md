# Mappa de Salas

Aplicação web responsiva e instalável para gestão de salas, reservas, solicitações, aprovações, agenda, histórico, estatísticas e notificações Push.

Produção: https://mappa-de-salas.vercel.app/

Para manutenção por agentes de código, leia `CLAUDE.md` antes de qualquer alteração ou deploy.

## Desenvolvimento

Requisitos: Node.js e pnpm.

```bash
pnpm install
pnpm dev
```

## Variáveis de ambiente

Copie `.env.example` para `.env` e configure apenas no ambiente local seguro ou na Vercel:

```text
DATABASE_URL
AUTH_SECRET
GOD_BOOTSTRAP_PASSWORD
GOD_NAME
GOD_USERNAME
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

Nunca envie os valores reais dessas variáveis ao GitHub. O arquivo `.env.example` mantém somente os nomes das variáveis.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm build
```

## Deploy

O deploy de produção é realizado pela Vercel. Segredos e credenciais permanecem configurados fora do repositório.
