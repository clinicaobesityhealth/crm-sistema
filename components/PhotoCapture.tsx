'use client'
import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Camera, Upload, X, Loader2, RotateCcw, Check } from 'lucide-react'
import clsx from 'clsx'

type Props = {
  currentUrl?: string | null
  onUploaded: (url: string) => void
  shape?: 'circle' | 'square'
  size?: number
}

export default function PhotoCapture({ currentUrl, onUploaded, shape = 'circle', size = 96 }: Props) {
  const [mode, setMode] = useState<'idle' | 'camera' | 'preview'>('idle')
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [streamActive, setStreamActive] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  function handleFileSelect(file: File) {
    setError('')
    setCapturedBlob(file)
    setPreviewUrl(URL.createObjectURL(file))
    setMode('preview')
  }

  async function openCamera() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      setMode('camera')
      setStreamActive(true)
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
      }, 50)
    } catch {
      setError('Não foi possível acessar a câmera. Verifique as permissões do navegador.')
    }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setStreamActive(false)
  }

  function capturePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1) // espelha, como um espelho real
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (blob) {
        setCapturedBlob(blob)
        setPreviewUrl(URL.createObjectURL(blob))
        setMode('preview')
        closeCamera()
      }
    }, 'image/jpeg', 0.9)
  }

  function reset() {
    closeCamera()
    setMode('idle')
    setCapturedBlob(null)
    setPreviewUrl(null)
    setError('')
  }

  async function confirmUpload() {
    if (!capturedBlob) return
    setUploading(true)
    setError('')

    // Extrai o nome do arquivo existente da URL atual para substituir
    let fileName: string
    if (currentUrl) {
      // Tenta reusar o mesmo caminho para substituir (upsert)
      const match = currentUrl.match(/agent-photos\/(.+)$/)
      fileName = match ? match[1] : `photo_${crypto.randomUUID()}.jpg`
    } else {
      const ext = capturedBlob instanceof File ? (capturedBlob.name.split('.').pop() || 'jpg') : 'jpg'
      fileName = `photo_${crypto.randomUUID()}.${ext}`
    }

    const { error: uploadError } = await supabase.storage
      .from('agent-photos')
      .upload(fileName, capturedBlob, {
        contentType: capturedBlob.type || 'image/jpeg',
        upsert: true  // substitui se já existir
      })

    if (uploadError) {
      setError('Falha ao enviar a foto. Tente novamente.')
      setUploading(false)
      return
    }

    // Adiciona timestamp para bustar o cache do browser
    const { data } = supabase.storage.from('agent-photos').getPublicUrl(fileName)
    onUploaded(data.publicUrl + '?t=' + Date.now())
    setUploading(false)
    reset()
  }

  const dimension = `${size}px`
  const radiusClass = shape === 'circle' ? 'rounded-full' : 'rounded-xl'

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
      />
      <canvas ref={canvasRef} className="hidden"/>

      {mode === 'idle' && (
        <div className="flex items-center gap-4">
          <div
            style={{ width: dimension, height: dimension }}
            className={clsx('flex-shrink-0 bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center', radiusClass)}>
            {currentUrl ? (
              <img src={currentUrl} alt="Foto atual" className="w-full h-full object-cover"/>
            ) : (
              <Camera size={size * 0.35} className="text-slate-300"/>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
              <Upload size={13}/> Enviar arquivo
            </button>
            <button
              onClick={openCamera}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
              <Camera size={13}/> Tirar foto
            </button>
          </div>
        </div>
      )}

      {mode === 'camera' && (
        <div className="space-y-3">
          <div className="relative w-full max-w-xs rounded-xl overflow-hidden bg-slate-900 aspect-square">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]"/>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
              <X size={13}/> Cancelar
            </button>
            <button
              onClick={capturePhoto}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg">
              <Camera size={13}/> Capturar
            </button>
          </div>
        </div>
      )}

      {mode === 'preview' && previewUrl && (
        <div className="space-y-3">
          <div
            style={{ width: dimension, height: dimension }}
            className={clsx('overflow-hidden border border-slate-200', radiusClass)}>
            <img src={previewUrl} alt="Pré-visualização" className="w-full h-full object-cover"/>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={reset}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">
              <RotateCcw size={13}/> Refazer
            </button>
            <button
              onClick={confirmUpload}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50">
              {uploading ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>}
              Usar esta foto
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}
