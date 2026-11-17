# LGPD — como o sistema trata dados pessoais

> Texto técnico de apoio. Antes de vender, faça a revisão com um advogado e preencha CNPJ e e-mail do encarregado (DPO) em `src/config/brand.ts`.

## Papéis
- **Pousada = controladora** dos dados de hóspedes, acompanhantes e equipe.
- **Você (fornecedor do sistema) = operadora**: trata os dados só para prestar o serviço.

## O que o dono da plataforma enxerga
| Coleção | Conteúdo | Quem lê |
|---|---|---|
| `tenants/{id}` | razão social, nome fantasia, plano, situação, limite | administrador da plataforma |
| `tenantStats/{id}` | **só contagens** (quartos, equipe, hospedagens, reservas, hóspedes cadastrados), cidade/UF, data da última atividade | administrador da plataforma |
| `platform/*` | planos, anotações internas, registro das suas ações | administrador da plataforma |

Todo o resto (`guests`, `stays`, `payments`, `cashEntries`, `chat`, `photos`…) fica sob `tenants/{id}/…` e **as Rules não dão leitura ao administrador da plataforma**. Isso vale mesmo com a senha dele: não é só a tela que esconde, o banco recusa.
`tenantStats` só aceita números e cidade/UF (lista fechada de campos nas Rules), então um erro de código não consegue enviar nome, documento ou valor para lá. Isso é coberto por testes automáticos.

## Acesso do administrador da plataforma
1. A conta precisa existir em `platformAdmins/{uid}` (criado só pelo console do Firebase).
2. As Rules exigem login feito há **menos de 30 minutos** (`auth_time`). O `/master` pede a senha de novo para abrir e se bloqueia sozinho depois de 30 minutos.
3. Ações de plano, limite, suspensão e cancelamento ficam registradas em `platform/log-*` (aba Atividade).
4. Não existe "entrar como a pousada": o administrador não vê o painel dos clientes.

## Direitos do titular (art. 18) — o que a pousada faz
| Pedido | Como atender |
|---|---|
| Confirmação / acesso / portabilidade | Hóspedes → ficha do hóspede (imprimir/PDF) e **Relatórios → Backup completo** (JSON) |
| Correção | Hóspedes → Editar |
| Eliminação | Hóspedes → **Anonimizar (LGPD)**: apaga nome, documento, contatos, nascimento, contato de emergência e observações do cadastro. Sem volta. |
| Informação sobre compartilhamento | Política de Privacidade (`/privacidade/`) |

**O que a anonimização não apaga:** as hospedagens já feitas guardam o nome usado na época e os lançamentos financeiros. São registros de contrato e fiscais que a pousada precisa guardar (art. 16, I, e prazos fiscais). Acompanhantes ficam na hospedagem. Se for exigido apagar também isso, faça no console do Firebase (Firestore) caso a caso e registre o pedido.

## Encerramento de contrato (pousada pede para sair)
1. No `/master` → Pousadas → **Cancelar contrato** (bloqueia o acesso; os dados ficam intactos).
2. Avise o proprietário para baixar o **Backup completo** antes.
3. Se ele pedir a eliminação: apague no console do Firebase o documento `tenants/{id}` **e todas as subcoleções** (o console permite "Excluir documento" com subcoleções), mais `tenantStats/{id}`, `platform/note-{id}` e os documentos de `users` dessa pousada. Prazo prometido nos Termos: **30 dias**. Guarde um registro simples do pedido (data e quem pediu).
4. Contas de login (Firebase Authentication) da equipe: apague em Authentication → Usuários.

## Incidente de segurança
Se houver suspeita de vazamento: troque as senhas, revogue acessos em `platformAdmins` e `members`, e comunique a pousada controladora, que decide sobre aviso à ANPD e aos titulares (art. 48).

## Boas práticas já aplicadas
- Minimização: o fornecedor só recebe contagens.
- Isolamento entre pousadas pelas Rules (testado).
- Hóspede no portal sem cadastro, QR com validade só da hospedagem, token só no fragmento da URL e guardado como hash.
- Auditoria das operações sensíveis; ledgers financeiros imutáveis.
- Sem rastreadores de publicidade; armazenamento do navegador só essencial.
- Backup sem o hash de acesso do QR.

## Limites conhecidos
- Sem servidor (plano gratuito): não há exportação automática agendada, nem eliminação automática por prazo.
- A telemetria de uso é enviada pelo navegador do gerente da pousada; é informativa, não é prova contratual.
