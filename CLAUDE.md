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

- `app/page.tsx`: entrada da aplicação.
- `app/layout.tsx`: layout global.
- `app/globals.css`: tema e interface responsiva.
- `components/app-shell.tsx`: grande parte da interface, navegação, modais, agenda, reservas, solicitações e notificações.
- `app/api/auth/route.ts`: login, primeiro acesso, perguntas de segurança e recuperação de senha.
- `app/api/action/route.ts`: mutações de salas, solicitações, reservas, usuários, perfis e problemas.
- `app/api/state/route.ts`: estado principal da aplicação.
- `app/api/agenda/route.ts`: consultas de agenda.
- `app/api/stats/route.ts`: estatísticas de utilização.
- `app/api/push/route.ts`: registro, remoção e teste da assinatura Push.
- `lib/db.ts`: conexão, criação/migração compatível do schema e bootstrap de perfis/God.
- `lib/auth.ts`: sessão JWT e cookie temporário do primeiro acesso.
- `lib/push.ts`: entrega Web Push e limpeza de assinaturas expiradas.
- `lib/settings.ts`: configurações persistidas e proteção da chave VAPID privada.
- `lib/security-options.ts`: listas predefinidas das respostas de segurança.
- `lib/types.ts`: tipos e catálogo de permissões.
- `lib/csv.ts`: UTF-8 com BOM para exportações CSV.
- `public/sw.js`: service worker e exibição das notificações Push.
- `app/manifest.ts`: configuração PWA instalável.

## 5. Variáveis de ambiente

O arquivo `.env.example` contém somente os nomes. Os valores reais devem continuar fora do código:

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

`AUTH_SECRET` precisa ter pelo menos 32 caracteres para autenticação.

Não presuma que as variáveis VAPID existam diretamente na Vercel. `getPushConfiguration()` aceita um par VAPID completo vindo do ambiente; caso contrário, utiliza a configuração persistida em `app_settings`. Se não houver par consistente, o sistema gera um novo par e guarda a chave privada cifrada com AES-256-GCM derivado de `AUTH_SECRET`.

Não rotacione VAPID ou `AUTH_SECRET` como parte de manutenção comum. Isso pode invalidar assinaturas Push ou dados cifrados existentes.

## 6. Banco de dados

O schema é inicializado de forma idempotente por `lib/db.ts`. Tabelas atuais:

- `roles`
- `users`
- `rooms`
- `reservations`
- `booking_requests`
- `shifts`
- `audit_log`
- `room_issues`
- `push_subscriptions`
- `app_settings`

Ao adicionar schema, prefira migrações retrocompatíveis, como `CREATE TABLE IF NOT EXISTS` e `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` quando apropriado. Nunca transforme uma correção de código em migração destrutiva sem autorização explícita.

## 7. Autenticação e segurança

- Senhas são armazenadas como hash bcrypt.
- Respostas de segurança também são armazenadas como hash bcrypt.
- A sessão normal usa JWT HS256 em cookie `mappa_session`, HttpOnly, SameSite Lax e Secure em produção, com duração de 12 horas.
- O fluxo de definição das respostas no primeiro acesso usa cookie separado de curta duração.
- Após tentativas de login inválidas, há contador e bloqueio temporário. A implementação atual bloqueia por 15 minutos ao atingir 5 tentativas.
- Usuário sem respostas de segurança suficientes é enviado ao fluxo obrigatório de configuração antes do acesso normal.
- As três respostas usam opções predefinidas para estação do ano, animal e cor.
- Qualquer proteção visual no frontend é apenas UX. Autorizações críticas devem continuar validadas no backend.

## 8. Perfis e permissões

Permissões reconhecidas:

```text
booking.create_own
booking.create_all
booking.manage_all
booking.request
booking.review
room.manage
user.manage
user.delete
security.reset
role.manage
audit.view
stats.view
```

Perfis base: `God`, `Gestão`, `ADM` e `Usuário`.

Regras críticas de hierarquia:

