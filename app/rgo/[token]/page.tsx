'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { CheckCircle2, Loader2, XCircle, FileText, Plus, Camera, Lock, Trash2, Check } from 'lucide-react'

// v48.59 — Página da Obesity Health que o cirurgião abre pelo evento do Google
// Agenda. Já vem com os dados da cirurgia, SÓ PARA CONFERÊNCIA (nada aqui altera
// a cirurgia), e serve apenas para adicionar:
//   - a descrição cirúrgica (RGO) — ao enviar, a cirurgia vira "realizada";
//   - outros documentos da cirurgia, quantos forem necessários.
// Sem login: a chave longa no endereço é a senha.

type Arq = { url: string; nome: string; tipo: string; categoria: 'rgo' | 'documento'; enviado_em: string | null; por: string; pode_apagar: boolean }
type MembroEquipe = { id: string; nome_curto: string; nome_completo: string | null; funcao: string | null }
type EquipeRgo = {
  cirurgiao_id: string | null; auxiliar1_id: string | null; auxiliar2_id: string | null
  instrumentador1_id: string | null; instrumentador2_id: string | null; anestesista_id: string | null
}
// v48.120 — Quem foi digitado à mão (não está no cadastro), por papel.
// "incluir" só é usado ao salvar — o servidor não devolve incluir de volta,
// já que a pessoa vira um rgo_*_id normal quando é marcada.
type Avulso = { nome: string; documento: string; incluir: boolean }
const AVULSO_VAZIO: Avulso = { nome: '', documento: '', incluir: false }

type Dados = {
  paciente: string; data: string; hora: string; procedimento: string; hospital: string; cirurgiao: string
  procedimentos: { tuss: string; nome: string }[]
  equipe: string; convenio: string; modalidade: string; situacao: string; realizada: boolean
  concluida: boolean; enviada_ao_paciente: boolean; observacoes: string; arquivos: Arq[]
  equipeCadastro: MembroEquipe[]; equipeRgo: EquipeRgo; equipeAvulsa: Record<string, { nome: string; documento: string }>
}

// v48.92 — Os papéis que a divisão de honorários e a solicitação de reembolso
// precisam, com o nome exatamente como está no cadastro (e, por tabela, na
// descrição cirúrgica) — em vez de um palpite por ordem de cadastro.
//
// v48.120 — "papel" é a mesma chave sem o "_id": é como o servidor identifica
// cada papel tanto no rgo_*_id quanto no avulso (rgo_equipe_avulsa).
const PAPEIS_EQUIPE: { chave: keyof EquipeRgo; papel: string; rotulo: string }[] = [
  { chave: 'cirurgiao_id', papel: 'cirurgiao', rotulo: 'Cirurgião' },
  { chave: 'auxiliar1_id', papel: 'auxiliar1', rotulo: '1º Auxiliar' },
  { chave: 'auxiliar2_id', papel: 'auxiliar2', rotulo: '2º Auxiliar' },
  { chave: 'instrumentador1_id', papel: 'instrumentador1', rotulo: '1º Instrumentador(a)' },
  { chave: 'instrumentador2_id', papel: 'instrumentador2', rotulo: '2º Instrumentador(a)' },
  { chave: 'anestesista_id', papel: 'anestesista', rotulo: 'Anestesista' },
]

