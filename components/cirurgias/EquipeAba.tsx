'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, Trash2, Loader2, Save, X, UserRound, Stamp } from 'lucide-react'
import FolhaTimbrada, { type Margens } from './FolhaTimbrada'

// Equipe cirúrgica. Não são usuários do CRM: são as pessoas que entram na carta
// ao hospital e na distribuição de honorários. Por isso guardamos CRM/CPF e
// função, e não login e senha.

type Pessoa = {
  id: string; nome_curto: string; nome_completo: string | null; documento: string | null
  especialidade: string | null; funcao: string | null; telefone: string | null
  agenda_externa: string | null; ativo: boolean; ordem: number
  // v48.32 — o papel timbrado de quem assina as cartas
  endereco: string | null; rodape: string | null; titulo_assinatura: string | null
  cabecalho_url: string | null; carimbo_url: string | null; assinatura_url: string | null
  // v48.33 — a folha inteira como fundo, e até onde o texto pode ir nela
  papel_url: string | null
  margem_topo_mm: number; margem_base_mm: number
  margem_esquerda_mm: number; margem_direita_mm: number
}

const VAZIO: Pessoa = {
  id: '', nome_curto: '', nome_completo: '', documento: '', especialidade: '',
  funcao: 'CIRURGIÃO', telefone: '', agenda_externa: '', ativo: true, ordem: 999,
  endereco: '', rodape: '', titulo_assinatura: '',
  cabecalho_url: null, carimbo_url: null, assinatura_url: null,
  papel_url: null,
  margem_topo_mm: 45, margem_base_mm: 35, margem_esquerda_mm: 25, margem_direita_mm: 20,
}

const FUNCOES = ['CIRURGIÃO', 'AUXILIAR', 'INSTRUMENTADOR', 'ANESTESISTA', 'OUTRO']

export default function EquipeAba() {
  const [lista, setLista] = useState<Pessoa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [aberto, setAberto] = useState<Pessoa | null>(null)

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setCarregando(true)
    const { data } = await supabase.from('cirurgia_equipe').select('*').order('ordem').order('nome_curto')
    setLista((data ?? []) as Pessoa[])
    setCarregando(false)
  }

  async function excluir(p: Pessoa) {
    if (!confirm(`Excluir "${p.nome_curto}"?\n\nSe já participou de alguma cirurgia, prefira desativar.`)) return
    const { error } = await supabase.from('cirurgia_equipe').delete().eq('id', p.id)
    if (error) { alert('Não foi possível excluir: ' + error.message); return }
    carregar()
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-slate-700">Equipe cirúrgica</p>
          <p className="text-xs text-slate-400 mt-0.5">Quem entra na carta ao hospital e na divisão de honorários</p>
        </div>
        <button onClick={() => setAberto({ ...VAZIO })}
          className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold flex items-center gap-1.5 shrink-0">
          <Plus size={15}/> Adicionar
        </button>
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8"><Loader2 size={16} className="animate-spin"/> Carregando...</div>
      ) : (
        <div className="space-y-2">
          {lista.map(p => (
            <div key={p.id} className="bg-white border border-slate-100 rounded-xl px-4 py-3 flex items-start gap-3">
              <button onClick={() => setAberto(p)} className="flex-1 text-left min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-700">{p.nome_curto}</span>
                  {p.funcao && <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold">{p.funcao}</span>}
                  {!p.ativo && <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 font-semibold">inativo</span>}
                </div>
                {p.nome_completo && <p className="text-xs text-slate-500 mt-0.5">{p.nome_completo}</p>}
                {p.documento && <p className="text-xs text-slate-400 mt-0.5">{p.documento}</p>}
              </button>
              <button onClick={() => excluir(p)} className="p-1.5 text-slate-300 hover:text-red-500 shrink-0"><Trash2 size={14}/></button>
            </div>
          ))}
        </div>
      )}

      {aberto && <Editor pessoa={aberto} onFechar={() => setAberto(null)} onSalvo={() => { setAberto(null); carregar() }}/>}
    </div>
  )
}

