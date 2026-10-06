# CRM Obesity Health — v42

## Incluído

- cadastro por email e senha com confirmação de email;
- fila de aprovação administrativa antes de liberar o CRM;
- aviso de novo cadastro para administradores;
- aviso visível também quando o administrador entra após o pedido;
- opção para recusar cadastro com motivo;
- preparação segura para vincular uma conta Google pendente a um usuário existente;
- aviso automático ao paciente ao entrar em atendimento privado;
- aviso automático ao sair do modo privado, preservando o histórico protegido;
- configuração de cargo, perfil e setores durante a aprovação;
- envio de email após a autorização;
- login e vínculo de identidade Google;
- menu Aniversariantes do dia sem abrir conversa automaticamente;
- histórico privado por setor exclusivo, preservado após transferências;
- correção v39 da agenda médica: consulta cancelada não bloqueia novo agendamento.

## Banco de dados

As migrações `supabase/migrations/20260725_user_registration_approval.sql`, `supabase/migrations/20260725_registration_decisions_v41.sql` e `supabase/migrations/20260725_patient_privacy_notifications_v42.sql` foram aplicadas no projeto CRM Obesity em 25/07/2026. Elas permanecem no código-fonte para auditoria e recuperação.

## Variáveis do Easypanel

Manter as variáveis Supabase existentes e acrescentar, como segredos:

- `SMTP_HOST=smtpout.secureserver.net`
- `SMTP_PORT=465`
- `SMTP_USERNAME=contato@obesityhealth.com.br`
- `SMTP_PASSWORD=` senha da caixa no Titan
- `SMTP_FROM=contato@obesityhealth.com.br`
- `NEXT_PUBLIC_APP_URL=https://crm.obesityhealth.com.br`

Ao criar a caixa `naoresponda@obesityhealth.com.br`, trocar `SMTP_USERNAME`, `SMTP_PASSWORD` e `SMTP_FROM` juntos.

## Vinculação Google

O provedor Google e **Allow manual linking** já estão ativados no Supabase.

Quando uma pessoa já cadastrada entrar por engano primeiro pelo Google, usar **Vincular a existente** na fila de aprovação. Essa ação remove somente o login novo pendente e libera a identidade. Depois, a pessoa entra pelo login antigo e usa **Meu perfil → Vincular conta Google**.
