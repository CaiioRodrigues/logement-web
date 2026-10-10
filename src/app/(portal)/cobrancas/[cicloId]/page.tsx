import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApiError, api } from '@/lib/api';
import { requireAccountsAccess } from '@/lib/dal';
import { canManageCondominium, canManageFinance } from '@/lib/roles';
import { competenceLabel, date, money } from '@/lib/format';
import { STATUS_DA_COBRANCA, STATUS_DO_CICLO } from '@/lib/rotulos';
import { linkDeWhatsApp, mensagemDoBoleto } from '@/lib/whatsapp';
import { AcoesDoBoleto, PainelDoBoleto } from '@/app/(portal)/cobrancas/[cicloId]/boleto';
import { EnvioComImagem } from '@/app/(portal)/cobrancas/[cicloId]/envio';
import {
  BotaoDeEstornar,
  BotaoDeReceber,
} from '@/app/(portal)/cobrancas/[cicloId]/recebimento';
import { CabecalhoDePagina } from '@/components/cabecalho-de-pagina';
import { Alert, Badge, Card, CardHeader, EmptyState, Table, Td, Th } from '@/components/ui';

export const metadata: Metadata = { title: 'Boletos do rateio' };

/**
 * Os boletos gerados por um ciclo, um por unidade.
 *
 * É daqui que o síndico envia. O link do WhatsApp é montado no servidor, com o
 * endereço que o navegador usou para chegar até aqui — assim a página funciona
 * sem JavaScript e o endereço no link é sempre o mesmo que a pessoa vê na
 * barra, em vez de um valor de configuração que pode estar desatualizado.
 */