function Editor({ pessoa, onFechar, onSalvo }: { pessoa: Pessoa; onFechar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState<Pessoa>({ ...pessoa })
  const [salvando, setSalvando] = useState(false)
  const set = (c: keyof Pessoa, v: any) => setF(a => ({ ...a, [c]: v }))

  async function salvar() {
    if (!f.nome_curto.trim()) { alert('O nome curto é obrigatório.'); return }
    setSalvando(true)
    const dados = {
      nome_curto: f.nome_curto.trim(),
      nome_completo: f.nome_completo?.trim() || null,
      documento: f.documento?.trim() || null,
      especialidade: f.especialidade?.trim() || null,
      funcao: f.funcao || null,
      telefone: f.telefone?.trim() || null,
      agenda_externa: f.agenda_externa?.trim() || null,
      endereco: f.endereco?.trim() || null,
      rodape: f.rodape?.trim() || null,
      titulo_assinatura: f.titulo_assinatura?.trim() || null,
      margem_topo_mm: Number(f.margem_topo_mm) || 0,
      margem_base_mm: Number(f.margem_base_mm) || 0,
      margem_esquerda_mm: Number(f.margem_esquerda_mm) || 0,
      margem_direita_mm: Number(f.margem_direita_mm) || 0,
      ativo: f.ativo,
      ordem: f.ordem ?? 999,
    }
    // Cadastro novo precisa do id de volta: é por ele que as imagens do papel
    // timbrado são guardadas. Por isso a tela continua aberta depois de salvar
    // pela primeira vez, em vez de fechar.
    if (f.id) {
      const { error } = await supabase.from('cirurgia_equipe').update(dados).eq('id', f.id)
      setSalvando(false)
      if (error) { alert('Não foi possível salvar: ' + error.message); return }
      onSalvo()
      return
    }

    const { data, error } = await supabase.from('cirurgia_equipe').insert(dados).select('id').single()
    setSalvando(false)
    if (error || !data) { alert('Não foi possível salvar: ' + (error?.message || '')); return }
    setF(a => ({ ...a, id: data.id }))
    alert('Cadastro criado. Agora dá para subir o cabeçalho, o carimbo e a assinatura.')
  }

  const input = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFechar}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <UserRound size={16} className="text-brand-500"/>
            <h2 className="text-sm font-semibold text-slate-800">{f.id ? 'Editar' : 'Adicionar'} integrante</h2>
          </div>
          <button onClick={onFechar} className="p-1 text-slate-400"><X size={18}/></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nome curto</label>
            <input value={f.nome_curto} onChange={e => set('nome_curto', e.target.value)} placeholder="DR. JOÃO JORGE" className={input}/>
            <p className="text-[11px] text-slate-400 mt-1">Como aparece nas listas e na agenda</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nome completo</label>
            <input value={f.nome_completo ?? ''} onChange={e => set('nome_completo', e.target.value)} placeholder="DR. JOÃO JORGE DE BARROS NETO" className={input}/>
            <p className="text-[11px] text-slate-400 mt-1">É este que sai nas cartas e guias</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">CRM ou CPF</label>
              <input value={f.documento ?? ''} onChange={e => set('documento', e.target.value)} placeholder="CRM 109958" className={input}/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Função</label>
              <select value={f.funcao ?? ''} onChange={e => set('funcao', e.target.value)} className={input}>
                {FUNCOES.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Especialidade</label>
            <input value={f.especialidade ?? ''} onChange={e => set('especialidade', e.target.value)} className={input}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">WhatsApp</label>
              <input value={f.telefone ?? ''} onChange={e => set('telefone', e.target.value)} placeholder="5511999999999" className={input}/>
              <p className="text-[11px] text-slate-400 mt-1">Usado no link de contato das mensagens</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Ordem na lista</label>
              <input type="number" value={f.ordem} onChange={e => set('ordem', Number(e.target.value))} className={input}/>
            </div>
          </div>
          {/* v48.59 — agenda do Google onde entram as cirurgias deste médico */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Agenda do Google (ID)</label>
            <input value={f.agenda_externa ?? ''} onChange={e => set('agenda_externa', e.target.value)}
              placeholder="xxxx@group.calendar.google.com" className={input}/>
            <p className="text-[11px] text-slate-400 mt-1">Google Agenda → configurações da agenda → "Integrar agenda" → ID da agenda</p>
          </div>
          {/* v48.32 — O papel das cartas.
              Na planilha, cada carta monta o cabeçalho, o carimbo e a
              assinatura a partir da aba DADOS. Trazendo isso para o cadastro,
              a carta do CRM sai com a mesma cara da que é impressa hoje — e um
              médico novo entra com o papel dele, sem mexer em desenho nenhum. */}
          <div className="border-t border-slate-100 pt-3 space-y-3">
            <div className="flex items-center gap-1.5">
              <Stamp size={14} className="text-brand-500"/>
              <p className="text-xs font-semibold text-slate-700">Papel das cartas</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Endereço do consultório</label>
              <input value={f.endereco ?? ''} onChange={e => set('endereco', e.target.value)}
                placeholder="Rua ..., nº ... — São Paulo/SP" className={input}/>
              <p className="text-[11px] text-slate-400 mt-1">Sai abaixo do nome, como na carta de hoje</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Título sob a assinatura</label>
              <input value={f.titulo_assinatura ?? ''} onChange={e => set('titulo_assinatura', e.target.value)}
                placeholder="Cirurgião do Aparelho Digestivo" className={input}/>
            </div>

            {/* v48.33 — A folha inteira, e não pedaços dela. A carta do CRM
                passa a ser a SUA folha com o texto escrito por cima, o que é o
                único jeito de sair igual ao que você imprime hoje. */}
            <FolhaTimbrada
              id={f.id}
              papelUrl={f.papel_url}
              margens={{
                margem_topo_mm: Number(f.margem_topo_mm) || 0,
                margem_base_mm: Number(f.margem_base_mm) || 0,
                margem_esquerda_mm: Number(f.margem_esquerda_mm) || 0,
                margem_direita_mm: Number(f.margem_direita_mm) || 0,
              }}
              onPapel={url => set('papel_url', url)}
              onMargem={(campo: keyof Margens, valor) => set(campo as any, valor)}/>

            {/* v48.34 — Carimbo e assinatura saíram daqui: a folha timbrada
                que você monta já vem com eles impressos. Um campo separado
                pediria a mesma coisa duas vezes — e no papel apareceria duas
                vezes também. */}

            <p className="text-[11px] text-slate-400">
              Sem folha timbrada subida, a carta sai em papel branco com o nome, o endereço e
              o CRM escritos no topo — o que serve, mas não é a sua folha.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={f.ativo} onChange={e => set('ativo', e.target.checked)} className="rounded"/>
            Disponível para novos lançamentos
          </label>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
          <button onClick={onFechar} className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600">Cancelar</button>
          <button onClick={salvar} disabled={salvando}
            className="flex-1 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {salvando ? <><Loader2 size={15} className="animate-spin"/> Salvando...</> : <><Save size={15}/> Salvar</>}
          </button>
        </div>
      </div>
    </div>
  )
}
