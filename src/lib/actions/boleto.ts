'use server';

import { revalidatePath } from 'next/cache';

import { ApiError, api } from '@/lib/api';
import { mensagemDeErro } from '@/lib/actions/erros';
import type { BoletoBatchResult, BoletoProvider } from '@/lib/types';

export interface ResultadoDoBoleto {
  erro?: string;
  sucesso?: string;
  /** A emissão pode ter passado: a tela pede conferência no internet banking. */
  incerto?: boolean;
  lote?: BoletoBatchResult;
}

/** Tamanho máximo dos arquivos do certificado. Um .pfx com cadeia fica bem abaixo disto. */
const LIMITE_DO_ARQUIVO = 64 * 1024;

function falha(erro: unknown): ResultadoDoBoleto {
  const incerto =
    erro instanceof ApiError &&
    (erro.problem as { outcomeUnknown?: boolean } | null)?.outcomeUnknown === true;

  return { erro: mensagemDeErro(erro), incerto };
}

/**
 * Tudo que mostra boleto precisa ver o estado novo: a lista do ciclo, a
 * cobrança do morador, o caixa (baixa automática) e o painel.
 */
function revalidarBoletos() {
  revalidatePath('/cobrancas');
  revalidatePath('/cobrancas/[cicloId]', 'page');
  revalidatePath('/minhas-cobrancas');
  revalidatePath('/caixa');
  revalidatePath('/painel');
  revalidatePath('/prestacao-de-contas');
}

function texto(dados: FormData, chave: string): string | null {
  const bruto = String(dados.get(chave) ?? '').trim();
  return bruto === '' ? null : bruto;
}

/** Arquivo enviado no formulário; nulo quando o campo veio vazio. */
function arquivo(dados: FormData, chave: string): File | null {
  const valor = dados.get(chave);
  return valor instanceof File && valor.size > 0 ? valor : null;
}

/**
 * Grava o banco do condomínio.
 *
 * Os arquivos do certificado são lidos aqui, no servidor do Next, e seguem
 * para a API dentro do JSON — nunca passam pelo navegador de novo nem ficam
 * em disco. O client secret e o certificado vazios mantêm o que já está
 * guardado: a tela nunca recebe os valores atuais para mostrar.
 */
export async function salvarBanco(
  _anterior: ResultadoDoBoleto,
  dados: FormData,
): Promise<ResultadoDoBoleto> {
  const provider = (texto(dados, 'banco') ?? 'None') as BoletoProvider;
  const dias = Number(texto(dados, 'diasAposVencimento') ?? '30');

  if (!Number.isInteger(dias) || dias < 0 || dias > 60) {
    return { erro: 'Os dias para pagamento após o vencimento vão de 0 a 60.' };
  }

  const crt = arquivo(dados, 'certificado');
  const key = arquivo(dados, 'chave');
  const pfx = arquivo(dados, 'pfx');

  for (const enviado of [crt, key, pfx]) {
    if (enviado && enviado.size > LIMITE_DO_ARQUIVO) {
      return { erro: `O arquivo ${enviado.name} é grande demais para ser um certificado.` };
    }
  }

  if ((crt && !key) || (!crt && key)) {
    return { erro: 'Envie os dois arquivos juntos: o certificado (.crt) e a chave (.key).' };
  }

  try {
    const banco = await api.boleto.updateSettings({
      provider,
      sandbox: dados.get('homologacao') !== null,
      clientId: texto(dados, 'clientId'),
      clientSecret: texto(dados, 'clientSecret'),
      certificatePem: crt ? await crt.text() : null,
      privateKeyPem: key ? await key.text() : null,
      certificatePkcs12Base64: pfx ? Buffer.from(await pfx.arrayBuffer()).toString('base64') : null,
      certificatePassword: texto(dados, 'senhaDoPfx'),
      checkingAccount: texto(dados, 'contaCorrente'),
      daysOnAgenda: dias,
      instructions: texto(dados, 'instrucoes'),
      bankAccountId: texto(dados, 'contaDoCaixa'),
    });

    revalidatePath('/cadastros/banco');
    revalidarBoletos();

    return {
      sucesso:
        banco.provider === 'None'
          ? 'Boleto bancário desligado. As credenciais do banco foram apagadas.'
          : 'Configuração do banco gravada. Use "Testar conexão" para conferir com o banco.',
    };
  } catch (erro) {
    return falha(erro);
  }
}