export default async function PaginaDosBoletosDoCiclo({
  params,
}: PageProps<'/cobrancas/[cicloId]'>) {
  const sessao = await requireAccountsAccess();

  const { cicloId } = await params;

  const [ciclo, condominio, caixa, prontidao] = await Promise.all([
    api.billing.cycle(cicloId).catch((erro) => {
      if (erro instanceof ApiError && erro.status === 404) return null;
      throw erro;
    }),
    api.condominium.get(),
    api.cash.position(),
    // A prontidao nao fala com o banco: e barata, e uma falha nela nao pode
    // derrubar a lista de envio, que funciona sem boleto bancario.
    api.boleto.readiness(cicloId).catch(() => null),
  ]);

  if (!ciclo) notFound();

  // 500 cabe qualquer prédio que este sistema atende; paginar uma lista que o
  // síndico percorre inteira para enviar só atrapalharia.
  const pagina = await api.billing.charges({ BillingCycleId: cicloId, PageSize: 500 });
  const cobrancas = pagina.items;

  const cabecalhos = await headers();
  const origem = `${cabecalhos.get('x-forwarded-proto') ?? 'http'}://${cabecalhos.get('host')}`;

  // Dar baixa move dinheiro, então é do subsíndico para cima — a mesma regra
  // de quem pode pagar despesa. Conselho fiscal enxerga, mas não movimenta.
  const podeReceber = canManageFinance(sessao.activeRole);
  const contasAtivas = caixa.accounts.filter((conta) => conta.isActive);

  const podeEmitirBoleto = canManageCondominium(sessao.activeRole);
  const bancoPronto = prontidao !== null && prontidao.settingsProblems.length === 0;
  const temBoletoVivo = cobrancas.some(
    (c) => c.slip?.state === 'Registered' || c.slip?.state === 'Pending',
  );
  const usaBoleto = bancoPronto || cobrancas.some((c) => c.slip);
  const bloqueios = new Map(prontidao?.chargeProblems.map((p) => [p.chargeId, p.reason]) ?? []);

  const situacao = STATUS_DO_CICLO[ciclo.status];
  const semTelefone = cobrancas.filter((c) => !linkDeWhatsApp(c.payerPhone, 'x')).length;

  return (
    <>
      <CabecalhoDePagina
        titulo={`Boletos de ${competenceLabel(ciclo.competence)}`}
        descricao={`Vencimento em ${date(ciclo.dueDate)} · ${money(ciclo.chargedTotal)} no total`}
      />

      <div className="mb-4 flex items-center gap-3">
        <Badge tone={situacao.tom}>{situacao.texto}</Badge>
        <Link href="/cobrancas" className="text-sm text-ink-muted hover:text-ink hover:underline">
          ← Voltar para cobranças
        </Link>
      </div>

      {prontidao && cobrancas.length > 0 && (usaBoleto || podeEmitirBoleto) ? (
        <Card className="mb-6">
          <CardHeader
            title="Boleto bancário"
            description={
              bancoPronto && prontidao.readyCharges > 0
                ? `${prontidao.readyCharges} cobrança(s) prontas para registrar no banco. Pago o boleto, a baixa entra no caixa sozinha.`
                : 'Registrado no banco: pagável em qualquer banco ou lotérica, com baixa automática no caixa.'
            }
          />
          <PainelDoBoleto
            cicloId={cicloId}
            prontidao={prontidao}
            podeEmitir={podeEmitirBoleto}
            podeAtualizar={podeReceber}
            temBoletoVivo={temBoletoVivo}
          />
        </Card>
      ) : null}

      {cobrancas.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum boleto gerado ainda"
            description="Os boletos aparecem aqui depois que o rateio é fechado."
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Envio por unidade"
            description="Abre o WhatsApp com a imagem do boleto e a mensagem prontas. Você confere e envia."
          />

          {semTelefone > 0 ? (
            <div className="px-5 pt-4">
              <Alert tone="info">
                {semTelefone === 1
                  ? '1 unidade está sem telefone no cadastro e não tem botão de WhatsApp.'
                  : `${semTelefone} unidades estão sem telefone no cadastro e não têm botão de WhatsApp.`}{' '}
                <Link href="/cadastros/pessoas" className="font-medium underline">
                  Completar cadastro
                </Link>
              </Alert>
            </div>
          ) : null}

          <Table>
            <thead>
              <tr>
                <Th>Unidade</Th>
                <Th>Morador</Th>
                <Th numeric>Valor</Th>
                <Th>Situação</Th>
                {usaBoleto ? <Th numeric>Boleto</Th> : null}
                <Th numeric>Enviar</Th>
                {podeReceber ? <Th numeric>Receber</Th> : null}
              </tr>
            </thead>
            <tbody>
              {cobrancas.map((cobranca) => {
                const estado = STATUS_DA_COBRANCA[cobranca.status];
                const linkDoBoleto = `${origem}/boleto/${cobranca.publicToken}`;

                const boletoVivo = cobranca.slip?.state === 'Registered';

                const mensagem = mensagemDoBoleto({
                  condominio: condominio.name,
                  unidade: cobranca.unitIdentifier,
                  competencia: competenceLabel(cobranca.competence),
                  vencimento: date(cobranca.dueDate),
                  valor: money(cobranca.totalWithLateCharges),
                  morador: cobranca.payerName,
                  link: linkDoBoleto,
                  linhaDigitavel: boletoVivo ? cobranca.slip?.digitableLine : null,
                });

                const whatsapp = linkDeWhatsApp(cobranca.payerPhone, mensagem);

                return (
                  <tr key={cobranca.id}>
                    <Td className="font-medium whitespace-nowrap">{cobranca.unitIdentifier}</Td>
                    <Td className="text-ink-muted">
                      {cobranca.payerName ?? <span className="text-ink-subtle">sem pagador</span>}
                    </Td>
                    <Td numeric>{money(cobranca.totalWithLateCharges)}</Td>
                    <Td>
                      <Badge tone={estado.tom}>{estado.texto}</Badge>
                    </Td>
                    {usaBoleto ? (
                      <Td numeric>
                        <AcoesDoBoleto
                          cobrancaId={cobranca.id}
                          boleto={cobranca.slip}
                          statusDaCobranca={cobranca.status}
                          bancoPronto={bancoPronto}
                          podeEmitir={podeEmitirBoleto}
                          podeAtualizar={podeReceber}
                          bloqueio={bloqueios.get(cobranca.id)}
                        />
                      </Td>
                    ) : null}
                    <Td numeric>
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                        <a
                          href={linkDoBoleto}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-ink-muted hover:text-ink hover:underline"
                        >
                          Ver boleto
                        </a>

                        {whatsapp ? (
                          <EnvioComImagem
                            urlDaImagem={`/api/cobrancas/${cobranca.id}/imagem`}
                            linkDoWhatsApp={whatsapp}
                            mensagem={mensagem}
                            nomeDoArquivo={`boleto-${cobranca.unitIdentifier.replace(/\W+/g, '-')}.png`}
                          />
                        ) : (
                          <span
                            className="text-sm text-ink-subtle"
                            title="Cadastre o telefone desta pessoa para liberar o envio"
                          >
                            sem telefone
                          </span>
                        )}
                      </div>
                    </Td>

                    {podeReceber ? (
                      <Td numeric>
                        {/* Cancelada não tem o que receber nem o que desfazer.
                            Quitada ou parcial ganha o estorno no mesmo lugar. */}
                        {cobranca.status === 'Cancelled' ? (
                          <span className="text-xs text-ink-subtle">—</span>
                        ) : boletoVivo && cobranca.status !== 'Paid' ? (
                          // Boleto vivo no banco: receber por fora deixaria um
                          // titulo pagavel para a mesma cobranca. Quem recebeu
                          // em dinheiro cancela o boleto antes.
                          <span
                            className="text-xs text-ink-muted"
                            title="Pago o boleto, a baixa entra sozinha. Se o morador pagou por fora, cancele o boleto antes de receber."
                          >
                            baixa automática
                          </span>
                        ) : cobranca.slip?.state === 'Paid' && cobranca.status === 'Paid' ? (
                          // Baixa confirmada pelo banco nao se estorna aqui: o
                          // banco continuaria dizendo que foi pago.
                          <span className="text-xs text-ink-muted">pago no banco</span>
                        ) : cobranca.status === 'Paid' ? (
                          <BotaoDeEstornar cobrancaId={cobranca.id} />
                        ) : (
                          <BotaoDeReceber
                            cobrancaId={cobranca.id}
                            valorSugerido={cobranca.totalWithLateCharges}
                            contas={contasAtivas}
                          />
                        )}
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
