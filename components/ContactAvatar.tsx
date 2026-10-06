'use client'
import { useEffect, useState } from 'react'
import clsx from 'clsx'

const AVATAR_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-rose-500', 'bg-amber-500', 'bg-cyan-500']

export function avatarInitials(name?: string | null) {
  return name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?'
}

export function avatarColorFor(id: string) {
  const idx = (id?.charCodeAt(0) || 0) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}

// Endereços de foto que já falharam nesta sessão.
//
// v48.26 — Fica fora do componente de propósito. A foto do Instagram vem de um
// endereço assinado que expira, e a lista se redesenha a cada atualização: com
// a memória dentro do componente, cada redesenho tentava de novo o mesmo
// endereço quebrado, e o avatar piscava entre a foto vazia e as iniciais.
const FALHARAM = new Set<string>()

// Endereços de foto que JÁ CARREGARAM nesta sessão.
//
// v48.39 — Faltava a outra metade. A lista de conversas se refaz a cada
// atualização, e quando ela se refaz o componente nasce de novo, com
// "carregou = false": a foto some, o navegador a busca no cache, e ela volta.
// É rápido, mas dá um piscar a cada poucos segundos — foi o que apareceu
// depois do último deploy.
//
// Com esta lista, uma foto que já apareceu uma vez nasce visível. Sem esperar,
// sem piscar. A memória é da aba: ao recarregar a página tudo recomeça, o que
// é o certo, porque o endereço pode ter expirado.
const CARREGARAM = new Set<string>()

// Avatar com foto do contato, com as iniciais SEMPRE atrás.
//
// A foto é uma camada por cima. Enquanto ela não carrega — ou se nunca carregar
// — o que se vê são as iniciais, paradas. Antes a foto e as iniciais se
// alternavam, e o efeito na tela era um piscar.
export default function ContactAvatar({
  avatarUrl,
  name,
  id,
  sizeClass = 'w-9 h-9',
  textClass = 'text-xs',
  className,
  onClick,
}: {
  avatarUrl?: string | null
  name?: string | null
  id: string
  sizeClass?: string
  textClass?: string
  className?: string
  onClick?: () => void
}) {
  const url = avatarUrl || ''
  const [carregou, setCarregou] = useState(() => !!url && CARREGARAM.has(url))
  const [quebrou, setQuebrou] = useState(() => !!url && FALHARAM.has(url))

  useEffect(() => {
    // Só reage quando o endereço realmente muda — e mesmo aí, se já é uma foto
    // conhecida, entra visível.
    setCarregou(!!url && CARREGARAM.has(url))
    setQuebrou(!!url && FALHARAM.has(url))
  }, [url])

  const mostrarFoto = !!url && !quebrou
  const jaConhecida = !!url && CARREGARAM.has(url)

  return (
    <div
      onClick={onClick}
      className={clsx(
        sizeClass, 'relative rounded-full flex items-center justify-center text-white font-bold overflow-hidden shrink-0',
        textClass, avatarColorFor(id), onClick && 'cursor-pointer', className,
      )}
    >
      <span aria-hidden={carregou}>{avatarInitials(name)}</span>

      {mostrarFoto && (
        // referrerPolicy: o CDN do Instagram devolve 403 quando a requisição vai
        // com o endereço do CRM no cabeçalho. Sem isto, a foto de quem chega
        // pelo Instagram nunca carrega.
        //
        // loading: "lazy" só na primeira vez. Numa foto que já está no cache,
        // o carregamento preguiçoso é justamente o que atrasa o desenho e
        // produz o piscar.
        <img
          src={url}
          alt={name || ''}
          loading={jaConhecida ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => { CARREGARAM.add(url); setCarregou(true) }}
          onError={() => { FALHARAM.add(url); setQuebrou(true) }}
          className={clsx(
            'absolute inset-0 w-full h-full rounded-full object-cover',
            carregou ? 'opacity-100' : 'opacity-0',
            // Sem transição: a opacidade muda de uma vez. Uma foto que volta
            // do cache não deve "aparecer devagar" a cada atualização da lista.
            'transition-none',
          )}
        />
      )}
    </div>
  )
}
