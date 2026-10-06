# CRM Obesity v46.38 — aviso antes da entrada do administrador

## Alteração

Ao tentar abrir a conversa de um paciente que já está em atendimento, o administrador passa a receber um aviso informando:

- o nome do paciente;
- o nome do profissional ou atendente responsável;
- que sua entrada será como participante;
- que o responsável atual continuará com o atendimento ativo e será avisado.

O administrador pode cancelar ou confirmar em **Entrar na conversa**. A entrada sem autorização do responsável continua permitida, conforme a regra existente, mas não acontece mais sem aviso prévio.

Antes de confirmar, o CRM consulta novamente o estado do atendimento para evitar usar uma informação desatualizada.

## Implantação

Suba o ZIP no Easypanel como nas versões anteriores. Não há SQL nem alteração de flow n8n nesta versão.