1. Somente God pode criar ou promover outro usuário a God.
2. Um não God nunca pode alterar um usuário God, mesmo que manipule o HTML no navegador.
3. O usuário marcado como `is_owner_god=true` é o God proprietário original e recebe proteção adicional no backend.
4. O God proprietário não pode ser excluído.
5. Outro usuário não pode alterar o God proprietário.
6. O God proprietário permanece ativo, God e com seu perfil protegido por regras do servidor.
7. O perfil de sistema `God` não pode ser editado nem excluído.
8. Somente God pode excluir perfis.
9. Um perfil com usuários atribuídos precisa ter esses usuários realocados antes da exclusão.
10. Exclusão de usuário é lógica, usando `deleted_at`, preservando referências e histórico.

Nunca confie em `disabled`, controles escondidos ou validação exclusivamente no React para essas regras.

## 9. Reservas e solicitações

Modelo atual simplificado:

- Reserva possui status `reserved` ou `cancelled`.
- Não existe fluxo operacional de “ocupar agora”, “em uso” ou No Show.
- A sala aparece como reservada conforme o intervalo temporal da reserva.
- Reservas podem ser únicas ou fazer parte de uma série por `series_id`.
- Períodos aceitam no máximo 30 dias.
- O editor permite alterar uma reserva individual ou a parte atual/futura de todo o período.
- Reserva mais recente substitui reservas anteriores conflitantes da mesma sala e intervalo, cancelando as anteriores de forma auditável.
- Não restaure a lógica antiga de bloqueio absoluto de conflitos sem solicitação do proprietário.

Usuário básico trabalha principalmente por solicitação:

- Pode solicitar sala específica ou qualquer sala.
- Pode solicitar mesmo quando a sala já aparece reservada; quem analisa decide.
- Usuários com `booking.review` recebem a solicitação e podem editar, aprovar ou rejeitar.
- Aprovação cria a reserva e pode substituir conflito anterior conforme a regra da reserva mais recente.
- Aprovação e rejeição podem registrar comentário.
- Solicitações e reservas canceladas preservam histórico.

## 10. Salas, agenda e infraestrutura

- Salas podem ser físicas, virtuais ou outras localidades.
- Cadastro inclui capacidade, recursos, rede, cadeiras, mesas e quantidade de estações/computadores.
- Problemas de sala podem ser reportados e marcados como resolvidos.
- A agenda suporta passado, presente e futuro, intervalos de datas e filtros.
- O Mapa de Salas possui navegação própria por data, com calendário, dia anterior, dia seguinte e atalho para hoje. Para datas diferentes de hoje, o mapa usa o início do expediente como referência visual e consulta `/api/agenda` para carregar exatamente o dia selecionado.
- A interface possui visão da vida da sala e linha do tempo baseada em disponibilidade e reservas.
- Turnos iniciais: Manhã 08:00–14:20, Tarde 14:40–21:00, Diurno 08:00–17:00 e Dia todo 08:00–21:00.
- Exportação CSV utiliza UTF-8 com BOM para preservar caracteres portugueses no Excel.
- Estatísticas são protegidas por `stats.view`.

## 11. Web Push

Fluxo atual:

1. O navegador registra `/sw.js`.
2. O usuário concede permissão de notificação.
3. A assinatura Push do dispositivo é persistida em `push_subscriptions`.
4. Ao abrir o app com permissão já concedida, o cliente reconcilia a assinatura e a chave VAPID.
5. Existe teste real de Push pela API.
6. Assinaturas que retornam 404 ou 410 são removidas automaticamente.

Eventos importantes:

- Nova solicitação envia Push para usuários com `booking.review`.
- Aprovação ou rejeição envia Push ao solicitante.
- Reserva ou edição mais recente pode avisar usuários cuja reserva anterior foi substituída.
- Cancelamento pode alertar solicitantes que aceitaram qualquer sala.

Ao diagnosticar Push, verificar navegador, service worker, `push_subscriptions`, consistência VAPID e logs do servidor. Não gerar novas chaves VAPID como primeira tentativa de correção.

## 12. PWA

