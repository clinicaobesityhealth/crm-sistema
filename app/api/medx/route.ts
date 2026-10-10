import { NextRequest, NextResponse } from 'next/server'

// Proxy server-side para os webhooks n8n (evita CORS no navegador)
const WH_PACIENTE = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/tool-buscar-paciente'
const WH_AGENDA = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/buscar_agendamento'

// v48.178 — Segunda checagem (além da que o fluxo n8n já faz) antes de aceitar
// um paciente como "encontrado": casos reais em que o CRM trocou o cadastro
// certo por outro de nome parecido ("Marcia Valeria" -> "Marcia Cristina";
// "Bruna Puggina" -> "Bruna Polidoro"). Isso acontece quando o nome salvo no
// CRM é só o primeiro nome (comum — é o nome de exibição do WhatsApp) e há
// mais de uma pessoa com esse primeiro nome no MedX: nesse caso um primeiro
// nome igual não confirma nada. Quando o telefone do cadastro encontrado não
// é o mesmo telefone do contato que estamos buscando, não aceita o match.
function semAcentos(s: string): string { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '') }
function normTexto(s: string): string { return semAcentos(s || '').toLowerCase().trim().replace(/\s+/g, ' ') }
function normTelefoneDigitos(v: any): string { const d = String(v || '').replace(/\D/g, ''); return d.length > 11 ? d.slice(-11) : d }

export async function POST(req: NextRequest) {
  try {
    const { nome, telefone, cpf } = await req.json()

    // Corrige acentos quebrados (MedX às vezes manda ? no lugar de acentos)
    function fixAcentos(s: any): any {
      if (typeof s !== 'string') return s
      return s
    }

    // Chama os dois webhooks do servidor (sem CORS)
    const [pacRes, agRes] = await Promise.allSettled([
      fetch(WH_PACIENTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, telefone, cpf }),
      }),
      fetch(WH_AGENDA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome_paciente: nome, telefone }),
      }),
    ])

    let paciente: any = null
    let agendamentos: any[] = []
    const debug: any = {}

    if (pacRes.status === 'fulfilled') {
      const buf = await pacRes.value.arrayBuffer()
      const txt = new TextDecoder('utf-8').decode(buf)
      debug.paciente_status = pacRes.value.status
      if (txt) { try { const j = JSON.parse(txt); paciente = Array.isArray(j) ? j[0] : j } catch {} }
    } else {
      debug.paciente_erro = String(pacRes.reason)
    }

    // v48.178 — ver comentário da função normTelefoneDigitos acima. Só entra em ação
    // quando o nome informado tem só o primeiro nome E temos um telefone pra conferir;
    // nome completo continua confiando na validação que já existe no fluxo do MedX.
    if (paciente?.resultado === 'encontrado' && paciente.Id_do_Cliente) {
      const tokensNome = normTexto(nome).split(' ').filter((t: string) => t.length > 2)
      const telEntrada = normTelefoneDigitos(telefone)
      if (tokensNome.length <= 1 && telEntrada) {
        const telPaciente = normTelefoneDigitos(paciente.celular) || normTelefoneDigitos(paciente.telefone)
        if (telPaciente && telPaciente !== telEntrada) {
          debug.paciente_rejeitado_telefone_nao_confere = { nome, telefone, medx_id: paciente.Id_do_Cliente, medx_nome: paciente.nome }
          paciente = {
            resultado: 'nao_encontrado',
            mensagem: 'Encontrado um cadastro no MedX com o mesmo primeiro nome, mas o telefone não confere com o contato — não vinculando automaticamente para evitar associar a pessoa errada. Confirme os dados (nome completo, CPF ou telefone) com o paciente.',
          }
        }
      }
    }
    if (agRes.status === 'fulfilled') {
      const buf = await agRes.value.arrayBuffer()
      const txt = new TextDecoder('utf-8').decode(buf)
      debug.agenda_status = agRes.value.status
      debug.agenda_raw = txt.slice(0, 300)
      if (txt) { try { const j = JSON.parse(txt); agendamentos = Array.isArray(j) ? j : [j] } catch {} }
    } else {
      debug.agenda_erro = String(agRes.reason)
    }

    return NextResponse.json({ paciente, agendamentos, debug })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erro' }, { status: 500 })
  }
}
