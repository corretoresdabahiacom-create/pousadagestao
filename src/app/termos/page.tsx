import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Termos de Uso" };

export default function TermsPage() {
  return (
    <LegalPage title="Termos de Uso">
      <p>Ao criar uma conta ou usar o sistema de gestão de pousadas, você concorda com os termos abaixo.</p>
      <h2>O serviço</h2>
      <p>Plataforma online para gestão de pousadas: quartos, hóspedes, check-in e check-out, conta do hóspede, financeiro, limpeza, manutenção, relatórios e portal do hóspede por QR Code.</p>
      <h2>Conta e responsabilidades da pousada</h2>
      <ul>
        <li>O proprietário responde pelas contas criadas para sua equipe e pelas permissões concedidas.</li>
        <li>A pousada é responsável pela veracidade dos dados lançados e por obter dos hóspedes as autorizações exigidas por lei.</li>
        <li>As senhas são pessoais; não compartilhe credenciais.</li>
      </ul>
      <h2>Responsabilidades do hóspede</h2>
      <p>O QR Code é pessoal e vale apenas para a hospedagem em curso. Não o compartilhe. A confirmação de pagamentos é feita pela recepção da pousada; o portal apenas exibe os lançamentos.</p>
      <h2>Limites do serviço</h2>
      <ul>
        <li>Relatórios financeiros e a DRE são ferramentas de gestão e não substituem a contabilidade oficial.</li>
        <li>Os avisos de checkout aparecem no portal enquanto a página está aberta; não há envio de notificação com o navegador fechado.</li>
        <li>O sistema não emite nota fiscal nem processa pagamentos online.</li>
      </ul>
      <h2>Planos, suspensão e cancelamento</h2>
      <p>O uso pode ter limites por plano (por exemplo, número de quartos). A conta pode ser suspensa por inadimplência ou uso indevido; os dados são mantidos pelo prazo informado ao proprietário para exportação.</p>
      <h2>Disponibilidade</h2>
      <p>Buscamos manter o serviço disponível, mas ele depende de provedores externos e pode sofrer interrupções. Recomenda-se exportar relatórios periodicamente.</p>
      <h2>Privacidade</h2>
      <p>O tratamento de dados pessoais segue a <a className="text-brand-700 underline" href="/privacidade/">Política de Privacidade</a>.</p>
      <h2>Alterações e foro</h2>
      <p>Os termos podem ser atualizados, com aviso no sistema. Fica eleito o foro do domicílio do contratante para dirimir dúvidas, salvo disposição legal em contrário.</p>
    </LegalPage>
  );
}