A aplicação é instalável como PWA. Preserve:

- `app/manifest.ts`
- `public/sw.js`
- ícones em `public/`
- comportamento responsivo para computador e celular

Teste alterações de service worker levando em conta cache e atualização de workers já instalados.

## 13. Comandos de validação

Antes de qualquer deploy:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
```

Não faça deploy se TypeScript, lint ou build falharem por causa da alteração.

Depois de deploy, valide pelo menos:

1. Página inicial carrega.
2. `/api/state` responde sem erro.
3. `/api/agenda` responde sem erro.
4. Login e autorização continuam funcionando.
5. Fluxo alterado funciona de ponta a ponta.
6. Logs de runtime não apresentam erro novo.

Nunca imprima valores secretos durante a verificação.

## 14. Deploy seguro na Vercel

Destino obrigatório para manutenção normal:

```text
Project: prj_0W9n3FKqLLqR6Rpjt1o6hmDt5YJD
Team: team_fzzmJxAZ54A99LbOn6UETGXk
Production URL: https://mappa-de-salas.vercel.app/
```

Procedimento:

1. Confirme o projeto e o Team antes de publicar.
2. Faça alteração mínima necessária.
3. Execute typecheck, lint e build.
4. Não execute comandos de criação de novo projeto ou banco.
5. Não use comandos de `env add`, `env rm` ou equivalentes sem autorização específica.
6. Faça deploy no projeto existente.
7. Verifique produção e logs.
8. Em caso de falha, corrija o código ou faça rollback seguro; não “resolva” removendo dados ou segredos.

## 15. GitHub

Repositório desejado:

`https://github.com/samuelcarvalhoxy/mappa-de-salas`

No momento da criação deste handoff, o conector GitHub utilizado pelo agente original conseguia ler o repositório, mas a operação de escrita em Contents retornava `403 Resource not accessible by integration`. Isso é uma limitação de integração, não um erro do aplicativo Mappa de Salas.

Quando o GitHub estiver funcional como origem:

1. Faça dele a fonte de verdade do código.
2. Preserve `.gitignore`.
3. Nunca commite `.env` ou segredos.
4. Use commits claros e alterações revisáveis.
5. Mantenha Vercel vinculada ao projeto correto.

## 16. Funcionalidades que devem ser consideradas existentes

- Cadastro e gestão de salas físicas, virtuais e outras localidades.
- Recursos e problemas de infraestrutura.
- Usuários, perfis e permissões configuráveis.
- Proteção especial do God proprietário.
- Respostas de segurança predefinidas e recuperação de acesso.
- Solicitações de sala com aprovação e rejeição.
- Reservas únicas e por período de até 30 dias.
- Edição de reserva única e do período.
- Regra de substituição por reserva mais recente.
- Agenda com filtros e histórico temporal.
- Linha do tempo e status de disponibilidade/reserva.
- Estatísticas de uso protegidas por permissão.
- Exportação compatível com UTF-8/BOM.
- Web Push para solicitações, respostas e eventos relevantes.
- PWA instalável.
- Auditoria das operações administrativas relevantes.

## 17. Protocolo para um novo agente de IA

Antes de editar:

1. Leia este `CLAUDE.md` por inteiro.
2. Leia `README.md`, `package.json`, `lib/types.ts`, `lib/db.ts` e os arquivos diretamente afetados pela tarefa.
3. Considere o Postgres e a Vercel atuais como produção real com dados que devem sobreviver à manutenção.
4. Nunca solicite que o usuário cole segredos em chat. Prefira integrações autorizadas ou variáveis já configuradas no ambiente.
5. Se uma tarefa exigir mudar infraestrutura, banco, segredos, permissões do God proprietário ou destruir dados, pare e peça autorização específica.
6. Para correções comuns, altere somente o código necessário e reutilize a infraestrutura existente.
7. Valide tecnicamente antes de publicar e valide produção depois.

O objetivo é permitir evolução contínua do Mappa de Salas sem recriar a aplicação, perder dados, expor credenciais ou reduzir as proteções já implementadas.
