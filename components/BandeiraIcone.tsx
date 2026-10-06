// v47.17 — Marcas visuais simples para a secretária reconhecer a bandeira de
// relance. São desenhos geométricos nossos, nas cores de cada bandeira — não são
// os logotipos oficiais, que são marcas registradas e não cabe a nós reproduzir.
// Servem como apoio ao texto, que continua sendo o que identifica de verdade.

export default function BandeiraIcone({ bandeira, className = '' }: { bandeira: string; className?: string }) {
  if (bandeira === 'visa_master') {
    return (
      <svg viewBox="0 0 28 16" className={className} aria-hidden="true">
        <circle cx="10" cy="8" r="6" fill="#EB001B"/>
        <circle cx="18" cy="8" r="6" fill="#F79E1B" fillOpacity="0.9"/>
        <path d="M14 3.2a6 6 0 0 0 0 9.6 6 6 0 0 0 0-9.6z" fill="#FF5F00"/>
      </svg>
    )
  }
  if (bandeira === 'elo') {
    return (
      <svg viewBox="0 0 28 16" className={className} aria-hidden="true">
        <circle cx="8" cy="8" r="4.5" fill="#FFCB05"/>
        <circle cx="14" cy="8" r="4.5" fill="#EF4123" fillOpacity="0.9"/>
        <circle cx="20" cy="8" r="4.5" fill="#00A4E0" fillOpacity="0.9"/>
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 28 16" className={className} aria-hidden="true">
      <rect x="4" y="2" width="20" height="12" rx="2" fill="#006FCF"/>
      <rect x="7" y="6.5" width="14" height="1.6" fill="#fff"/>
      <rect x="7" y="9.5" width="9" height="1.6" fill="#fff" fillOpacity="0.75"/>
    </svg>
  )
}
