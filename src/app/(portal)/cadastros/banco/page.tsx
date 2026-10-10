import type { Metadata } from 'next';

import { api } from '@/lib/api';
import { requireAccountsAccess } from '@/lib/dal';
import { canManageCondominium } from '@/lib/roles';
import { date, dateTime } from '@/lib/format';
import { CabecalhoDePagina } from '@/components/cabecalho-de-pagina';
import { Alert, Badge, Card, CardHeader } from '@/components/ui';
import {
  DesligarBoleto,
  FormularioDoBanco,
  TestarConexao,
} from '@/app/(portal)/cadastros/banco/formulario';

export const metadata: Metadata = { title: 'Banco e boleto' };

/**
 * Credenciais do banco que registra os boletos do condomínio.
 *
 * Só o síndico e a administradora chegam aqui: quem tem o client secret e o
 * certificado emite boleto em nome do condomínio. A página nunca recebe esses
 * valores de volta — só se eles existem.
 */
export default async function PaginaDoBanco() {
  const sessao = await requireAccountsAccess();

  if (!canManageCondominium(sessao.activeRole)) {
    return (
      <>
        <CabecalhoDePagina titulo="Banco e boleto" />
        <Alert tone="info">Só o síndico ou a administradora configuram o banco do condomínio.</Alert>
      </>
    );
  }

  const [banco, caixa] = await Promise.all([api.boleto.settings(), api.cash.position()]);
  const contas = caixa.accounts.filter((conta) => conta.isActive);

  const situacao =
    banco.provider === 'None'
      ? { texto: 'Desligado', tom: 'neutral' as const }
      : banco.verifiedAt
        ? { texto: 'Conectado', tom: 'positive' as const }
        : { texto: 'Conexão não testada', tom: 'warning' as const };

  return (
    <>
      <CabecalhoDePagina
        titulo="Banco e boleto"
        descricao="Boleto registrado, pagável em qualquer banco, com baixa automática no caixa"
      />

      {!banco.secretsKeyConfigured ? (
        <div className="mb-6">
          <Alert tone="warning" title="O servidor ainda não pode guardar credenciais de banco">
            Falta a chave de criptografia <code>App__SecretsKey</code> na configuração da API. Quem
            administra o servidor gera uma com <code>openssl rand -base64 32</code>.
          </Alert>
        </div>
      ) : null}

      {banco.warnings.map((aviso) => (
        <div key={aviso} className="mb-4">
          <Alert tone="warning">{aviso}</Alert>
        </div>
      ))}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Credenciais do banco"
            description="O beneficiário do boleto é o CNPJ do condomínio: use a conta PJ do próprio condomínio."
          />
          <div className="px-5 py-5">
            <FormularioDoBanco banco={banco} contas={contas} />
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Situação" />
            <dl className="space-y-3 px-5 py-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-muted">Boleto bancário</dt>
                <dd>
                  <Badge tone={situacao.tom}>{situacao.texto}</Badge>
                </dd>
              </div>

              {banco.provider !== 'None' ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-muted">Ambiente</dt>
                    <dd className="text-ink">{banco.sandbox ? 'Homologação (teste)' : 'Produção'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-muted">Última conexão</dt>
                    <dd className="text-ink">{dateTime(banco.verifiedAt)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-ink-muted">Certificado</dt>
                    <dd className="text-right text-ink">
                      {banco.hasCertificate ? (
                        <>
                          vence em {date(banco.certificateExpiresAt)}
                          {banco.certificateSubject ? (
                            <span className="block text-xs break-all text-ink-subtle">
                              {banco.certificateSubject}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        'não enviado'
                      )}
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>

            {banco.isConfigured ? (
              <div className="space-y-3 border-t border-line px-5 py-4">
                <TestarConexao />
                <DesligarBoleto />
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Onde conseguir as credenciais no Inter" />
            <ol className="list-decimal space-y-2 px-5 py-4 pl-9 text-sm text-ink-muted">
              <li>Entre no Internet Banking PJ do Inter com a conta do condomínio.</li>
              <li>
                Na área de integrações por API, crie uma integração com permissão de cobrança
                (leitura e escrita de boletos).
              </li>
              <li>
                Baixe o certificado (<code>.crt</code>) e a chave (<code>.key</code>). Eles vêm
                juntos, uma vez só.
              </li>
              <li>Copie o client id e o client secret que aparecem na mesma tela.</li>
              <li>
                Comece em <strong>homologação</strong> e emita um boleto de teste antes de ligar a
                produção.
              </li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
