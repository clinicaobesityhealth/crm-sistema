'use client'
import ImagemDoMedico from './ImagemDoMedico'

// A folha timbrada inteira, com a área de texto marcada por cima.
//
// v48.33 — Montar o papel a partir de pedaços (cabeçalho em cima, rodapé
// embaixo) nunca sai igual ao impresso: falta a marca d'água, a faixa lateral,
// a borda, o espaçamento exato. Usar a folha inteira como fundo resolve tudo
// isso de uma vez — a carta passa a ser a SUA folha, com o texto escrito em
// cima.
//
// O que sobra para configurar são as margens: até onde o texto pode ir sem
// cobrir o cabeçalho impresso nem o rodapé. Elas são mostradas na proporção
// certa de uma folha A4, então dá para acertar olhando, e não no chute.

export type Margens = {
  margem_topo_mm: number
  margem_base_mm: number
  margem_esquerda_mm: number
  margem_direita_mm: number
}

const A4_LARGURA = 210
const A4_ALTURA = 297

export default function FolhaTimbrada({
  id, papelUrl, margens, onPapel, onMargem,
}: {
  id: string
  papelUrl: string | null
  margens: Margens
  onPapel: (url: string | null) => void
  onMargem: (campo: keyof Margens, valor: number) => void
}) {
  const pct = (mm: number, total: number) => `${(mm / total) * 100}%`

  const campo = (rotulo: string, chave: keyof Margens) => (
    <div>
      <label className="block text-[11px] font-semibold text-slate-500 mb-1">{rotulo}</label>
      <div className="flex items-center gap-1">
        <input type="number" min={0} max={120} step={1} value={margens[chave]}
          onChange={e => onMargem(chave, Number(e.target.value) || 0)}
          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
        <span className="text-[11px] text-slate-400">mm</span>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      <ImagemDoMedico
        id={id} campo="papel_url" valor={papelUrl}
        rotulo="Folha timbrada (a página inteira)" altura="h-28"
        dica="A folha como ela é impressa, em PNG ou JPG. É o fundo da carta."
        onTrocou={onPapel}/>

      {papelUrl && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {campo('Topo', 'margem_topo_mm')}
            {campo('Base', 'margem_base_mm')}
            {campo('Esquerda', 'margem_esquerda_mm')}
            {campo('Direita', 'margem_direita_mm')}
          </div>

          <div>
            <p className="text-[11px] font-semibold text-slate-500 mb-1.5">
              Onde o texto vai entrar
            </p>
            <div className="flex justify-center">
              {/* Proporção de A4 de verdade: o que se vê aqui é o que sai na
                  impressora, na mesma escala. */}
              <div className="relative bg-white border border-slate-200 shadow-sm"
                style={{ width: 210, height: 297 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={papelUrl} alt="folha timbrada"
                  className="absolute inset-0 w-full h-full object-fill"/>
                <div className="absolute border-2 border-dashed border-brand-500/70 bg-brand-500/10"
                  style={{
                    top: pct(margens.margem_topo_mm, A4_ALTURA),
                    bottom: pct(margens.margem_base_mm, A4_ALTURA),
                    left: pct(margens.margem_esquerda_mm, A4_LARGURA),
                    right: pct(margens.margem_direita_mm, A4_LARGURA),
                  }}/>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 text-center">
              A área marcada é onde o texto da carta cabe. Ajuste até ela ficar
              abaixo do cabeçalho impresso e acima do rodapé.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
