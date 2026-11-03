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

Feito: login, criação da pousada (onboarding), convites da equipe com papéis, quartos (cadastro, edição,
arquivamento, situação), painel inicial com dados reais, personalização (cor da marca, logo, descrição,
link do Google Maps) e galeria de fotos por categoria (pousada, quartos, refeitório, garagem…), regras de segurança testadas.

Próximo: hóspedes, check-in e QR Code; portal do hóspede e chat; consumo e checkout; financeiro e DRE.

## Limitações do plano gratuito

Sem Cloud Functions: a autorização e a validação ficam nas Security Rules; não há push com o navegador fechado;
fotos de quartos e anexos dependem de Cloud Storage (pode exigir plano Blaze). Detalhes em `docs/ARQUITETURA.md`.
