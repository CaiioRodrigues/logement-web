'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import {
  acaoDoBoleto,
  atualizarTodosOsBoletos,
  emitirBoletosDoCiclo,
  type ResultadoDoBoleto,
} from '@/lib/actions/boleto';
import { Alert, Badge, Button } from '@/components/ui';
import { STATUS_DO_BOLETO } from '@/lib/rotulos';
import type { BankSlip, BoletoReadiness, ChargeStatus } from '@/lib/types';

const VAZIO: ResultadoDoBoleto = {};

/**
 * O topo da lista: o que falta para emitir, e o botão que emite todos.
 *
 * A prontidão é conferida sem falar com o banco, então aparece antes de
 * qualquer clique — o síndico vê "3 moradores sem CPF" e resolve no cadastro,
 * em vez de descobrir unidade por unidade no meio da emissão.
 */
export function PainelDoBoleto({
  cicloId,
  prontidao,
  podeEmitir,
  podeAtualizar,
  temBoletoVivo,
}: {
  cicloId: string;
  prontidao: BoletoReadiness;
  podeEmitir: boolean;
  podeAtualizar: boolean;
  temBoletoVivo: boolean;
}) {
  const [emissao, emitir, emitindo] = useActionState(emitirBoletosDoCiclo, VAZIO);
  const [conferencia, conferir, conferindo] = useActionState(atualizarTodosOsBoletos, VAZIO);

  const semCpf = prontidao.chargeProblems.filter((p) => p.reason.includes('CPF'));
  const outros = prontidao.chargeProblems.filter(
    (p) => !p.reason.includes('CPF') && !p.reason.includes('quitada') && !p.reason.includes('já tem boleto'),
  );

  return (
    <div className="space-y-4 px-5 py-4">
      {prontidao.settingsProblems.length > 0 ? (
        <Alert tone="warning" title="Antes de emitir boleto bancário">
          <ul className="list-disc space-y-1 pl-5">
            {prontidao.settingsProblems.map((problema) => (
              <li key={problema}>{problema}</li>
            ))}
          </ul>
          {podeEmitir ? (
            <Link href="/cadastros/banco" className="mt-2 inline-block font-medium underline">
              Configurar banco e boleto
            </Link>
          ) : null}
        </Alert>
      ) : null}

      {semCpf.length > 0 ? (
        <Alert tone="info" title={`${semCpf.length} pagador(es) sem CPF válido`}>
          O banco não registra boleto sem o documento de quem paga. Estas unidades ficam de fora
          até o cadastro ser completado:
          <ul className="mt-1 list-disc pl-5">
            {semCpf.map((p) => (
              <li key={p.chargeId}>
                <strong>{p.unitIdentifier}</strong> — {p.reason}
              </li>
            ))}
          </ul>
          <Link href="/cadastros/pessoas" className="mt-2 inline-block font-medium underline">
            Completar cadastro
          </Link>
        </Alert>
      ) : null}

      {outros.length > 0 ? (
        <details className="text-sm text-ink-muted">
          <summary className="cursor-pointer">
            {outros.length} cobrança(s) não entram na emissão
          </summary>
          <ul className="mt-2 list-disc pl-5">
            {outros.map((p) => (
              <li key={p.chargeId}>
                <strong className="text-ink">{p.unitIdentifier}</strong> — {p.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {podeEmitir && prontidao.readyCharges > 0 ? (
          <form
            action={emitir}
            onSubmit={(evento) => {
              const total = prontidao.readyCharges;
              if (!window.confirm(`Registrar ${total} boleto(s) no banco? Cada um conta na tarifa do banco.`)) {
                evento.preventDefault();
              }
            }}
          >
            <input type="hidden" name="cicloId" value={cicloId} />
            <Button type="submit" disabled={emitindo || !prontidao.canIssue}>
              {emitindo
                ? 'Registrando no banco…'
                : prontidao.readyCharges === 1
                  ? 'Emitir 1 boleto bancário'
                  : `Emitir ${prontidao.readyCharges} boletos bancários`}
            </Button>
          </form>
        ) : null}

        {podeAtualizar && temBoletoVivo ? (
          <form action={conferir}>
            <Button type="submit" variant="secondary" disabled={conferindo}>
              {conferindo ? 'Conferindo…' : 'Conferir pagamentos no banco'}
            </Button>
          </form>
        ) : null}
      </div>

      <ResultadoDoLote estado={emissao} />

      {conferencia.erro || conferencia.sucesso ? (
        <Alert tone={conferencia.erro ? 'negative' : 'positive'}>
          {conferencia.erro ?? conferencia.sucesso}
        </Alert>
      ) : null}
    </div>
  );
}

function ResultadoDoLote({ estado }: { estado: ResultadoDoBoleto }) {
  if (estado.erro) {
    return (
      <Alert tone="negative" title={estado.incerto ? 'Confira no internet banking' : undefined}>
        {estado.erro}
      </Alert>
    );
  }

  const lote = estado.lote;
  if (!lote) return null;

  return (
    <div className="space-y-2">
      {estado.sucesso ? <Alert tone="positive">{estado.sucesso}</Alert> : null}

      {lote.pending > 0 ? (
        <Alert tone="info">
          {lote.pending} boleto(s) aceitos pelo banco ainda sem código de barras. Eles aparecem
          sozinhos na próxima conferência.
        </Alert>
      ) : null}

      {lote.failed.length > 0 ? (
        <Alert tone="negative" title={`${lote.failed.length} unidade(s) com erro no banco`}>
          <ul className="list-disc pl-5">
            {lote.failed.map((f) => (
              <li key={f.chargeId}>
                <strong>{f.unitIdentifier}</strong> — {f.reason}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {lote.skipped.length > 0 ? (
        <Alert tone="warning" title={`${lote.skipped.length} unidade(s) ficaram de fora`}>
          <ul className="list-disc pl-5">
            {lote.skipped.map((f) => (
              <li key={f.chargeId}>
                <strong>{f.unitIdentifier}</strong> — {f.reason}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * O boleto de uma unidade: o estado no banco e o que dá para fazer com ele.
 *
 * Um formulário só, com o nome da ação no botão, para a linha ter um estado
 * de retorno só — o erro aparece embaixo do botão que o causou.
 */
export function AcoesDoBoleto({
  cobrancaId,
  boleto,
  statusDaCobranca,
  bancoPronto,
  podeEmitir,
  podeAtualizar,
  bloqueio,
}: {
  cobrancaId: string;
  boleto: BankSlip | null | undefined;
  statusDaCobranca: ChargeStatus;
  bancoPronto: boolean;
  podeEmitir: boolean;
  podeAtualizar: boolean;
  /** Por que a prontidão deixou esta cobrança de fora, quando deixou. */
  bloqueio?: string;
}) {
  const [estado, acao, enviando] = useActionState(acaoDoBoleto, VAZIO);

  const quitadaOuCancelada = statusDaCobranca === 'Paid' || statusDaCobranca === 'Cancelled';
  const vivo = boleto && (boleto.state === 'Registered' || boleto.state === 'Pending');
  const podeEmitirAqui =
    podeEmitir && bancoPronto && !bloqueio && !quitadaOuCancelada && !vivo && boleto?.state !== 'Paid';

  // Cobrança que a prontidão já recusou não ganha botão que só daria erro:
  // mostra o motivo curto, com a frase inteira no título.
  if (!boleto && !podeEmitirAqui) {
    return bloqueio && bancoPronto && !quitadaOuCancelada ? (
      <span className="text-xs text-warning" title={bloqueio}>
        {bloqueio.includes('CPF') ? 'falta CPF válido' : 'fora da emissão'}
      </span>
    ) : (
      <span className="text-xs text-ink-subtle">—</span>
    );
  }

  const rotulo = boleto
    ? boleto.needsBankCheck
      ? { texto: 'Conferir no banco', tom: 'negative' as const }
      : STATUS_DO_BOLETO[boleto.state]
    : null;

  return (
    <form
      action={acao}
      className="flex flex-col items-end gap-1"
      onSubmit={(evento) => {
        const botao = (evento.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const pergunta = botao?.dataset.confirmar;
        if (pergunta && !window.confirm(pergunta)) evento.preventDefault();
      }}
    >
      <input type="hidden" name="cobrancaId" value={cobrancaId} />

      {rotulo ? <Badge tone={rotulo.tom}>{rotulo.texto}</Badge> : null}

      <div className="flex flex-col items-end gap-0.5 whitespace-nowrap">
        {podeEmitirAqui ? (
          <Button
            type="submit"
            name="acao"
            value="emitir"
            variant="secondary"
            disabled={enviando}
            className="px-2.5 py-1 text-xs"
          >
            {boleto ? 'Emitir de novo' : 'Emitir'}
          </Button>
        ) : null}

        {podeAtualizar && vivo && !boleto?.needsBankCheck ? (
          <Button type="submit" name="acao" value="atualizar" variant="ghost" disabled={enviando} className="px-2 py-0.5 text-xs">
            Atualizar
          </Button>
        ) : null}

        {podeEmitir && vivo && !boleto?.needsBankCheck ? (
          <Button
            type="submit"
            name="acao"
            value="cancelar"
            variant="ghost"
            disabled={enviando}
            className="px-2 py-0.5 text-xs text-negative"
            data-confirmar="Cancelar este boleto no banco? Ele deixa de ser pagável."
          >
            Cancelar
          </Button>
        ) : null}

        {podeEmitir && boleto?.needsBankCheck ? (
          <Button
            type="submit"
            name="acao"
            value="liberar"
            variant="ghost"
            disabled={enviando}
            className="px-2 py-0.5 text-xs"
            data-confirmar="Você conferiu no internet banking que não existe boleto desta unidade? Se existir, emitir de novo gera um segundo boleto pagável."
          >
            Liberar
          </Button>
        ) : null}

        {enviando ? <span className="text-xs text-ink-subtle">…</span> : null}
      </div>

      {boleto?.needsBankCheck ? (
        <span className="max-w-56 text-right text-xs text-ink-muted">
          O banco não respondeu à emissão. Confira no internet banking antes de liberar.
        </span>
      ) : null}

      {estado.erro ? (
        <span className="max-w-72 text-right text-xs text-negative" role="alert">
          {estado.erro}
        </span>
      ) : estado.sucesso ? (
        <span className="text-xs text-positive">{estado.sucesso}</span>
      ) : null}
    </form>
  );
}
