// Selo de canal (WhatsApp/Instagram) exibido no canto da foto do contato,
// para diferenciar rapidamente de onde veio a conversa.
type ChannelBadgeProps = {
  channel?: string | null
  accountName?: string | null
  size?: number
  className?: string
}

export default function ChannelBadge({ channel, accountName, size = 16, className = '' }: ChannelBadgeProps) {
  const isInstagram = channel === 'instagram'
  const title = isInstagram
    ? `Instagram${accountName ? ' · ' + accountName : ''}`
    : 'WhatsApp'
  const iconSize = Math.round(size * 0.62)

  return (
    <div
      title={title}
      className={`absolute -bottom-0.5 -right-0.5 rounded-full flex items-center justify-center border-2 border-white shadow-sm ${className}`}
      style={{
        width: size,
        height: size,
        background: isInstagram
          ? 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)'
          : '#25D366',
      }}
    >
      {isInstagram ? (
        <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill="white">
          <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.71 14.02c-.24.68-1.19 1.25-1.94 1.4-.53.11-1.22.19-3.56-.76-2.99-1.23-4.92-4.27-5.07-4.47-.15-.2-1.21-1.61-1.21-3.07 0-1.46.76-2.17 1.03-2.47.27-.3.59-.37.79-.37h.57c.18 0 .43-.01.65.5.27.63.9 2.19.98 2.35.08.16.13.35.03.55-.11.2-.16.32-.32.5-.16.18-.34.4-.48.54-.16.16-.33.34-.14.66.19.33.85 1.4 1.83 2.27 1.26 1.12 2.32 1.47 2.65 1.63.33.16.52.13.71-.08.19-.21.81-.94 1.03-1.26.22-.32.44-.27.74-.16.3.11 1.9.9 2.23 1.06.33.16.54.24.62.38.08.13.08.78-.16 1.46z"/>
        </svg>
      )}
    </div>
  )
}
