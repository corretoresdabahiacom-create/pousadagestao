# PousadaGestor — Arquitetura (Fase 1)

Nome provisório do produto, centralizado em `src/config/brand.ts` para troca fácil.

## 1. Diagnóstico do ambiente

- Projeto novo: diretório vazio, sem repositório git, sem código anterior a preservar.
- Ferramentas: Node 22, npm 10, pnpm, git, psql. Sem Firebase CLI e sem Wrangler instalados.
- Backend escolhido pelo usuário: **Firebase** (projeto `pousadagestor-dev`).
- Pendência: a conta logada no Firebase MCP não enxerga o projeto `pousadagestor-dev`. Acesso a ser concedido pelo usuário.

## 2. Premissas e decisões

| Tema | Decisão | Justificativa |
|---|---|---|
| Banco | Firestore (modo nativo) | Tempo real nativo, Security Rules, simples de operar |
| Auth | Firebase Auth + custom claims (`tenantId`, `role`) | Autorização verificável nas Rules e nas Functions |
| Portal do hóspede | Sem login: token do QR Code trocado por sessão curta via Cloud Function | Hóspede não cria conta; revogação efetiva |
| Backend | Cloud Functions 2ª geração (TypeScript) | Operações críticas fora do navegador |
| Agendamento | Cloud Tasks (aviso a 2h e 30min do checkout) + reconciliação por Scheduler | Execução no servidor, sem depender do navegador |
| Push | FCM Web Push | Autorizado pelo hóspede; aviso interno no portal como fallback |
| Arquivos | Cloud Storage com URLs assinadas | Documentos pessoais nunca públicos |
| Frontend | Next.js + TypeScript + Tailwind + shadcn/ui | Conforme o prompt mestre |
| Hospedagem | Firebase App Hosting (alternativa: Cloudflare via OpenNext) | Mesmo ecossistema do backend |
| Plano | Blaze necessário (Cloud Tasks, Functions e Scheduler) | Cota gratuita cobre o desenvolvimento |

Limitação conhecida: Firestore não tem agregações relacionais. DRE, dashboard e relatórios usam documentos de resumo (`summaries`) mantidos por Functions, com recomputação a partir dos lançamentos.

## 3. Multi-tenant e isolamento

- Todo dado de pousada fica em `tenants/{tenantId}/...`.
- Custom claims: `{ tenantId, role }`. Usuário de uma pousada nunca lê outra: Rules comparam `request.auth.token.tenantId == tenantId`.
- Funções de permissão granular nas Rules e revalidadas nas Functions (não só ocultar botões).
- Painel master: coleção `platform/` acessível só por claim `platformAdmin`. Acesso a dados de hóspedes exige justificativa registrada em auditoria.

## 4. Modelo de dados (Firestore)

```
platform/plans/{planId}
platform/subscriptions/{tenantId}
tenants/{tenantId}                         # dados e identidade da pousada
  settings/main                            # horários, moeda, fuso, mensagens
  members/{uid}                            # papel e permissões
  roomCategories/{id}
  rooms/{roomId}                           # status, valor, capacidade, archived
  guests/{guestId}                         # dados pessoais minimizados
  stays/{stayId}                           # hospedagem, totais em centavos
    companions/{id}
    charges/{chargeId}                     # consumo; nunca apagado, só estornado
    payments/{paymentId}                   # idempotencyKey = ID do documento
    messages/{messageId}
    notifications/{id}                     # agendadas, status, tentativas, erros
  stayAccess/{tokenHash}                   # só hash; stayId, status, expiresAt
  cashRegisters/{id}/movements/{id}
  accountsPayable/{id}
  accountsReceivable/{id}
  financialCategories/{id}
  suppliers/{id}
  cleaningTasks/{id}
  maintenanceTickets/{id}
  summaries/{yyyy-mm}                      # base do dashboard e da DRE
  auditLogs/{id}                           # só escrita por Functions
  files/{id}
  reportExports/{id}
```

Dinheiro: inteiros em centavos (`amountCents`), nunca ponto flutuante. Datas: `Timestamp` em UTC, com `timezone` da pousada em `settings`.

## 5. QR Code e acesso do hóspede

1. Check-in (Function, transação): valida conflito de quarto, cria `stay`, gera token com `crypto.randomBytes(32)`, grava somente o hash SHA-256 em `stayAccess`.
2. URL do QR: `/h/{token}`. Sem dados pessoais ou financeiros no código.
3. Portal chama a Function `guestSession`, que valida hash, status da estadia e expiração, aplica limite de tentativas por IP e emite sessão curta (custom token com claim `stayId`).
4. Todas as leituras do portal passam por Rules/Functions que checam `stay.status == active` e token não revogado.
5. Checkout ou revogação manual: `stayAccess.status = revoked`, sessões invalidadas (`revokeRefreshTokens`) e o portal perde acesso mesmo com página aberta.
6. Novo check-in no mesmo quarto gera novo token; token antigo nunca reaproveitado.

## 6. Integridade financeira

- Check-in, pagamento e checkout são transações atômicas em Functions.
- Idempotência: `Idempotency-Key` do cliente vira ID do documento; repetição por falha de rede não duplica.
- Lançamentos confirmados não são apagados: estorno ou ajuste, com justificativa e auditoria.
- Contas a receber: um documento por saldo, com pagamentos parciais abatendo o saldo.
- Transferências entre caixas não entram em receita nem despesa.
- DRE: regimes de competência e caixa; categorias sem classificação aparecem separadas; indicador sem dados mostra aviso. Gerencial, não substitui escrituração contábil.

## 7. Notificações de checkout

- Ao definir ou alterar o checkout: cancela tarefas antigas e cria duas Cloud Tasks (−2h e −30min) no fuso da pousada.
- Aviso cujo horário já passou não é enviado.
- Checkout realizado: tarefas pendentes canceladas.
- Cada envio registra horário previsto, envio, canal, status, erros e tentativas.
- Provedores de WhatsApp e SMS ficam como adaptadores opcionais, sem contratação no MVP.

## 8. Segurança e LGPD

- Rules com menor privilégio; testadas no emulador.
- Nenhum segredo no frontend. As chaves `NEXT_PUBLIC_FIREBASE_*` do app web são identificadores públicos, não credenciais; a segurança está nas Rules e nas Functions.
- Firebase App Check e limite de tentativas nas Functions públicas.
- Documentos pessoais em Storage privado, acesso por URL assinada de curta duração.
- Auditoria obrigatória em operações sensíveis; retenção e anonimização documentadas.
- FNRH: dados coletados estruturados para evolução, sem presumir que o cadastro interno cumpre a obrigação legal.

## 9. Integrações futuras (adaptadores, sem simulação)

WhatsApp Business API, SMS, Stripe e PIX, Booking.com, Airbnb, Google Calendar, sistemas contábeis, emissão fiscal e sistemas oficiais de hóspedes. O que depender de credenciais externas será documentado, não inventado.

## 10. Fases

1. Auditoria e arquitetura (este documento)
2. Firebase, autenticação e multi-tenant
3. Pousadas, quartos e usuários
4. Hóspedes, check-in e QR Code
5. Portal do hóspede e chat
6. Consumo, checkout e notificações
7. Financeiro, caixa e DRE
8. Limpeza, manutenção e relatórios
9. Painel master e planos
10. Segurança, testes e produção

Nenhuma fase é marcada como concluída sem testes passando.
