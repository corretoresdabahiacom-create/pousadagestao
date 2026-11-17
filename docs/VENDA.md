# Operação comercial (vender para outras pousadas)

## Como o produto é vendido
- Página pública em `/` com botão **Testar grátis por 14 dias** → o cliente cria a própria conta e a própria pousada (`/login/?modo=cadastro` → `/onboarding/`).
- Não há pagamento dentro do sistema. A cobrança é combinada e recebida por você (Pix, boleto etc.). Ao receber, abra `/master` → Pousadas → **Ativar** e escolha o plano.
- Teste vencido ou pagamento atrasado: **Suspender** (os dados ficam guardados). Para contrato encerrado: **Cancelar contrato**.

## Primeira configuração (uma vez)
1. Firebase → Authentication: crie (ou use) sua conta de e-mail e senha de administrador.
2. Firestore → coleção `platformAdmins` → documento com o **UID** dessa conta (campo qualquer, ex.: `ok: true`).
3. Publique as Rules: `npx firebase deploy --only firestore:rules --project pousadagestao-2f344`.
4. Abra `/master/`, digite a senha. Crie os planos (aba Planos).
5. Em `src/config/brand.ts` preencha `salesWhatsapp` e `contactEmail`; troque o nome do produto se quiser.

## Rotina do dono
- **Visão geral:** cadastros novos, clientes ativos, paradas, funil de ativação e alertas (teste vencendo, limite de quartos, sem uso).
- **Pousadas:** busca/filtros, uso de cada uma, plano, limite, anotações do contrato, exportação CSV (só cadastro e contagens).
- **Atividade:** o que você alterou e quando.

## Capacidade do plano gratuito do Firebase
O Firestore gratuito tem cota diária (50 mil leituras e 20 mil gravações por projeto, no momento desta escrita). Muitas pousadas no mesmo projeto dividem essa cota. Acompanhe em Firebase → Uso e faturamento. Quando a cota apertar, o caminho é migrar para o plano Blaze (pago por uso) ou separar projetos. O sistema já usa consultas de contagem e a telemetria é limitada a uma vez a cada 6 horas por aparelho para gastar pouco.

## Antes de vender (checklist)
- [ ] Rules publicadas e teste ponta a ponta feito (cadastro de uma pousada de teste, reserva, check-in, caixa, backup).
- [ ] Textos de `/termos/` e `/privacidade/` revisados por advogado; CNPJ e e-mail do encarregado preenchidos.
- [ ] Domínio próprio (Cloudflare) e e-mail de suporte.
- [ ] Combinar com o cliente quem é o encarregado de dados da pousada.
- [ ] Definir preço, forma de cobrança e política de cancelamento.