export default function RgoPage() {
  const params = useParams<{ token: string }>()
  const token = String(params?.token || '')
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState<'' | 'rgo' | 'documento' | 'concluir' | 'apagar' | 'obs' | 'equipe'>('')
  const [obs, setObs] = useState('')
  const [obsSalva, setObsSalva] = useState(false)
  const [equipeRgo, setEquipeRgo] = useState<EquipeRgo>({
    cirurgiao_id: null, auxiliar1_id: null, auxiliar2_id: null,
    instrumentador1_id: null, instrumentador2_id: null, anestesista_id: null,
  })
  // v48.120 — Pessoa avulsa por papel (não está no cadastro), e se o papel
  // está mostrando os campos de avulso em vez do select do cadastro.
  const [avulso, setAvulso] = useState<Record<string, Avulso>>({})
  const [modoAvulso, setModoAvulso] = useState<Record<string, boolean>>({})
  const [equipeSalva, setEquipeSalva] = useState(false)
  // Nome do documento ("etiqueta de material"), pedido antes de escolher o
  // arquivo: depois de escolher, o celular já abre a câmera e não há volta.
  const [nomeDoc, setNomeDoc] = useState('')
  const [aviso, setAviso] = useState('')
  const [marca, setMarca] = useState<{ logo: string | null; cor: string; nome: string }>({ logo: null, cor: '#0c8ee7', nome: 'Obesity Health' })
  const inputRgo = useRef<HTMLInputElement>(null)
  const inputDoc = useRef<HTMLInputElement>(null)

  async function carregar() {
    const r = await fetch(`/api/rgo/${token}`, { cache: 'no-store' })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j) throw new Error(j?.erro || 'Link inválido.')
    setDados(j)
    setObs(prev => prev || j.observacoes || '')
    setEquipeRgo(prev => {
      const vazio = Object.values(prev).every(v => !v)
      return vazio && j.equipeRgo ? j.equipeRgo : prev
    })
    // v48.120 — Só na primeira carga: preenche os avulsos já salvos e abre o
    // modo avulso de quem já tem um. Depois disso quem manda é o que a pessoa
    // está digitando na tela, não o que voltou do servidor.
    setAvulso(prev => {
      if (Object.keys(prev).length) return prev
      const inicial: Record<string, Avulso> = {}
      for (const [papel, v] of Object.entries(j.equipeAvulsa || {})) {
        inicial[papel] = { nome: (v as any)?.nome || '', documento: (v as any)?.documento || '', incluir: false }
      }
      return inicial
    })
    setModoAvulso(prev => {
      if (Object.keys(prev).length) return prev
      const inicial: Record<string, boolean> = {}
      for (const papel of Object.keys(j.equipeAvulsa || {})) inicial[papel] = true
      return inicial
    })
  }

  useEffect(() => {
    carregar().catch(e => setErro(e.message))
    supabase.from('clinic_branding').select('logo_url, primary_color, clinic_name')
      .eq('clinic_id', '00000000-0000-0000-0000-000000000001').maybeSingle()
      .then(({ data }) => { if (data) setMarca({ logo: data.logo_url || null, cor: data.primary_color || '#0c8ee7', nome: data.clinic_name || 'Obesity Health' }) })
  }, [token])

  async function enviar(categoria: 'rgo' | 'documento', files: FileList | null) {
    if (!files?.length) return
    setEnviando(categoria); setErro(''); setAviso('')
    const fd = new FormData()
    fd.append('categoria', categoria)
    if (categoria === 'documento' && nomeDoc.trim()) fd.append('descricao', nomeDoc.trim())
    Array.from(files).forEach(f => fd.append('arquivos', f))
    try {
      const r = await fetch(`/api/rgo/${token}`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
      setAviso(categoria === 'rgo'
        ? 'Foto recebida. Confira abaixo — se não ficou boa, apague e mande outra.'
        : 'Documento recebido.')
      setNomeDoc('')
      await carregar()
    } catch (e: any) { setErro(e?.message || 'Não foi possível enviar.') }
    setEnviando('')
    if (inputRgo.current) inputRgo.current.value = ''
    if (inputDoc.current) inputDoc.current.value = ''
  }

  async function acao(corpo: any, qual: 'concluir' | 'apagar' | 'obs' | 'equipe') {
    setEnviando(qual); setErro(''); setAviso('')
    try {
      const r = await fetch(`/api/rgo/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
      if (qual === 'concluir') setAviso('Envio concluído. A clínica já foi avisada.')
      if (qual === 'obs') setObsSalva(true)
      if (qual === 'equipe') setEquipeSalva(true)
      await carregar()
    } catch (e: any) { setErro(e?.message || 'Não foi possível.') }
    setEnviando('')
  }

  // v48.120 — Monta o corpo completo que o servidor espera: para cada papel,
  // ou o id do cadastro, ou (em modo avulso) nome/documento digitados + se é
  // para incluir no cadastro. Sempre os seis papéis, sempre por inteiro —
  // assim o servidor não precisa adivinhar o que já estava salvo antes.
  function corpoEquipe(ids: EquipeRgo, avulsos: Record<string, Avulso>, modos: Record<string, boolean>) {
    const corpo: any = {}
    for (const { chave, papel } of PAPEIS_EQUIPE) {
      if (modos[papel]) {
        const a = avulsos[papel] || AVULSO_VAZIO
        corpo[`${papel}_id`] = null
        corpo[`${papel}_avulso`] = { nome: a.nome, documento: a.documento }
        corpo[`${papel}_incluir`] = !!a.incluir
      } else {
        corpo[`${papel}_id`] = ids[chave] || null
      }
    }
    return corpo
  }

  function salvarEquipeSelect(chave: keyof EquipeRgo, valor: string | null) {
    const novaIds = { ...equipeRgo, [chave]: valor }
    setEquipeRgo(novaIds); setEquipeSalva(false)
    acao({ acao: 'equipe_rgo', ...corpoEquipe(novaIds, avulso, modoAvulso) }, 'equipe')
  }

  // Ligar mostra os campos, sem salvar ainda (a pessoa ainda vai digitar).
  // Desligar volta pro cadastro e já salva, limpando o avulso deste papel.
  function alternarModoAvulso(papel: string, ligar: boolean) {
    const novoModo = { ...modoAvulso, [papel]: ligar }
    setModoAvulso(novoModo)
    if (!ligar) {
      setEquipeSalva(false)
      acao({ acao: 'equipe_rgo', ...corpoEquipe(equipeRgo, avulso, novoModo) }, 'equipe')
    }
  }

  function mudarAvulso(papel: string, campo: keyof Avulso, valor: any) {
    setAvulso(a => ({ ...a, [papel]: { ...(a[papel] || AVULSO_VAZIO), [campo]: valor } }))
    setEquipeSalva(false)
  }

  function salvarAvulso(papel: string) {
    acao({ acao: 'equipe_rgo', ...corpoEquipe(equipeRgo, avulso, modoAvulso) }, 'equipe')
  }

  const apagar = (a: Arq) => {
    if (!window.confirm(`Apagar "${a.nome || 'este arquivo'}"?`)) return
    acao({ acao: 'remover', url: a.url }, 'apagar')
  }
  const concluir = async () => {
    if (!window.confirm('Concluir o envio? Depois disso não dá mais para apagar por aqui.')) return
    // Salva o que estiver escrito antes de trancar: se o texto ficasse só na
    // tela, concluir apagaria o que o cirurgião acabou de digitar.
    if ((obs || '') !== (dados?.observacoes || '')) await acao({ acao: 'observacoes', texto: obs }, 'obs')
    await acao({ acao: 'concluir' }, 'concluir')
  }

  const travado = !!(dados?.concluida || dados?.enviada_ao_paciente)
  const dataBr = dados?.data ? dados.data.split('-').reverse().join('/') : ''
  const rgos = (dados?.arquivos || []).filter(a => a.categoria !== 'documento')
  const docs = (dados?.arquivos || []).filter(a => a.categoria === 'documento')

  const Campo = ({ rotulo, valor }: { rotulo: string; valor: string }) => valor ? (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{rotulo}</p>
      <p className="text-sm text-slate-800">{valor}</p>
    </div>
  ) : null

  // v48.63 — No celular o CSS do CRM trava a rolagem do body (html e body
  // ficam fixed, para o cabeçalho do app não oscilar). Uma página pública
  // precisa, então, rolar por conta própria — daí a altura fixa + overflow
  // abaixo. Sem isso, "Outros documentos" ficava fora da tela, inalcançável.
  return (
    <div className="h-[100dvh] min-h-[100dvh] overflow-y-auto bg-slate-50 flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-md space-y-4 pb-8">
        <div className="flex flex-col items-center text-center">
          {marca.logo
            ? <img src={marca.logo} alt={marca.nome} className="w-14 h-14 object-contain mb-2"/>
            : <div className="w-14 h-14 rounded-full mb-2" style={{ background: marca.cor }}/>}
          <h1 className="text-base font-semibold text-slate-800">{marca.nome}</h1>
          <p className="text-xs text-slate-500">Descrição cirúrgica</p>
        </div>

        {!dados && !erro && <div className="flex justify-center py-16 text-slate-400"><Loader2 className="animate-spin"/></div>}
        {!dados && erro && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center">
            <XCircle className="mx-auto text-slate-300 mb-2" size={30}/><p className="text-sm text-slate-600">{erro}</p>
          </div>
        )}

        {dados && (
          <>
            {/* Dados da cirurgia — só leitura */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Cirurgia</p>
                <span className="flex items-center gap-1 text-[10px] text-slate-400"><Lock size={10}/> somente leitura</span>
              </div>
              <p className="text-base font-semibold text-slate-800 mb-3">{dados.paciente}</p>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Data" valor={dataBr + (dados.hora ? ' às ' + dados.hora : '')}/>
                <Campo rotulo="Hospital" valor={dados.hospital}/>
                <Campo rotulo="Cirurgião" valor={dados.cirurgiao}/>
                <Campo rotulo="Convênio" valor={dados.convenio}/>
                <Campo rotulo="Condição" valor={dados.modalidade}/>
              </div>

              {/* Linha inteira: nome de cirurgia é longo e não pode quebrar em
                  coluna estreita. Com o TUSS na frente, é o que o convênio pede. */}
              <div className="mt-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Procedimentos solicitados</p>
                {(dados.procedimentos?.length ? dados.procedimentos : [{ tuss: '', nome: dados.procedimento }]).map((p, i) => (
                  <p key={i} className="text-sm text-slate-800 leading-snug">
                    {p.tuss ? <span className="font-mono text-slate-500">{p.tuss}</span> : null}{p.tuss ? ' - ' : ''}{p.nome}
                  </p>
                ))}
              </div>
              {dados.equipe && <div className="mt-3"><Campo rotulo="Equipe" valor={dados.equipe}/></div>}
              <p className={'mt-3 inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ' + (dados.realizada ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                {dados.realizada ? 'Cirurgia realizada' : dados.situacao}
              </p>
            </div>

            {/* v48.92 — Equipe: quem realmente esteve na sala, por papel.
                Alimenta a divisão de honorários e, em breve, a solicitação de
                reembolso — precisa bater com o nome na descrição cirúrgica, por
                isso escolhe do cadastro em vez de digitar.
                v48.120 — Quem não está no cadastro pode ser digitado na hora
                ("+ pessoa avulsa"), com a opção de incluir no cadastro depois
                (fica reutilizável) ou não (vale só para esta cirurgia). */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <p className="text-sm font-semibold text-slate-800">Equipe desta cirurgia</p>
              <p className="text-xs text-slate-400">Só quem participou. Deixe em branco quem não teve.</p>
              {travado ? (
                <div className="space-y-1.5">
                  {PAPEIS_EQUIPE.map(({ chave, papel, rotulo }) => {
                    const m = dados.equipeCadastro.find(x => x.id === equipeRgo[chave])
                    const av = dados.equipeAvulsa?.[papel]
                    if (!m && !av) return null
                    return (
                      <div key={chave} className="flex items-center justify-between text-sm">
                        <span className="text-slate-400 text-xs">{rotulo}</span>
                        <span className="text-slate-700">{m ? (m.nome_completo || m.nome_curto) : av!.nome}</span>
                      </div>
                    )
                  })}
                  {PAPEIS_EQUIPE.every(({ chave, papel }) => !equipeRgo[chave] && !dados.equipeAvulsa?.[papel]) && <p className="text-xs text-slate-400">Nenhum registrado.</p>}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {PAPEIS_EQUIPE.map(({ chave, papel, rotulo }) => (
                    <div key={chave} className={modoAvulso[papel] ? 'col-span-2' : ''}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] text-slate-500">{rotulo}</label>
                        <button type="button" disabled={enviando === 'equipe'}
                          onClick={() => alternarModoAvulso(papel, !modoAvulso[papel])}
                          className="text-[10px] text-slate-400 underline disabled:opacity-50">
                          {modoAvulso[papel] ? 'escolher do cadastro' : '+ pessoa avulsa'}
                        </button>
                      </div>
                      {modoAvulso[papel] ? (
                        <div className="space-y-1.5 bg-slate-50 rounded-lg p-2">
                          <input value={avulso[papel]?.nome || ''} maxLength={120}
                            onChange={e => mudarAvulso(papel, 'nome', e.target.value)}
                            placeholder="Nome completo" disabled={enviando === 'equipe'}
                            className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs outline-none focus:border-slate-400"/>
                          <input value={avulso[papel]?.documento || ''} maxLength={60}
                            onChange={e => mudarAvulso(papel, 'documento', e.target.value)}
                            placeholder="CRM, COREN ou CPF" disabled={enviando === 'equipe'}
                            className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs outline-none focus:border-slate-400"/>
                          <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                            <input type="checkbox" checked={!!avulso[papel]?.incluir} disabled={enviando === 'equipe'}
                              onChange={e => mudarAvulso(papel, 'incluir', e.target.checked)} className="rounded"/>
                            Incluir no cadastro da equipe
                          </label>
                          <button onClick={() => salvarAvulso(papel)} disabled={enviando === 'equipe' || !avulso[papel]?.nome?.trim()}
                            className="w-full py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 disabled:opacity-50">
                            Salvar
                          </button>
                        </div>
                      ) : (
                        <select value={equipeRgo[chave] || ''} disabled={enviando === 'equipe'}
                          onChange={e => salvarEquipeSelect(chave, e.target.value || null)}
                          className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-xs outline-none focus:border-slate-400">
                          <option value="">—</option>
                          {dados.equipeCadastro.map(m => (
                            <option key={m.id} value={m.id}>{m.nome_curto || m.nome_completo}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!travado && equipeSalva && <p className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1"><Check size={12}/> Salvo.</p>}
            </div>

            {/* RGO */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <p className="text-sm font-semibold text-slate-800">Descrição cirúrgica (RGO)</p>
              {rgos.length > 0 && <Galeria itens={rgos} apagar={a => apagar(a)} ocupado={enviando === 'apagar'}/>}
              {!travado && (
                <>
                  <input ref={inputRgo} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={e => enviar('rgo', e.target.files)}/>
                  <button onClick={() => inputRgo.current?.click()} disabled={!!enviando}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-white font-semibold disabled:opacity-50"
                    style={{ background: marca.cor }}>
                    {enviando === 'rgo' ? <Loader2 size={18} className="animate-spin"/> : rgos.length ? <Plus size={18}/> : <Camera size={18}/>}
                    {rgos.length ? 'Adicionar mais uma página da RGO' : 'Adicionar RGO'}
                  </button>
                  <p className="text-[11px] text-slate-400">Foto ou PDF. Toque na imagem para ver maior; se não ficou boa, apague e tire outra.</p>
                </>
              )}
            </div>

            {/* Outros documentos */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <p className="text-sm font-semibold text-slate-800">Outros documentos</p>
              {docs.length > 0 && <Galeria itens={docs} apagar={a => apagar(a)} ocupado={enviando === 'apagar'}/>}
              {!travado && (
                <>
                  {/* O nome vem antes do arquivo de propósito: escolhido o
                      arquivo, o envio é imediato e não sobra momento de nomear. */}
                  <input value={nomeDoc} onChange={e => setNomeDoc(e.target.value)} maxLength={80}
                    placeholder="O que é? ex.: etiqueta de material"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:border-slate-400"/>
                  <input ref={inputDoc} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={e => enviar('documento', e.target.files)}/>
                  <button onClick={() => inputDoc.current?.click()} disabled={!!enviando}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-600 font-semibold disabled:opacity-50">
                    {enviando === 'documento' ? <Loader2 size={18} className="animate-spin"/> : <Plus size={18}/>}
                    {docs.length ? 'Adicionar mais um documento' : 'Adicionar documento'}
                  </button>
                  <p className="text-[11px] text-slate-400">Etiquetas de material, relatórios, o que for da cirurgia.</p>
                </>
              )}
            </div>

            {/* Observações da cirurgia — anotação eventual do cirurgião. */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-2">
              <p className="text-sm font-semibold text-slate-800">Observações</p>
              {travado ? (
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{dados.observacoes || '—'}</p>
              ) : (
                <>
                  <textarea value={obs} onChange={e => { setObs(e.target.value); setObsSalva(false) }} rows={4} maxLength={4000}
                    placeholder="Intercorrência, achado, material usado... o que precisar registrar."
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:border-slate-400 resize-y"/>
                  <button onClick={() => acao({ acao: 'observacoes', texto: obs }, 'obs')} disabled={!!enviando}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold disabled:opacity-50">
                    {enviando === 'obs' ? <Loader2 size={16} className="animate-spin"/> : obsSalva ? <Check size={16}/> : null}
                    {obsSalva ? 'Observações salvas' : 'Salvar observações'}
                  </button>
                </>
              )}
            </div>

            {/* Concluir: daqui em diante o link não apaga mais nada. */}
            {travado ? (
              <p className="flex items-start gap-2 text-sm text-emerald-700">
                <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5"/>
                Envio concluído. Para incluir ou remover alguma coisa, fale com a clínica.
              </p>
            ) : rgos.length > 0 ? (
              <button onClick={concluir} disabled={!!enviando}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-50">
                {enviando === 'concluir' ? <Loader2 size={18} className="animate-spin"/> : <Check size={18}/>}
                Concluir envio
              </button>
            ) : null}

            {aviso && <p className="flex items-start gap-2 text-sm text-emerald-700"><CheckCircle2 size={18} className="flex-shrink-0 mt-0.5"/>{aviso}</p>}
            {erro && <p className="text-sm text-red-600">{erro}</p>}
          </>
        )}
        <p className="text-center text-[11px] text-slate-400">Os dados da cirurgia não podem ser alterados por esta página.</p>
      </div>
    </div>
  )
}

function Galeria({ itens, apagar, ocupado }: { itens: Arq[]; apagar: (a: Arq) => void; ocupado: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {itens.map((a, i) => (
        <div key={a.url || i} className="relative border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="block aspect-[3/4]">
            {a.tipo.startsWith('image/')
              ? <img src={a.url} alt={a.nome || 'arquivo'} className="w-full h-full object-cover"/>
              : <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-500 p-1 text-center">
                  <FileText size={22}/><span className="text-[9px] leading-tight break-all">{a.nome || 'PDF'}</span>
                </div>}
          </a>
          {a.nome && a.tipo.startsWith('image/') && (
            <p className="px-1.5 py-1 text-[10px] text-slate-600 truncate bg-white">{a.nome}</p>
          )}
          {a.pode_apagar ? (
            <button onClick={() => apagar(a)} disabled={ocupado} aria-label="Apagar"
              className="absolute top-1 right-1 p-1.5 rounded-full bg-white/95 text-red-600 shadow disabled:opacity-50">
              <Trash2 size={13}/>
            </button>
          ) : (
            <span className="absolute top-1 right-1 p-1.5 rounded-full bg-white/90 text-emerald-600 shadow"><CheckCircle2 size={13}/></span>
          )}
        </div>
      ))}
    </div>
  )
}
