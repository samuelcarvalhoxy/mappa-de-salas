# Mappa de Salas

Aplicação web responsiva e instalável para gestão de salas, reservas, solicitações, aprovações, agenda, histórico, estatísticas e notificações Push.

Produção: https://mappa-de-salas.vercel.app/

## Recursos principais

- Mapa em cartões ou planilha semanal, com sete dias e domingo na última coluna.
- Edição e cancelamento rápidos na planilha, exportação XLSX e cancelamento em massa por sala, pessoa, período e turno.
- Reservas únicas, por período ou em até 30 datas alternadas, sempre com domingo indisponível.
- Validação de horários passados e suporte ao turno Extra que atravessa a meia-noite.
- Solicitações com confirmação de recebimento e estimativa baseada nos últimos 90 dias.
- Histórico, relatórios e auditoria com retenção detalhada de 90 dias.

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
REMINDER_CRON_SECRET
```

Nunca envie os valores reais dessas variáveis ao GitHub. O arquivo `.env.example` mantém somente os nomes das variáveis.

Para os lembretes de solicitações, configure também no GitHub Actions:

```text
Repository variable: MAPPA_AUTOMATION_URL
Repository secret: REMINDER_CRON_SECRET
```

O segredo do GitHub deve ser igual ao valor configurado na Vercel. O fluxo agenda no máximo uma chamada a cada 30 minutos e não envia lembretes entre 21h00 e 07h59.

## Proteção do plano gratuito

A sincronização ocorre imediatamente depois de alterações, ao retornar para a aba e, enquanto a tela permanece visível, uma vez por minuto. A atualização periódica consulta somente reservas, solicitações, problemas e notificações. Abas ocultas não fazem consultas periódicas. A retenção automática remove detalhes operacionais concluídos depois de 90 dias e preserva totais históricos essenciais de forma agregada.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Deploy

O deploy de produção é realizado pela Vercel. Segredos e credenciais permanecem configurados fora do repositório.
