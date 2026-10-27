# Unidades do Mappa de Salas

## Regras aprovadas

- CABULA, SÃO BENTO e URUGUAI usam o mesmo aplicativo.
- O acervo atual e os acessos comuns são associados a URUGUAI. CABULA e SÃO BENTO começam sem salas, reservas, solicitações ou usuários comuns.
- As contas GOD existentes têm acesso global, sem duplicação. Cada pessoa comum vê somente as unidades às quais possui vínculo ativo.
- Uma conta, uma senha, unidade principal e vínculos com perfil independente por unidade. O primeiro lançamento não oferece concessão de acessos adicionais a não GODs; a estrutura está preparada para essa evolução.
- Cadastro preenche a unidade aberta e permite ao GOD alterar unidade e perfil. O seletor de conta existente permite transferir sem duplicar a identidade.
- Transferência e remoção local preservam reservas e histórico na origem. Pendências são sinalizadas à gestão anterior; responsabilidades são redistribuídas a gestores com análise habilitada. Na ausência de gestores elegíveis, GODs recebem a sinalização, sem nomeação implícita como responsáveis.
- Alertas das responsabilidades em outras unidades continuam ativos e identificam a unidade. O acesso global de GOD não cria responsabilidades automaticamente.

## Isolamento

`unit_id` identifica os registros operacionais, inclusive solicitações sem sala e contadores acumulados. Chaves estrangeiras compostas impedem vínculos de sala/reserva entre unidades. Perfis e turnos são locais; identidade, credenciais, equipe de desenvolvimento e chaves de push são globais.

`withUnitRequest` valida sessão e vínculos antes de escolher a unidade solicitada. O contexto usa AsyncLocalStorage, nunca variáveis globais ou um cookie compartilhado de unidade ativa. Cada aba identifica sua unidade no endereço e envia `x-mappa-unit`.

Consultas operacionais usam `sql()`. O transporte agrupa `SET LOCAL ROLE mappa_runtime`, contexto de usuário/unidade e as consultas na mesma transação HTTP Neon. O papel não possui BYPASSRLS. Políticas do Postgres revalidam vínculo ativo e isolam a leitura/gravação. Os lotes preservam a mesma proteção.

`rawSql()` fica reservado a inicialização, identidade/autenticação, chaves globais, metadados autorizados de GOD e ao handler transacional de contas. Alterações de contas têm validação de autorização, propriedade GOD e versão do cadastro. Não usar esse caminho em operações de reservas, salas ou relatórios.

Caches offline guardam somente resumos de pendências, com usuário e unidade identificados. Trocar de unidade exige conexão, descarta formulários e seleções e invalida respostas antigas. Retirada de acesso é aplicada nas próximas consultas; dados offline são a última confirmação, sem operações administrativas.

## Migração e recuperação

`lib/unit-schema.ts` contém a migração transacional `units_v1_20261027`, protegida por trava e marcador. Ela cria um snapshot das tabelas anteriores em `<schema>_units_backup_20261027`, com acesso restrito ao proprietário do banco. O aplicativo não expõe credenciais nem esse snapshot. Totais de usuários, salas, reservas e solicitações são comparados antes de confirmar a migração.

O marcador evita repetir o inicializador legado após a atualização. Novas alterações de esquema devem ser migrações explícitas e incrementais. Nunca executar o inicializador legado manualmente sobre o esquema atualizado.

Não reverter a aplicação para uma versão anterior ao suporte a unidades sobre o banco atualizado: versões antigas não validam esse contexto. Em incidente, aplicar uma correção compatível; uma restauração do snapshot exige revisão administrativa das alterações posteriores à migração.

Preview usa `mappa_preview`, separado de produção. Validar a inicialização real no preview antes da publicação em produção. O cron continua único e percorre as unidades, com expiração, notificações e retenção locais.

## Validação

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

A suíte usa o DDL legado real e PGlite para testar migração, snapshot, isolamento por RLS, chaves entre unidades, pedidos sem sala, agregados e transferências. O transporte Neon é exercitado com seu protocolo real ligado ao banco de teste. O handler de contas é testado com o mesmo transporte, sem enviar notificações externas.