/** Pede um token ao banco com as credenciais guardadas, sem emitir nada. */
export async function testarConexao(
  _anterior: ResultadoDoBoleto,
  _dados: FormData,
): Promise<ResultadoDoBoleto> {
  try {
    await api.boleto.verify();
    revalidatePath('/cadastros/banco');

    return { sucesso: 'O banco aceitou as credenciais do condomínio.' };
  } catch (erro) {
    return falha(erro);
  }
}

/** Emite os boletos de todas as cobranças prontas do ciclo. */
export async function emitirBoletosDoCiclo(
  _anterior: ResultadoDoBoleto,
  dados: FormData,
): Promise<ResultadoDoBoleto> {
  const cicloId = texto(dados, 'cicloId');
  if (!cicloId) return { erro: 'Ciclo não informado.' };

  try {
    const lote = await api.boleto.issueCycle(cicloId);
    revalidarBoletos();

    const emitidos = lote.issued + lote.pending;

    return {
      lote,
      sucesso:
        emitidos === 0
          ? undefined
          : emitidos === 1
            ? '1 boleto registrado no banco.'
            : `${emitidos} boletos registrados no banco.`,
    };
  } catch (erro) {
    return falha(erro);
  }
}

/**
 * As ações de uma cobrança só. O formulário manda o nome da ação, para a
 * linha da tabela ter um só `useActionState` em vez de um por botão.
 */
export async function acaoDoBoleto(
  _anterior: ResultadoDoBoleto,
  dados: FormData,
): Promise<ResultadoDoBoleto> {
  const cobrancaId = texto(dados, 'cobrancaId');
  const acao = texto(dados, 'acao');

  if (!cobrancaId || !acao) return { erro: 'Cobrança não informada.' };

  try {
    switch (acao) {
      case 'emitir': {
        const cobranca = await api.boleto.issue(cobrancaId);
        revalidarBoletos();
        return {
          sucesso:
            cobranca.slip?.state === 'Registered'
              ? 'Boleto registrado.'
              : 'Boleto enviado ao banco; o código de barras chega em instantes.',
        };
      }

      case 'atualizar': {
        const cobranca = await api.boleto.sync(cobrancaId);
        revalidarBoletos();
        return { sucesso: cobranca.status === 'Paid' ? 'Pago: baixa lançada no caixa.' : 'Conferido com o banco.' };
      }

      case 'cancelar':
        await api.boleto.cancel(cobrancaId);
        revalidarBoletos();
        return { sucesso: 'Boleto cancelado no banco.' };

      case 'liberar':
        await api.boleto.release(cobrancaId);
        revalidarBoletos();
        return { sucesso: 'Liberado para nova emissão.' };

      default:
        return { erro: 'Ação desconhecida.' };
    }
  } catch (erro) {
    return falha(erro);
  }
}

/** Confere com o banco todos os boletos que ainda podem mudar. */
export async function atualizarTodosOsBoletos(
  _anterior: ResultadoDoBoleto,
  _dados: FormData,
): Promise<ResultadoDoBoleto> {
  try {
    const resultado = await api.boleto.syncOpen();
    revalidarBoletos();

    if (resultado.errors.length > 0) {
      return { erro: resultado.errors.join(' · ') };
    }

    return {
      sucesso:
        resultado.paymentsRegistered > 0
          ? `${resultado.checked} conferidos; ${resultado.paymentsRegistered} pagos com baixa no caixa.`
          : `${resultado.checked} boletos conferidos com o banco.`,
    };
  } catch (erro) {
    return falha(erro);
  }
}
