'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FileText, Loader2, Send, X, AlertCircle, CheckCircle2 } from 'lucide-react'

// v48.122 — Atalho para emitir a "Suspensão de medicamentos" direto da aba
// Medicações, sem precisar descer até Emissão de documentos.
//
// Não é um motor de PDF novo: chama o MESMO endpoint que DocumentosCirurgia.tsx
// usa para esse tipo de carta (/api/cirurgias/[id]/documento, tipo=
// suspensao_medicamentos) — mesma folha timbrada, mesma trava de "só gera com
// tudo completo", mesmo registro em cirurgia_documentos. Só a tela é menor: em
// vez do seletor de tipo e da lista de materiais (que não fazem sentido aqui),
// é só título, texto para conferir e o botão de gerar/enviar.
export default function SuspensaoMedicamentosAtalho({ cirurgiaId, temMedicamentos, onFechar }: {
  cirurgiaId: string; temMedicamentos: boolean
  // v48.122 — Gerar aqui aprova (trava) as linhas na aba Medicações e liga o
  // lembrete de véspera de cada uma — quem chama usa isto para recarregar a
  // lista e os tiques de lembrete ao fechar o atalho, sem precisar reabrir a
  // tela inteira.
  onFechar?: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [temPaciente, setTemPaciente] = useState(false)
  const [medicamentosPendentes, setMedicamentosPendentes] = useState(0)
  const [medicamentosVazio, setMedicamentosVazio] = useState(false)
  const [gerado, setGerado] = useState<{ id: string; url: string; nome_arquivo: string; enviado_em: string | null } | null>(null)
  const [mensagem, setMensagem] = useState('Segue a orientação sobre os medicamentos a suspender antes da sua cirurgia, e quando.')

  async function chamar(metodo: 'GET' | 'POST', corpo?: any, busca = '') {
    let { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      const { data } = await supabase.auth.refreshSession()
      session = data.session
    }
    const r = await fetch(`/api/cirurgias/${cirurgiaId}/documento${busca}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${session?.access_token || ''}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
    return j
  }

  async function abrir() {
    setOcupado('abrir'); setErro(''); setAviso(''); setGerado(null)
    try {
      const j = await chamar('GET', undefined, '?tipo=suspensao_medicamentos')
      setTitulo(j.titulo); setTexto(j.texto); setTemPaciente(!!j.temPaciente)
      setMedicamentosPendentes(Number(j.medicamentosPendentes) || 0)
      setMedicamentosVazio(!!j.medicamentosVazio)
      // Já existe um gerado antes? Mostra o mais recente para dar para reenviar
      // sem precisar ir até Emissão de documentos.
      const ultimo = (j.anteriores || [])[0]
      if (ultimo) setGerado({ id: ultimo.id, url: ultimo.url, nome_arquivo: ultimo.nome_arquivo, enviado_em: ultimo.enviado_em })
      setAberto(true)
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  async function gerar() {
    setOcupado('gerar'); setErro('')
    try {
      const j = await chamar('POST', { acao: 'gerar', tipo: 'suspensao_medicamentos', titulo, texto })
      setGerado(j.documento); setAviso('PDF pronto.')
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  async function enviar() {
    if (!gerado) return
    if (!window.confirm('Enviar a suspensão de medicamentos ao paciente pelo WhatsApp?')) return
    setOcupado('enviar'); setErro('')
    try {
      await chamar('POST', { acao: 'enviar', id: gerado.id, mensagem })
      setAviso('Enviado ao paciente.')
      setGerado(g => g ? { ...g, enviado_em: new Date().toISOString() } : g)
    } catch (e: any) { setErro(e.message) }
    setOcupado('')
  }

  const campo = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <>
      <button onClick={abrir} disabled={!!ocupado || !temMedicamentos}
        title={!temMedicamentos ? 'Cadastre ao menos um medicamento primeiro' : 'Gerar/enviar a orientação de suspensão sem sair desta aba'}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-brand-300 text-brand-700 text-xs font-semibold disabled:opacity-50">
        {ocupado === 'abrir' ? <Loader2 size={13} className="animate-spin"/> : <FileText size={13}/>}
        Emitir documento de suspensão (PDF)
      </button>
      {erro && !aberto && <p className="text-[11px] text-red-600 mt-1">{erro}</p>}

      {aberto && (
        <div className="fixed inset-0 z-[60] bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-800">{titulo || 'Suspensão de medicamentos'}</p>
              <button onClick={() => { setAberto(false); onFechar?.() }} className="p-1 text-slate-400"><X size={16}/></button>
            </div>

            <div className="px-5 py-4 space-y-3 overflow-y-auto">
              {(medicamentosVazio || medicamentosPendentes > 0) && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex items-start gap-1.5">
                  <AlertCircle size={13} className="mt-0.5 shrink-0"/>
                  {medicamentosVazio
                    ? 'Nenhuma medicação cadastrada ainda.'
                    : `${medicamentosPendentes} medicação(ões) sem prazo ou orientação definidos. Complete acima antes de gerar.`}
                </p>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Texto — confira antes de gerar</label>
                <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={14}
                  className={campo + ' leading-5 font-mono text-[12px]'}/>
                <p className="text-[11px] text-slate-400 mt-1">O PDF sai na mesma folha timbrada dos demais documentos da cirurgia.</p>
              </div>

              {gerado && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5 space-y-2">
                  <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 size={13}/> {gerado.nome_arquivo}
                  </p>
                  <a href={gerado.url} target="_blank" rel="noopener noreferrer"
                    className="inline-block text-xs font-semibold text-emerald-700 underline">abrir o PDF</a>
                  {!gerado.enviado_em ? (
                    <div className="space-y-2 pt-1">
                      <textarea value={mensagem} onChange={e => setMensagem(e.target.value)} rows={2}
                        placeholder="Mensagem que vai antes do arquivo (deixe vazio para mandar só o PDF)"
                        className={campo + ' text-xs'}/>
                      <button onClick={enviar} disabled={!!ocupado || !temPaciente}
                        title={!temPaciente ? 'Cirurgia sem paciente vinculado ao CRM' : ''}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">
                        {ocupado === 'enviar' ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>} Enviar ao paciente
                      </button>
                      {!temPaciente && (
                        <p className="text-[11px] text-amber-700">Vincule o paciente a um contato do CRM para poder enviar.</p>
                      )}
                    </div>
                  ) : <p className="text-[11px] text-emerald-700">Enviado ao paciente.</p>}
                </div>
              )}

              {erro && <p className="text-xs text-red-600 flex items-start gap-1"><AlertCircle size={13} className="mt-0.5"/>{erro}</p>}
              {aviso && !erro && <p className="text-xs text-emerald-700">{aviso}</p>}
            </div>

            <div className="px-5 py-3 border-t border-slate-100">
              <button onClick={gerar}
                disabled={!!ocupado || !texto.trim() || medicamentosVazio || medicamentosPendentes > 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-500 text-white text-sm font-semibold disabled:opacity-50">
                {ocupado === 'gerar' ? <Loader2 size={15} className="animate-spin"/> : <FileText size={15}/>}
                {gerado ? 'Gerar de novo' : 'Gerar PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
