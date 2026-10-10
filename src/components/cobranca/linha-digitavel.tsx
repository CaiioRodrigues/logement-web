'use client';

import { useState } from 'react';

import { Button } from '@/components/ui';

/**
 * A linha digitável do boleto registrado, para colar no aplicativo do banco.
 *
 * Fica separada do PIX porque é outro caminho: quem paga por "pagar boleto"
 * no aplicativo, ou no caixa da lotérica, precisa destes 47 dígitos — e
 * ninguém os redigita de uma imagem sem errar um.
 */
export function LinhaDigitavel({ linha, banco }: { linha: string; banco?: string }) {
  const [copiado, setCopiado] = useState(false);
  const [falhou, setFalhou] = useState(false);

  async function copiar() {
    try {
      // Só os algarismos: alguns aplicativos recusam a linha com pontos e espaços.
      await navigator.clipboard.writeText(linha.replace(/\D/g, ''));
      setFalhou(false);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setFalhou(true);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface-muted p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Pague o boleto{banco ? ` · ${banco}` : ''}</p>
        <Button type="button" onClick={copiar} variant="secondary" className="py-1.5 text-xs">
          {copiado ? 'Copiado' : 'Copiar linha digitável'}
        </Button>
      </div>

      <p className="mt-1 text-xs text-ink-muted">
        No aplicativo do seu banco, escolha pagar boleto e cole a linha. Também vale em qualquer
        lotérica.
      </p>

      <p className="tabular mt-3 rounded-md bg-surface px-3 py-2 font-mono text-sm tracking-wide break-all text-ink">
        {linha}
      </p>

      {falhou ? (
        <p className="mt-2 text-xs text-warning">
          Seu navegador bloqueou a cópia automática. Selecione a linha acima e copie.
        </p>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {copiado ? 'Linha digitável copiada para a área de transferência.' : ''}
      </p>
    </div>
  );
}
