import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Política de Privacidade" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de Privacidade">
      <p>Esta política explica como os dados pessoais são tratados no sistema de gestão de pousadas, em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018 — LGPD).</p>
      <h2>Quem é o controlador</h2>
      <p>Cada pousada que usa o sistema é a <strong>controladora</strong> dos dados dos seus hóspedes e colaboradores. A empresa que fornece o sistema atua como <strong>operadora</strong>, tratando os dados apenas para prestar o serviço contratado.</p>
      <h2>Quais dados são tratados</h2>
      <ul>
        <li><strong>Hóspedes:</strong> nome, documento, contato, endereço, dados da estadia, consumos, pagamentos e mensagens de chat.</li>
        <li><strong>Acompanhantes:</strong> nome e documento, quando informados pela recepção.</li>
        <li><strong>Equipe:</strong> nome, e-mail e função de acesso.</li>
        <li><strong>Hóspede no portal (QR Code):</strong> não há cadastro; é criado um identificador anônimo no aparelho e guardado o código do QR somente em formato irreversível (hash).</li>
      </ul>
      <h2>Para que usamos</h2>
      <ul>
        <li>Executar a hospedagem: check-in, conta, cobrança, check-out e comprovante.</li>
        <li>Cumprir obrigações legais e fiscais.</li>
        <li>Atender o hóspede (chat, avisos de saída, informações da pousada).</li>
        <li>Segurança e prevenção a fraudes (registros de auditoria das operações sensíveis).</li>
      </ul>
      <h2>Acesso do hóspede ao portal</h2>
      <p>O QR Code vale somente para a hospedagem em curso e é revogado no check-out ou quando a recepção o cancela. Novo QR Code é gerado a cada hospedagem. Quem tiver o QR Code ativo vê a conta e as mensagens daquela hospedagem; por isso o hóspede deve guardá-lo com cuidado.</p>
      <h2>Compartilhamento</h2>
      <p>Os dados ficam em infraestrutura de nuvem do Google (Firebase) e são acessados apenas pela equipe autorizada da pousada. Não vendemos dados. Podem ser compartilhados com autoridades quando exigido por lei.</p>
      <h2>Por quanto tempo guardamos</h2>
      <p>Pelo tempo necessário para a finalidade e para cumprir prazos legais (por exemplo, registros fiscais e contábeis). Após esse prazo os dados podem ser eliminados ou anonimizados a pedido, ressalvadas as obrigações legais.</p>
      <h2>Seus direitos</h2>
      <p>O titular pode solicitar à pousada: confirmação do tratamento, acesso, correção, anonimização, portabilidade, eliminação (quando cabível), informação sobre compartilhamento e revogação de consentimento. Peça diretamente na recepção da pousada ou pelo contato do encarregado (DPO) informado pela pousada.</p>
      <h2>Segurança</h2>
      <ul>
        <li>Acesso controlado por perfis (proprietário, gerente, recepção, financeiro, funcionário), aplicado no banco de dados.</li>
        <li>Conexão criptografada (HTTPS) e registro de auditoria das operações sensíveis.</li>
        <li>Mensagens e valores do hóspede só podem ser lidos por ele (com QR ativo) e pela equipe autorizada.</li>
      </ul>
      <h2>Cookies e armazenamento local</h2>
      <p>Usamos apenas armazenamento essencial do navegador (sessão de login e preferências do portal). Não usamos rastreamento publicitário.</p>
      <h2>Contato</h2>
      <p>Dúvidas e solicitações: utilize o contato da pousada onde você se hospedou ou o e-mail do encarregado informado por ela.</p>
    </LegalPage>
  );
}
