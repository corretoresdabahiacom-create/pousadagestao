# PousadaGestor

Sistema de gestão de pousadas (SaaS multi-pousada) em Next.js + Firebase, no **plano gratuito (Spark)**.
O nome do produto é provisório e fica em `src/config/brand.ts`.

Arquitetura e decisões: `docs/ARQUITETURA.md`.

## Rodar localmente

Requisitos: Node.js LTS e Java 21+ (só para os testes das regras).

```bash
npm install --legacy-peer-deps
cp .env.example .env.local   # preencha com a configuração do app web do Firebase
npm run dev                  # http://localhost:3000
```

Com `NEXT_PUBLIC_USE_EMULATORS=false` o app usa o projeto Firebase real.

## Testes das regras de segurança

```bash
npm run test:rules
```

Sobe o emulador do Firestore e roda `tests/rules`. Rode sempre antes de publicar regras.

## Publicar

```bash
npx firebase login
npx firebase deploy --only firestore:rules --project pousadagestao-2f344   # regras
npm run build                                                              # gera a pasta out/
npx firebase deploy --only hosting --project pousadagestao-2f344           # site
```

## Estado atual

Implementado (todas as fases do plano original):

- **Pousada:** onboarding, equipe com papéis (proprietário, gerente, recepção, financeiro, funcionário), quartos,
  personalização (cor, logo, descrição, Google Maps, mensagem de checkout, como pagar) e galeria de fotos.
- **Hospedagem:** cadastro de hóspedes, check-in (diária de 24 h, acompanhantes, pagamento inicial), QR Code por hospedagem
  (só o hash é guardado; revogado no checkout; novo a cada hospedagem), conta com lançamentos/pagamentos/estornos,
  prorrogação, chat, checkout e comprovante.
- **Portal do hóspede** (`/h/?t=<pousada>#<token>`): conta, pagamentos, fotos, informações úteis, chat e avisos de
  checkout 2 h e 30 min antes (com a página aberta).
- **Financeiro:** caixa (abertura/fechamento com conferência), entradas/saídas manuais, contas a pagar (categorias,
  parcelas, recorrentes), contas a receber (recebimento parcial) e DRE por competência e por caixa.
- **Operação:** limpeza (tarefa criada no checkout), manutenção (prioridade, bloqueio do quarto, custo → conta a pagar),
  calendário de ocupação, painel inicial com indicadores reais e relatórios em CSV, XLSX e PDF (imprimir).
- **Plataforma:** painel master (`/master/`) com pousadas, planos, limite de quartos e suspensão.
- **LGPD:** páginas de Privacidade e Termos (texto-base — revisar com advogado).

## Primeiro uso após publicar

1. Publique as regras: `npx firebase deploy --only firestore:rules --project pousadagestao-2f344`.
2. No console do Firebase → Authentication → Sign-in method: ative **E-mail/senha** e **Anônimo** (o hóspede usa o anônimo).
3. Authentication → Settings → Authorized domains: inclua o domínio do site (ex.: `pousadagestao.<conta>.workers.dev`).
4. Para usar o painel master: no Firestore crie o documento `platformAdmins/<UID do seu usuário>` (qualquer campo). O UID está em Authentication → Users.
5. Cloudflare (Build variables): todas as `NEXT_PUBLIC_FIREBASE_*` do `.env.example`.

## Backup e recuperação

O plano gratuito não tem backup automático. Exporte os relatórios (XLSX/CSV) periodicamente. Para um backup completo,
use no console do Firebase a exportação do Firestore (exige Blaze) ou migre para Blaze quando o volume justificar.

## Limitações do plano gratuito

- Sem Cloud Functions: a autorização e a validação ficam nas Security Rules; **não há limite de tentativas no servidor**,
  não há push com o navegador fechado (avisos de checkout só com o portal aberto) e não há tarefas agendadas.
- Sem Cloud Storage: fotos são comprimidas e guardadas no Firestore (limite ~240 mil caracteres por foto).
- Cotas diárias do Spark: 50 mil leituras, 20 mil gravações, 1 GiB. Pousadas grandes podem exceder.
- DRE, totais e indicadores são calculados no navegador a partir dos lançamentos do período.
- O limite de quartos por plano é aplicado pelo painel (controle comercial), não é barreira de segurança.
- O campo "Observações da hospedagem" é legível pelo hóspede no portal.
- As regras e os testes de regras novos devem ser executados no seu computador (`npm run test:rules`, exige Java).
