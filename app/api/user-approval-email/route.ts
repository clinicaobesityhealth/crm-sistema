import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import tls from 'node:tls'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    })
    const { data: { user } } = await supabase.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Sessão inválida' }, { status: 401 })
    const { data: caller } = await supabase.from('agents').select('role').eq('id', user.id).maybeSingle()
    if (caller?.role !== 'admin') return NextResponse.json({ error: 'Somente administradores' }, { status: 403 })

    const { email, name } = await req.json()
    if (!email || !name) return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
    const host = process.env.SMTP_HOST || 'smtpout.secureserver.net'
    const port = Number(process.env.SMTP_PORT || 465)
    const username = process.env.SMTP_USERNAME
    const password = process.env.SMTP_PASSWORD
    if (!username || !password) return NextResponse.json({ error: 'SMTP do CRM não configurado' }, { status: 503 })

    const from = process.env.SMTP_FROM || username
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.obesityhealth.com.br'
    const subject = 'Seu acesso ao CRM Obesity Health foi autorizado'
    const html = `<div style="font-family:Arial,sans-serif;color:#18371f;max-width:560px;margin:auto"><h2>Acesso autorizado</h2><p>Olá, <strong>${escapeHtml(String(name))}</strong>.</p><p>Seu acesso ao CRM Obesity Health foi autorizado. Você já pode entrar usando o email e a senha cadastrados ou uma conta Google vinculada.</p><p><a href="${appUrl}" style="display:inline-block;background:#18371f;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px">Acessar o CRM</a></p><p style="font-size:12px;color:#64748b">Mensagem automática da Obesity Health.</p></div>`
    await sendSmtp({ host, port, username, password, from, to: email, subject, html })
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha no envio' }, { status: 500 })
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char))
}

function sendSmtp(config: { host: string; port: number; username: string; password: string; from: string; to: string; subject: string; html: string }) {
  return new Promise<void>((resolve, reject) => {
    const socket = tls.connect({ host: config.host, port: config.port, servername: config.host, rejectUnauthorized: true })
    let buffer = ''
    const waiters: Array<(line: string) => void> = []
    socket.setEncoding('utf8')
    socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('Tempo limite do servidor SMTP')) })
    socket.on('error', reject)
    socket.on('data', chunk => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) if (/^\d{3} /.test(line)) waiters.shift()?.(line)
    })
    const response = () => new Promise<string>(res => waiters.push(res))
    const command = async (value: string, expected: number[]) => {
      socket.write(value + '\r\n')
      const line = await response()
      const code = Number(line.slice(0, 3))
      if (!expected.includes(code)) throw new Error(`SMTP recusou a operação (${code})`)
    }
    socket.once('secureConnect', async () => {
      try {
        const greeting = await response()
        if (!greeting.startsWith('220')) throw new Error('Servidor SMTP indisponível')
        await command('EHLO crm.obesityhealth.com.br', [250])
        await command('AUTH LOGIN', [334])
        await command(Buffer.from(config.username).toString('base64'), [334])
        await command(Buffer.from(config.password).toString('base64'), [235])
        await command(`MAIL FROM:<${config.from}>`, [250])
        await command(`RCPT TO:<${config.to}>`, [250, 251])
        await command('DATA', [354])
        const encodedSubject = `=?UTF-8?B?${Buffer.from(config.subject).toString('base64')}?=`
        const message = [`From: Obesity Health <${config.from}>`, `To: ${config.to}`, `Subject: ${encodedSubject}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', config.html.replace(/^\./gm, '..')].join('\r\n')
        await command(message + '\r\n.', [250])
        socket.write('QUIT\r\n')
        socket.end()
        resolve()
      } catch (error) { socket.destroy(); reject(error) }
    })
  })
}
