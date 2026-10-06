'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Toast, { Aviso } from '@/components/Toast'
import { Loader2, Save, MessageSquare, AlertTriangle, FileText } from 'lucide-react'

// Modelos das mensagens de pré e pós-operatório.
//
// O texto mora aqui, e não dentro do programa, porque texto de mensagem muda
// com o tempo — e mudar texto não pode depender de subir uma versão nova.
//
// Os modelos vêm DESLIGADOS. O texto de partida é um rascunho: quem conhece o
// tom da clínica é a equipe, não quem escreveu o sistema.

type Modelo = {
  id: string; tipo: string; titulo: string
  dias_offset: number; hora: string; texto: string; ativo: boolean; ordem: number
  // v48.66 — cada modelo diz em que situação dispara e se sai na hora ou em
  // relação à data da cirurgia.
  disparo_status: string | null; quando: string; minutos_atraso: number
  texto_alternativo: string | null
}

// v48.89 — {sigla} saiu da lista: é a abreviação interna (ex.: "CCC, HU"), e
// para o paciente só faz sentido o nome por extenso da cirurgia — o
// {cirurgia}. A variável continua existindo (nada quebra em modelo antigo que
// já a usava), só não é mais oferecida para quem escreve um modelo novo.
const CAMPOS = [
  ['{primeiro_nome}', 'primeiro nome do paciente'],
  ['{paciente}', 'nome completo'],
  ['{data}', 'data da cirurgia'],
  ['{hora}', 'horário'],
  ['{hospital}', 'hospital'],
  ['{cirurgiao}', 'cirurgião'],
  ['{cirurgia}', 'nome da cirurgia'],
  ['{whatsapp_cirurgiao}', 'link de WhatsApp do cirurgião'],
]

