# PousadaGestor — Arquitetura (plano gratuito Spark)

Nome provisório do produto, centralizado em `src/config/brand.ts`.

## 1. Restrição principal: Firebase plano gratuito (Spark), sem Blaze

No Spark não é possível publicar Cloud Functions, e não há Cloud Tasks nem agendador. A arquitetura foi desenhada **sem backend próprio**:

| Camada | Solução |
|---|---|
| Frontend | Next.js exportado como site estático (`output: "export"`), publicado no Firebase Hosting |
| Dados | Firestore, acessado direto do navegador |
| Login da equipe | Firebase Auth e-mail/senha (com e-mail verificado) |
| Login do hóspede | Firebase Auth anônimo + sessão ligada ao hash do QR Code |
| Autorização e validação | **Firestore Security Rules** (esta é a camada de segurança) |
| Papéis | Documento `tenants/{t}/members/{uid}` lido pelas Rules (sem custom claims, que exigem Admin SDK) |
| Operações multi-documento | Transações e lotes do Firestore no cliente |
| Chat | Tempo real nativo do Firestore |

## 2. O que as Rules garantem e o que não garantem

Garantem: isolamento entre pousadas, papéis, membro desativado ou pousada suspensa sem acesso, pagamentos e lançamentos imutáveis, idempotência de pagamento (ID do documento = chave), total do lançamento = quantidade × unitário, auditoria só de acrescentar com autoria verdadeira, QR Code revogável com efeito imediato, plano/status/limites protegidos contra edição pelo cliente.

Não garantem (limitação do plano gratuito): somas e saldos agregados (calculados no cliente), conflito de quartos fora da transação do cliente, e controle de limite de plano (ex.: máximo de quartos) além do que o painel master grava. Um funcionário autorizado que adultere o cliente consegue gravar valores incoerentes dentro do que as Rules permitem; por isso tudo fica registrado com autoria.

## 3. QR Code e acesso do hóspede

1. Check-in (transação no cliente): gera token com `crypto.getRandomValues` (32 bytes). Calcula SHA-256 do token e grava **só o hash** em `stayAccess/{hash}` e em `stays/{id}.accessHash`.
2. O QR contém `/h/?t=<tenantId>#<token>`. O `tenantId` (público) vai na consulta; o token fica no fragmento da URL, que não vai ao servidor nem a logs. Sem dados pessoais no código.
3. O portal calcula o hash, entra como anônimo e cria `stayAccess/{hash}/sessions/{uid}`. As Rules só permitem isso se o acesso estiver `active`.
4. Toda leitura do hóspede exige a sessão **e** o acesso ativo. Revogar (`status = revoked`) derruba o acesso imediatamente, inclusive para páginas abertas.
5. Novo check-in gera novo token; o antigo nunca é reativado (Rules negam `revoked` → `active`).
6. Segurança por entropia: o token tem 256 bits, então adivinhar é inviável. Rate limiting por IP não existe no plano gratuito.

## 4. Notificações de checkout (limitação documentada)

Sem servidor, **não há envio de push quando o navegador está fechado**. O MVP entrega:
- Avisos **dentro do portal** (2h e 30min antes), calculados a partir do horário de checkout atual. Alterar o checkout reagenda automaticamente.
- Avisos de **chat** pela recepção.

Alternativas gratuitas para push com navegador fechado, a decidir depois: Cloudflare Workers com Cron Trigger (plano gratuito) usando FCM, ou GitHub Actions agendado. Ambos exigem guardar uma credencial de servidor fora do navegador.

## 5. Arquivos

O projeto **não usa Cloud Storage** (exigiria Blaze). Por isso:
- Logomarca e fotos de quartos: imagens reduzidas no navegador e gravadas como texto no Firestore (limite de 1 MiB por documento; logo limitada a ~300 KB pelas Rules).
- Documentos pessoais: **não armazenar imagens** de documentos. Coletar só o necessário em texto (LGPD, minimização).
- Comprovantes e anexos: fora do MVP até haver Storage.

## 6. Modelo de dados (Firestore)

```
platformAdmins/{uid}              # criado manualmente no console
platform/plan-{planId}              # só o admin master lê e escreve
tenants/{tenantId}                # name, ownerUid, planId, status, limits
  publicInfo/main                 # dados exibidos no portal do hóspede
  settings/main
  members/{uid}                   # role, active
  invites/{email}                 # role
  roomCategories/{id}
  rooms/{roomId}                  # status, dailyRateCents, archived
  guests/{guestId}
  stays/{stayId}                  # accessHash, totais em centavos
    companions/{id}
    charges/{id}                  # nunca apagado; cancelado com justificativa
    payments/{idempotencyKey}     # imutável; estorno = novo documento 'refund'
    messages/{id}
  stayAccess/{tokenHash}          # stayId, status
    sessions/{uid}                # sessão do hóspede
    push/{uid}                    # reservado
  stayNotes/{stayId}              # observação interna (o hóspede não lê)
  cashRegisters/{id}              # abertura/fechamento do caixa
  registerLock/current            # trava: só um caixa aberto por vez
  cashEntries/{id}                # razão de caixa imutável; ID por origem (stay-, pay-, rcv-, manual-)
  revenues/{id}                   # receitas de competência (checkout-<stayId>, manual-<chave>)
  recurringExpenses/{id}
  accountsPayable/{id}
  accountsReceivable/{id}
  financialCategories/{id}
  suppliers/{id}
  summaries/{yyyy-mm}             # calculado no cliente
  cleaningTasks/{id}
  maintenanceTickets/{id}
  auditLogs/{id}                  # só criação
```

Dinheiro em centavos (inteiros). Datas em `Timestamp`, com fuso da pousada em `settings`.

## 7. Papéis

