'use client'
import { useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { useAcessoCirurgias } from '@/lib/acessoCirurgias'
import ProcedimentosAba from '@/components/cirurgias/ProcedimentosAba'
import EquipeAba from '@/components/cirurgias/EquipeAba'
import SituacoesAba from '@/components/cirurgias/SituacoesAba'
import ListaSimples from '@/components/cirurgias/ListaSimples'
import MensagensAba from '@/components/cirurgias/MensagensAba'
import ConveniosAba from '@/components/cirurgias/ConveniosAba'
import GoogleAgendaAba from '@/components/cirurgias/GoogleAgendaAba'
import LinkCirurgiaoAba from '@/components/cirurgias/LinkCirurgiaoAba'
import clsx from 'clsx'

// v48.01 — Cadastros da agenda de cirurgias.
//
// É a base do módulo: enquanto estas listas não existirem no CRM, o lançamento
// de uma cirurgia continuaria dependendo da planilha. A partir daqui o CRM tem
// os dados dele.

const ABAS = [
  { id: 'procedimentos', label: 'Cirurgias' },
  { id: 'equipe',        label: 'Equipe' },
  { id: 'hospitais',     label: 'Hospitais' },
  { id: 'convenios',     label: 'Convênios' },
  { id: 'situacoes',     label: 'Situações' },
  { id: 'motivoscancelamento', label: 'Motivos de cancelamento' },
  { id: 'vias',          label: 'Vias de acesso' },
  { id: 'mensagens',     label: 'Mensagens' },
  { id: 'modalidades',   label: 'Modalidades' },
  { id: 'pagamento',     label: 'Formas de pagamento' },
  { id: 'agenda',        label: 'Google Agenda' },
  { id: 'linkcirurgiao', label: 'Link do cirurgião' },
]

export default function CirurgiasSettingsPage() {
  // Esconder o item do menu não basta: quem souber o endereço entraria assim
  // mesmo. A tela também recusa.
  const veCirurgias = useAcessoCirurgias()

  const [aba, setAba] = useState('procedimentos')

  if (veCirurgias === false) {
    return (
      <div className="flex h-screen bg-surface overflow-hidden">
        <Sidebar/>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-sm">
            <p className="text-sm font-semibold text-slate-700">Agenda cirúrgica</p>
            <p className="text-xs text-slate-400 mt-1">
              Seu cargo não tem acesso a esta área. Se precisar entrar, peça a um administrador
              para liberar em Configurações → Cargos.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="bg-white border-b border-slate-100 px-6 py-4">
          <h1 className="text-lg font-semibold text-slate-800">Cirurgias</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Cadastros que alimentam a agenda cirúrgica: procedimentos, equipe, hospitais e situações
          </p>
        </div>

        <div className="bg-white border-b border-slate-100 px-6">
          <div className="flex gap-1 overflow-x-auto -mb-px">
            {ABAS.map(a => (
              <button key={a.id} onClick={() => setAba(a.id)}
                className={clsx('px-3 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors',
                  aba === a.id ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-400 hover:text-slate-600')}>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 py-6 max-w-3xl">
          {aba === 'procedimentos' && <ProcedimentosAba/>}
          {aba === 'equipe' && <EquipeAba/>}
          {aba === 'situacoes' && <SituacoesAba/>}
          {aba === 'mensagens' && <MensagensAba/>}
          {aba === 'convenios' && <ConveniosAba/>}
          {aba === 'agenda' && <GoogleAgendaAba/>}
          {aba === 'linkcirurgiao' && <LinkCirurgiaoAba/>}
          {aba === 'hospitais' && (
            <ListaSimples tabela="cirurgia_hospitais" titulo="Hospitais"
              descricao="Onde as cirurgias são realizadas" placeholder="Nome do hospital..."/>
          )}
          {aba === 'modalidades' && (
            <ListaSimples tabela="cirurgia_modalidades" titulo="Modalidades"
              descricao="Particular total, particular com convênio..."
              placeholder="Nome da modalidade..."
              campoNumerico={{
                nome: 'percentual_previa', label: 'prévia', sufixo: '%',
                dica: 'o número ao lado é quanto a prévia de reembolso fica acima do valor cobrado (0 = sem prévia)',
              }}/>
          )}
          {aba === 'vias' && (
            <ListaSimples tabela="cirurgia_vias" titulo="Vias de acesso"
              descricao="Robótica, videolaparoscopia, convencional — o que aparece na caixa de seleção do lançamento"
              placeholder="Nome da via..."/>
          )}
          {aba === 'pagamento' && (
            <ListaSimples tabela="cirurgia_formas_pagamento" titulo="Formas de pagamento"
              descricao="Como a clínica recebe pela cirurgia" placeholder="Forma de pagamento..."/>
          )}
          {aba === 'motivoscancelamento' && (
            <ListaSimples tabela="cirurgia_motivos_cancelamento" titulo="Motivos de cancelamento"
              descricao="Aparece na hora de cancelar uma cirurgia, e alimenta as estatísticas do Dashboard de Cirurgias"
              placeholder="Motivo do cancelamento..."/>
          )}
        </div>
      </div>
    </div>
  )
}