export default function MensagensAba() {
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvandoId, setSalvandoId] = useState<string | null>(null)
  const [salvo, setSalvo] = useState<string | null>(null)
  // v48.64 — Texto que acompanha a descrição cirúrgica quando a secretária
  // manda ao paciente. Não é agendada: sai no momento do clique.
  const [rgoId, setRgoId] = useState<string | null>(null)
  const [rgoTexto, setRgoTexto] = useState('')
  const [rgoSalvando, setRgoSalvando] = useState(false)
  const [rgoMsg, setRgoMsg] = useState('')
  // v48.92 — Quando a leitura falhava (coluna que ainda não existe porque a
  // migração não rodou, ou a tabela sem nenhuma linha), o card ficava com o
  // botão desligado e nem uma pista do porquê — parecia travado à toa. Agora o
  // erro aparece, e "sem linha" tem contorno: cria uma na hora de salvar.
  const [rgoErro, setRgoErro] = useState('')
  const [situacoes, setSituacoes] = useState<string[]>([])
  const [toast, setToast] = useState<Aviso>(null)

  useEffect(() => { carregar() }, [])

  async function carregar() {
    setCarregando(true)
    const [ms, cs, st] = await Promise.all([
      supabase.from('cirurgia_mensagens').select('*').order('ordem'),
      supabase.from('clinic_settings').select('id, rgo_mensagem').limit(1),
      supabase.from('cirurgia_status').select('nome').eq('ativo', true).order('ordem'),
    ])
    setSituacoes((st.data ?? []).map((x: any) => x.nome))
    setModelos((ms.data ?? []) as Modelo[])
    if (cs.error) {
      // Antes esse erro era ignorado: o campo ficava vazio, sem id, e o botão
      // de Salvar desligado para sempre — sem uma linha dizendo por quê.
      setRgoErro(
        'Não consegui carregar: ' + cs.error.message
        + (/rgo_mensagem/.test(cs.error.message) ? ' — falta rodar a migração 20260922_rgo_mensagem_v48_64.sql.' : '')
      )
    } else {
      setRgoErro('')
      const linha: any = cs.data?.[0]
      if (linha) { setRgoId(linha.id); setRgoTexto(linha.rgo_mensagem || '') }
    }
    setCarregando(false)
  }

  function alterar(id: string, campo: keyof Modelo, valor: any) {
    setModelos(ms => ms.map(m => m.id === id ? { ...m, [campo]: valor } : m))
    setSalvo(null)
  }

  // v48.84 — A chave grava na hora.
  //
  // Ela parece um interruptor, então precisa agir como um: antes, virar a chave
  // só mudava a cor e o modelo continuava desligado no banco até alguém clicar
  // em Salvar — o jeito mais fácil de achar que ligou e não ter ligado.
  async function ligarDesligar(m: Modelo) {
    const novo = !m.ativo
    alterar(m.id, 'ativo', novo)
    const { error } = await supabase.from('cirurgia_mensagens')
      .update({ ativo: novo, updated_at: new Date().toISOString() }).eq('id', m.id)
    if (error) {
      alterar(m.id, 'ativo', !novo)
      setToast({ texto: 'Não foi possível salvar: ' + error.message, tom: 'erro' })
      return
    }
    setToast({
      texto: novo
        ? `"${m.titulo}" ligada — a partir de agora os pacientes recebem esta mensagem.`
        : `"${m.titulo}" desligada — nenhum paciente recebe esta mensagem.`,
    })
  }

  async function salvar(m: Modelo) {
    setSalvandoId(m.id)
    const { error } = await supabase.from('cirurgia_mensagens').update({
      titulo: m.titulo, dias_offset: Number(m.dias_offset) || 0,
      hora: m.hora, texto: m.texto, texto_alternativo: m.texto_alternativo || null, ativo: m.ativo,
      disparo_status: m.disparo_status || null,
      quando: m.quando || 'data_cirurgia',
      minutos_atraso: Number(m.minutos_atraso) || 0,
      updated_at: new Date().toISOString(),
    }).eq('id', m.id)
    setSalvandoId(null)
    if (error) { setToast({ texto: 'Não foi possível salvar: ' + error.message, tom: 'erro' }); return }
    setToast({ texto: `"${m.titulo}" salva.` })
    setSalvo(m.id)
    setTimeout(() => setSalvo(s => s === m.id ? null : s), 2500)
  }

  async function salvarRgo() {
    setRgoSalvando(true); setRgoMsg('')
    // Sem id ainda (clinic_settings sem nenhuma linha) — cria em vez de travar
    // esperando uma linha que nunca existiu.
    const { data, error } = rgoId
      ? await supabase.from('clinic_settings').update({ rgo_mensagem: rgoTexto }).eq('id', rgoId).select('id').maybeSingle()
      : await supabase.from('clinic_settings').insert({ rgo_mensagem: rgoTexto }).select('id').maybeSingle()
    setRgoSalvando(false)
    const texto = error
      ? 'Não foi possível salvar: ' + error.message + (/rgo_mensagem/.test(error.message) ? ' — falta rodar a migração 20260922_rgo_mensagem_v48_64.sql.' : '')
      : 'Mensagem da descrição cirúrgica salva.'
    if (!error) { setRgoErro(''); if (data?.id) setRgoId(data.id) }
    setRgoMsg(error ? texto : 'Salvo.')
    setToast({ texto, tom: error ? 'erro' : 'ok' })
    setTimeout(() => setRgoMsg(''), 3000)
  }

  const input = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'
  const algumDesligado = modelos.some(m => !m.ativo)

  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold text-slate-700">Mensagens automáticas</p>
      <p className="text-xs text-slate-400 mt-0.5 mb-4">
        Enviadas sozinhas quando a cirurgia entra na situação marcada com o sino (hoje, AUTORIZADA)
      </p>

      {algumDesligado && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg mb-4">
          <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5"/>
          <p className="text-xs text-amber-800">
            O texto abaixo é um rascunho que eu escrevi. <strong>Leia e ajuste ao tom da clínica antes de ligar.</strong>{' '}
            Enquanto o modelo estiver desligado, nenhum paciente recebe nada.
          </p>
        </div>
      )}

      <div className="bg-slate-50 rounded-xl px-3 py-2.5 mb-4">
        <p className="text-[11px] font-semibold text-slate-600 mb-1.5">Campos que o sistema substitui</p>
        <div className="flex flex-wrap gap-1.5">
          {CAMPOS.map(([c, desc]) => (
            <span key={c} title={desc} className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[11px] font-mono text-slate-600">
              {c}
            </span>
          ))}
        </div>
      </div>

      {!carregando && (
        <div className="bg-white border border-slate-100 rounded-xl p-4 space-y-3 mb-6">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-brand-500 shrink-0"/>
            <p className="text-sm font-semibold text-slate-700">Descrição cirúrgica (RGO) enviada ao paciente</p>
          </div>
          <p className="text-xs text-slate-400">
            Vai junto das fotos quando alguém clica em "Enviar ao paciente" no cartão da cirurgia.
            Campos: <span className="font-mono">{'{saudacao}'}</span>, <span className="font-mono">{'{primeiro_nome}'}</span>,{' '}
            <span className="font-mono">{'{paciente}'}</span>, <span className="font-mono">{'{cirurgia}'}</span>, <span className="font-mono">{'{data}'}</span>.
          </p>
          {rgoErro && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle size={15} className="text-red-600 shrink-0 mt-0.5"/>
              <p className="text-xs text-red-700">{rgoErro}</p>
            </div>
          )}
          <textarea value={rgoTexto} onChange={e => setRgoTexto(e.target.value)} rows={6} className={input + ' leading-5'}
            placeholder={'{saudacao}\n\nSegue a descrição cirúrgica ({cirurgia}) para a solicitação de reembolso junto ao seu convênio.'}/>
          <div className="flex items-center gap-2">
            <button onClick={salvarRgo} disabled={rgoSalvando}
              className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
              {rgoSalvando ? <><Loader2 size={15} className="animate-spin"/> Salvando...</> : <><Save size={15}/> Salvar</>}
            </button>
            {rgoMsg && <span className="text-xs text-slate-500">{rgoMsg}</span>}
          </div>
        </div>
      )}

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8"><Loader2 size={16} className="animate-spin"/> Carregando...</div>
      ) : (
        <div className="space-y-4">
          {modelos.map(m => (
            // v48.75 — Ligado e desligado dá para ver de longe.
            //
            // Era uma caixinha de marcar do tamanho de uma letra, e a diferença
            // entre "esta mensagem vai para o paciente" e "não vai" ficava num
            // quadradinho cinza. Agora a borda e o fundo do cartão mudam junto
            // com a chave: de relance dá para ver quais estão no ar.
            <div key={m.id}
              className={'rounded-xl p-4 space-y-3 border-2 transition-colors '
                + (m.ativo ? 'bg-white border-emerald-200' : 'bg-slate-50/60 border-slate-100')}>
              <div className="flex items-center gap-2">
                <MessageSquare size={15} className={m.ativo ? 'text-emerald-600 shrink-0' : 'text-slate-300 shrink-0'}/>
                <input value={m.titulo} onChange={e => alterar(m.id, 'titulo', e.target.value)}
                  className={'flex-1 min-w-0 text-sm font-semibold bg-transparent focus:outline-none '
                    + (m.ativo ? 'text-slate-800' : 'text-slate-500')}/>

                <button type="button" role="switch" aria-checked={m.ativo}
                  onClick={() => ligarDesligar(m)}
                  title={m.ativo ? 'Está ligada — clique para desligar' : 'Está desligada — clique para ligar'}
                  className={'flex items-center gap-2 pl-2 pr-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide shrink-0 transition-colors '
                    + (m.ativo ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-slate-200 text-slate-500 hover:bg-slate-300')}>
                  <span className={'w-8 h-4 rounded-full relative transition-colors ' + (m.ativo ? 'bg-emerald-700/40' : 'bg-white')}>
                    <span className={'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all '
                      + (m.ativo ? 'left-[1.125rem]' : 'left-0.5 bg-slate-400')}/>
                  </span>
                  {m.ativo ? 'ligada' : 'desligada'}
                </button>
              </div>

              {!m.ativo && (
                <p className="text-[11px] text-slate-400">
                  Desligada: nenhum paciente recebe esta mensagem.
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Dispara quando a cirurgia entra em</label>
                  <select value={m.disparo_status ?? ''} onChange={e => alterar(m.id, 'disparo_status', e.target.value || null)} className={input}>
                    <option value="">a situação do sino (Situações)</option>
                    {situacoes.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Sai</label>
                  <select value={m.quando || 'data_cirurgia'} onChange={e => alterar(m.id, 'quando', e.target.value)} className={input}>
                    <option value="data_cirurgia">em relação à data da cirurgia</option>
                    <option value="na_hora">ao mudar de situação (a secretária confirma)</option>
                    <option value="parado">quando fica parado nesta situação</option>
                  </select>
                </div>
              </div>

              {(m.quando || 'data_cirurgia') === 'na_hora' ? (
                <p className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                  Não sai sozinha: aparece um alerta perguntando se deseja avisar o paciente,
                  com o texto já pronto e editável. Quem decide é quem está no CRM.
                </p>
              ) : (m.quando || '') === 'parado' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Depois de quantos dias parado</label>
                  <select value={m.dias_offset} onChange={e => alterar(m.id, 'dias_offset', Number(e.target.value))} className={input}>
                    {[15, 30, 45, 60, 90].map(d => <option key={d} value={d}>{d} dias</option>)}
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Também passa pela confirmação da secretária, e volta a perguntar uma vez por mês enquanto o paciente seguir parado.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Quando enviar</label>
                    <select value={m.dias_offset} onChange={e => alterar(m.id, 'dias_offset', Number(e.target.value))} className={input}>
                      {[-7, -5, -3, -2, -1, 0, 1, 2, 3, 7].map(d => (
                        <option key={d} value={d}>
                          {d === 0 ? 'no dia da cirurgia'
                            : d < 0 ? `${Math.abs(d)} dia${Math.abs(d) > 1 ? 's' : ''} antes`
                            : `${d} dia${d > 1 ? 's' : ''} depois`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Horário</label>
                    <input type="time" value={(m.hora || '').slice(0, 5)} onChange={e => alterar(m.id, 'hora', e.target.value)} className={input}/>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Texto</label>
                <textarea value={m.texto} onChange={e => alterar(m.id, 'texto', e.target.value)} rows={12}
                  className={input + ' leading-5'}/>
              </div>

              {/* Só o retorno tem dois textos: perguntar "quer agendar?" a quem
                  já agendou soa como se a clínica não olhasse a própria agenda. */}
              {m.tipo === 'retorno' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Texto quando o paciente JÁ tem consulta marcada depois da cirurgia
                  </label>
                  <textarea value={m.texto_alternativo || ''} onChange={e => alterar(m.id, 'texto_alternativo', e.target.value)} rows={8}
                    className={input + ' leading-5'}/>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Campo extra: <span className="font-mono">{'{data_retorno}'}</span>. Deixe em branco para usar sempre o texto de cima.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button onClick={() => salvar(m)} disabled={salvandoId === m.id}
                  className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
                  {salvandoId === m.id ? <><Loader2 size={15} className="animate-spin"/> Salvando...</> : <><Save size={15}/> Salvar</>}
                </button>
                {salvo === m.id && <span className="text-xs text-emerald-600 font-semibold">Salvo!</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-slate-400">
        As mensagens entram na mesma fila de <strong>Agenda de Mensagens</strong>, onde dá para conferir e
        cancelar antes de saírem. Remarcar a cirurgia refaz o agendamento sozinho; cancelar a cirurgia
        derruba as mensagens pendentes.
      </p>

      <Toast aviso={toast} aoFechar={() => setToast(null)}/>
    </div>
  )
}
