# Mappa de Salas

Aplicação web responsiva e instalável para gestão de salas, reservas, solicitações, aprovações, agenda, histórico, estatísticas e notificações Push.

Produção: https://mappa-de-salas.vercel.app/

## Recursos principais

- Mapa em cartões ou planilha semanal, com sete dias e domingo na última coluna.
- Edição e cancelamento rápidos na planilha, exportação XLSX e cancelamento em massa por sala, pessoa, período e turno.
- Seleção de células e intervalos, Ctrl+C/X/V e movimentação de agendamentos com o mouse, com prévia e validação atômica no servidor.
- Reservas únicas, por período ou em até 30 datas alternadas, sempre com domingo indisponível.
- Validação de horários passados e suporte ao turno Extra que atravessa a meia-noite.
- Solicitações com confirmação de recebimento e estimativa baseada nos últimos 90 dias.
- Histórico, relatórios e auditoria com retenção detalhada de 90 dias.

## Desenvolvimento

### Interação com a planilha

Clique em uma célula para selecionar. Arraste pelas células ou use Shift e as setas para selecionar um intervalo. Ctrl+C copia os agendamentos; Ctrl+X prepara a movimentação, sem alterar a origem; Ctrl+V abre a prévia no destino. Os botões Copiar, Recortar e Colar oferecem as mesmas ações. O texto copiado também pode ser colado no Excel.

Arraste a reserva selecionada ou sua alça para outra sala, dia ou turno. Duplo clique ou Enter abre a célula para agendar ou editar. No celular, o toque continua abrindo a célula.

DEL ou o botão Excluir remove todas as reservas da seleção após uma única confirmação. Reservas que aparecem em mais de uma célula são contadas uma vez. A exclusão admite até 1.000 reservas atuais ou futuras, próprias ou com `booking.manage_all`, preserva o histórico e é aplicada por inteiro. ESC ou clique fora da planilha desfaz a seleção.

Ao entrar em Planilha, a lateral é recolhida e os controles superiores são condensados. Os filtros ficam acessíveis pelo botão Filtros. No computador, as linhas ajustam sua altura ao espaço da tela para exibir a semana dos turnos Manhã e Tarde.

A prévia preserva a duração e permite ajustar sala, data e horário de início. Células vazias mantêm o espaçamento da seleção, e reservas que atravessam turnos são aplicadas uma única vez. Cada operação admite até 100 reservas. Domingos, destinos passados, alterações concorrentes e sobreposições dentro da seleção impedem a aplicação completa. Reservas existentes no destino só são substituídas após confirmação explícita.

Copiar reservas exige `booking.create_all` ou `booking.create_own`; com permissão própria, as cópias são criadas em nome do usuário. Mover reservas exige `booking.manage_all` ou, para reservas próprias, `booking.create_own`. A movimentação afeta somente as ocorrências selecionadas, preserva seus IDs e mantém a vinculação a solicitações aprovadas. Operações concluídas geram auditoria e notificações.

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
