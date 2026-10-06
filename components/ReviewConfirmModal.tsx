'use client'
import { Star, X } from 'lucide-react'

type Props = {
  contactName: string
  onConfirm: () => void
  onCancel: () => void
}

// Substitui o antigo window.confirm() nativo ao finalizar um atendimento
// pela secretária. O objetivo é deixar bem claro, visualmente, para quem
// está sendo enviado o link de avaliação — e evitar que cliques rápidos
// e repetidos (ex: fechando várias conversas em sequência) confirmem o
// envio sem querer, como aconteceu em 2026-08-04.
export default function ReviewConfirmModal({ contactName, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Enviar avaliação do Google?</h2>
          <button onClick={onCancel} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={16}/></button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
              <Star size={18} className="text-amber-500"/>
            </div>
            <p className="text-sm text-slate-600">
              Ao finalizar este atendimento, o link de avaliação do Google será
              enviado para <strong>{contactName}</strong>.
            </p>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <button
              onClick={onConfirm}
              className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              Sim, enviar avaliação para {contactName}
            </button>
            <button
              onClick={onCancel}
              className="w-full px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-xl transition-colors"
            >
              Não enviar, só finalizar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
