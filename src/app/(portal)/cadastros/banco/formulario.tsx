'use client';

import { useActionState, useState } from 'react';

import {
  salvarBanco,
  testarConexao,
  type ResultadoDoBoleto,
} from '@/lib/actions/boleto';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import type { BankAccountSummary, BoletoSettings } from '@/lib/types';

const VAZIO: ResultadoDoBoleto = {};

function Retorno({ estado }: { estado: ResultadoDoBoleto }) {
  if (!estado.erro && !estado.sucesso) return null;

  return (
    <div className="mt-3">
      <Alert tone={estado.erro ? 'negative' : 'positive'}>{estado.erro ?? estado.sucesso}</Alert>
    </div>
  );
}

/**
 * O formulário das credenciais.
 *
 * Os campos secretos chegam sempre vazios: a API não devolve o client secret
 * nem o certificado, nem para quem os cadastrou. Deixar vazio mantém o que
 * está guardado; trocar é mandar o novo.
 */
export function FormularioDoBanco({
  banco,
  contas,
}: {
  banco: BoletoSettings;
  contas: BankAccountSummary[];
}) {
  const [estado, acao, salvando] = useActionState(salvarBanco, VAZIO);
  const [comPfx, setComPfx] = useState(false);

  const guardado = 'guardado — deixe em branco para manter';

  return (
    <form action={acao} className="space-y-6" encType="multipart/form-data">
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Banco">
          <Select name="banco" defaultValue={banco.provider === 'None' ? 'Inter' : banco.provider}>
            <option value="Inter">Banco Inter</option>
          </Select>
        </Field>

        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
          <input type="checkbox" name="homologacao" defaultChecked={banco.provider === 'None' || banco.sandbox} />
          Ambiente de homologação (teste)
        </label>

        <Field label="Client id">
          <Input name="clientId" defaultValue={banco.clientId ?? ''} autoComplete="off" required />
        </Field>

        <Field label="Client secret">
          <Input
            name="clientSecret"
            type="password"
            autoComplete="new-password"
            placeholder={banco.hasClientSecret ? guardado : ''}
            required={!banco.hasClientSecret}
          />
        </Field>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold text-ink">Certificado da integração</h3>
        <p className="mb-3 text-sm text-ink-subtle">
          {banco.hasCertificate
            ? 'Já existe um certificado guardado. Envie outro só para trocar.'
            : 'O banco só aceita a conexão com o certificado e a chave da integração.'}
        </p>

        {comPfx ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Arquivo .pfx ou .p12">
              <Input name="pfx" type="file" accept=".pfx,.p12" />
            </Field>
            <Field label="Senha do arquivo">
              <Input name="senhaDoPfx" type="password" autoComplete="new-password" />
            </Field>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Certificado (.crt)">
              <Input name="certificado" type="file" accept=".crt,.pem,.cer" />
            </Field>
            <Field label="Chave (.key)">
              <Input name="chave" type="file" accept=".key,.pem" />
            </Field>
          </div>
        )}

        <button
          type="button"
          onClick={() => setComPfx((atual) => !atual)}
          className="mt-2 text-sm text-ink-muted underline hover:text-ink"
        >
          {comPfx ? 'Tenho o .crt e o .key' : 'Tenho um arquivo .pfx'}
        </button>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Conta do caixa" hint="Onde entra o dinheiro dos boletos pagos">
          <Select name="contaDoCaixa" defaultValue={banco.bankAccountId ?? ''}>
            <option value="">Escolha a conta…</option>
            {contas.map((conta) => (
              <option key={conta.id} value={conta.id}>
                {conta.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Conta corrente no banco" hint="Só se a integração enxerga mais de uma conta">
          <Input name="contaCorrente" defaultValue={banco.checkingAccount ?? ''} inputMode="numeric" />
        </Field>

        <Field label="Dias para pagar depois do vencimento" hint="Depois disso o banco dá baixa no título (0 a 60)">
          <Input
            name="diasAposVencimento"
            type="number"
            min={0}
            max={60}
            defaultValue={banco.daysOnAgenda}
          />
        </Field>
      </section>

      <Field
        label="Instruções extras no boleto"
        hint="Até 3 linhas. Competência, unidade, multa e juros já entram sozinhos."
      >
        <textarea
          name="instrucoes"
          rows={3}
          defaultValue={banco.instructions ?? ''}
          maxLength={240}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
        />
      </Field>

      <div>
        <Button type="submit" disabled={salvando || !banco.secretsKeyConfigured}>
          {salvando ? 'Gravando…' : 'Gravar'}
        </Button>
        <Retorno estado={estado} />
      </div>
    </form>
  );
}

export function TestarConexao() {
  const [estado, acao, testando] = useActionState(testarConexao, VAZIO);

  return (
    <form action={acao}>
      <Button type="submit" variant="secondary" disabled={testando} className="w-full">
        {testando ? 'Falando com o banco…' : 'Testar conexão'}
      </Button>
      <Retorno estado={estado} />
    </form>
  );
}

/**
 * Desliga o boleto bancário. Apaga as credenciais em vez de só desativar:
 * credencial de banco parada no banco de dados é risco sem utilidade.
 */
export function DesligarBoleto() {
  const [estado, acao, desligando] = useActionState(salvarBanco, VAZIO);

  return (
    <form
      action={acao}
      onSubmit={(evento) => {
        if (!window.confirm('Desligar o boleto bancário e apagar as credenciais do banco?')) {
          evento.preventDefault();
        }
      }}
    >
      <input type="hidden" name="banco" value="None" />
      <input type="hidden" name="diasAposVencimento" value="30" />
      <Button type="submit" variant="ghost" disabled={desligando} className="w-full text-negative">
        {desligando ? '…' : 'Desligar boleto e apagar credenciais'}
      </Button>
      <Retorno estado={estado} />
    </form>
  );
}