`owner`, `admin`, `reception`, `finance`, `staff`. A equipe entra por convite (`invites/{email}`): o convidado cria conta, verifica o e-mail e aceita; o papel vem do convite.

## 8. Financeiro e DRE

Regras de negócio do prompt mestre mantidas: competência e caixa, transferências fora da DRE, estornos, categorias não classificadas separadas, indicador sem dados mostra aviso, DRE gerencial e não contábil. Sem agregações no servidor, DRE e dashboard são calculados no cliente a partir dos lançamentos do período, com `summaries` como cache.

## 9. Hospedagem e custos

O site é estático (`out/`) e publicado em **Cloudflare Workers (static assets)**, com build automático a cada push na `main`. O Firebase fornece só Firestore e Auth (Spark). Cotas do Firestore no Spark: 50 mil leituras e 20 mil gravações por dia; avaliar quando houver várias pousadas. Cada avaliação de Rule que consulta papel (`get`) conta como leitura.

## 10. O que migrar para Blaze no futuro

Se uma pousada ou o SaaS crescer: Cloud Functions para check-in/checkout no servidor, custom claims, push agendado, rate limiting, Storage e App Check forte. A modelagem acima já separa essas responsabilidades.

## 11. Fases

1. Auditoria e arquitetura (este documento)
2. Firebase, login, onboarding e papéis
3. Quartos e usuários
4. Hóspedes, check-in e QR Code
5. Portal do hóspede e chat
6. Consumo e checkout
7. Financeiro, caixa e DRE
8. Limpeza, manutenção e relatórios
9. Painel master e planos
10. Segurança, testes e produção

Nenhuma fase é marcada como concluída sem testes passando.

## Regra da diária (pousada 24h)

Não há horário fixo de check-in/checkout. Cada hospedagem tem entrada em qualquer horário e a diária fecha a cada 24 horas contadas da entrada (`settings.stayHours = 24`). Os lembretes de saída (2h e 30min antes) serão calculados a partir do fim do período de 24h de cada hospedagem.

## Fases 4–10 — decisões de implementação

- **Check-in atômico:** uma transação grava hóspede, hospedagem, QR (`stayAccess/{hash}`), quarto→ocupado, acompanhantes, pagamento inicial e auditoria. As Rules exigem, no mesmo lote, quarto `available`→`occupied` com `currentStayId` igual à hospedagem e QR ativo da mesma hospedagem (evita dupla reserva em concorrência).
- **Checkout atômico:** um lote grava pagamento final (+ `cashEntries`), `revenues/checkout-<id>` (competência), título em `accountsReceivable` se houver saldo, tarefa de limpeza, revogação do QR, quarto→`awaiting_cleaning` e fechamento. As Rules só aceitam fechar a hospedagem se o QR for revogado no mesmo lote.
- **Idempotência:** IDs determinísticos (`init-<stay>`, `stay-<chave>`, `checkout-<stay>`, `clean-<stay>`, `pay-<conta>`, `rcv-<título>-<chave>`); repetir o envio vira `update` negado.
- **Razão de caixa (`cashEntries`) e receitas (`revenues`) são imutáveis.** Estorno é novo lançamento. Transferências são marcadas e ficam fora da DRE.
- **DRE:** *competência* = receitas dos fechamentos (líquidas de descontos) e despesas pela data de competência (pagas ou não); *caixa* = entradas e saídas efetivas. Há avisos para "Não classificado" e para período sem dados.
- **Portal do hóspede:** login anônimo + `stayAccess/{hash}/sessions/{uid}`. O token vai no fragmento da URL (não chega ao servidor), é movido para `sessionStorage` da aba e apagado da barra. Acesso cai em tempo real quando o QR é revogado ou a pousada suspensa.
- **Perfis na limpeza:** apenas funcionário, gerente e proprietário alteram o estado do quarto na limpeza (Rules); a recepção acompanha.
- **Painel master:** acesso por `platformAdmins/{uid}` (criado só no console). Lê e altera `tenants` (plano, status, limites) e `platform` (planos, log). Não lê dados de hóspedes nem financeiro.

## Segurança e LGPD — resumo

- Dados pessoais de hóspedes e financeiros só são legíveis por perfis autorizados (Rules). Hóspede lê somente a própria hospedagem enquanto o QR está ativo.
- Auditoria (`auditLogs`) é só de acréscimo; leitura restrita ao proprietário.
- Exportações CSV/XLSX neutralizam "injeção de fórmula" (texto iniciado por `= + - @`).
- Pendente fora do escopo do plano gratuito: limite de tentativas no servidor, backup automático, push com navegador fechado.


## 12. Integridade financeira (Fase 2)

Sem servidor, a coerência é garantida por regras que acoplam documentos no mesmo lote (`getAfter`/`existsAfter`):
- `payments/{k}` só existe com `cashEntries/stay-{k}` de mesmo valor/método e com a hospedagem ativa.
- `accountsPayable` só vai a `paid` junto de `cashEntries/pay-{id}`; `accountsReceivable` só recebe junto de `cashEntries/rcv-{id}-{chave}` (valor = diferença do recebido), em transação no cliente.
- Entrada manual (não transferência) exige `revenues/manual-{chave}` igual.
- `registerLock/current` impede dois caixas abertos; o fechamento confere `diferença = contado − esperado`.
- Limitações: teto de estorno e conferência da conta no checkout são feitos no aplicativo (coleções não entram em transações do cliente nem somam em regras).

## 13. Backup

O Spark não tem exportação agendada. Em **Relatórios → Backup completo** (dono/admin) o painel baixa um JSON com todos os dados da pousada (sem hashes de QR nem chat); guarde fora do Firebase, de preferência todo mês. A cópia de servidor (`gcloud firestore export`) exige o plano Blaze.
