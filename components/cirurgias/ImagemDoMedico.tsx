'use client'
import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Upload, Loader2, Trash2, AlertCircle } from 'lucide-react'

// Uma imagem do papel timbrado: cabeçalho, carimbo ou assinatura.
//
// v48.32 — Fica no cadastro de quem assina, e não no desenho de cada carta.
// Assim um médico novo entra com o papel dele, e trocar o cabeçalho é uma
// troca só, que vale para todas as cartas dali em diante.
//
// O fundo quadriculado atrás da imagem não é enfeite: carimbo e assinatura são
// PNG com fundo transparente, e sem o quadriculado não dá para saber, na hora
// de subir, se o arquivo veio com fundo branco — que depois aparece como um
// retângulo sobre a carta impressa.

const BALDE = 'papel-timbrado'

export default function ImagemDoMedico({
  id, campo, valor, rotulo, dica, altura = 'h-20', onTrocou,
}: {
  id: string
  campo: 'cabecalho_url' | 'carimbo_url' | 'assinatura_url' | 'papel_url'
  valor: string | null
  rotulo: string
  dica: string
  altura?: string
  onTrocou: (url: string | null) => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const campoArquivo = useRef<HTMLInputElement>(null)

  async function enviar(arquivo: File) {
    if (!id) { setErro('Salve o cadastro antes de subir a imagem.'); return }
    if (/pdf$/i.test(arquivo.name) || arquivo.type === 'application/pdf') {
      // Aceitar o PDF aqui daria uma página em branco na carta: o navegador não
      // desenha PDF como fundo. Melhor dizer isso agora do que na hora de imprimir.
      setErro('PDF não serve como fundo. Exporte a folha como PNG ou JPG (no Word/Docs: Arquivo → Download → Imagem, ou uma captura em alta).')
      return
    }
    if (arquivo.size > 6 * 1024 * 1024) { setErro('Imagem muito grande — o limite é 6 MB.'); return }
    setEnviando(true); setErro('')

    const ext = (arquivo.name.split('.').pop() || 'png').toLowerCase()
    const caminho = `${id}/${campo}.${ext}`
    const { error } = await supabase.storage.from(BALDE)
      .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type })

    if (error) {
      setEnviando(false)
      setErro('Não foi possível subir: ' + error.message + ' — o balde "papel-timbrado" foi criado? (SQL da v48.32)')
      return
    }

    // O carimbo de tempo no fim do endereço força o navegador a buscar a versão
    // nova. Sem ele, trocar a assinatura não muda nada na tela: o navegador
    // mostra a antiga, que está no cache com o mesmo endereço.
    const { data } = supabase.storage.from(BALDE).getPublicUrl(caminho)
    const url = `${data.publicUrl}?t=${Date.now()}`

    const { error: erroBanco } = await supabase.from('cirurgia_equipe').update({ [campo]: url }).eq('id', id)
    setEnviando(false)
    if (erroBanco) { setErro('A imagem subiu, mas não salvou no cadastro: ' + erroBanco.message); return }
    onTrocou(url)
  }

  async function remover() {
    if (!confirm(`Tirar ${rotulo.toLowerCase()} deste cadastro?`)) return
    setEnviando(true)
    await supabase.from('cirurgia_equipe').update({ [campo]: null }).eq('id', id)
    setEnviando(false)
    onTrocou(null)
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{rotulo}</label>

      <div className={'relative rounded-lg border border-dashed border-slate-300 overflow-hidden ' + altura}
        style={{
          backgroundImage:
            'linear-gradient(45deg, #f1f5f9 25%, transparent 25%), linear-gradient(-45deg, #f1f5f9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f5f9 75%), linear-gradient(-45deg, transparent 75%, #f1f5f9 75%)',
          backgroundSize: '12px 12px',
          backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
        }}>
        {valor ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={valor} alt={rotulo} className="w-full h-full object-contain"/>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-400">
            sem {rotulo.toLowerCase()}
          </div>
        )}
        {enviando && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <Loader2 size={16} className="animate-spin text-slate-500"/>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-1.5">
        <button type="button" onClick={() => campoArquivo.current?.click()} disabled={enviando || !id}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
          <Upload size={12}/> {valor ? 'Trocar' : 'Subir'}
        </button>
        {valor && (
          <button type="button" onClick={remover} disabled={enviando}
            className="p-1 text-slate-300 hover:text-red-500"><Trash2 size={13}/></button>
        )}
      </div>

      <p className="text-[11px] text-slate-400 mt-1">{dica}</p>
      {!id && <p className="text-[11px] text-amber-700 mt-1">Salve o cadastro primeiro para poder subir a imagem.</p>}
      {erro && (
        <p className="flex items-start gap-1 text-[11px] text-red-600 mt-1">
          <AlertCircle size={12} className="shrink-0 mt-0.5"/>{erro}
        </p>
      )}

      <input ref={campoArquivo} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={e => { const a = e.target.files?.[0]; if (a) enviar(a); e.target.value = '' }}/>
    </div>
  )
}
