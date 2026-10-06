// Ícone do Instagram desenhado à mão (lucide-react não garante ter um ícone de marca
// disponível em todas as versões), com a mesma assinatura de props dos ícones do lucide
// (size, className, etc) para poder ser usado de forma intercambiável.
type Props = {
  size?: number | string
  className?: string
  color?: string
  strokeWidth?: number | string
}

export default function InstagramIcon({ size = 24, className = '', color = 'currentColor', strokeWidth = 2 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
    </svg>
  )
}
