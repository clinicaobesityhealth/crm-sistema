# Correção do cadastro no MedX — v46.26

- Valida os campos obrigatórios antes de criar o contato.
- Exibe carregamento e confirmação visual imediatamente após o clique.
- Captura falhas inesperadas para o botão nunca ficar travado silenciosamente.
- Interrompe a espera após 45 segundos e mostra uma mensagem clara.
- Se uma tentativa anterior já criou o contato no CRM, o mesmo telefone pode retomar
  o cadastro no MedX sem criar duplicidade.
- Bloqueia um novo cadastro quando o contato já possui `medx_id`.
- Só fecha a janela depois de o MedX retornar um identificador e o vínculo ser salvo no CRM.
- No cadastro manual, salva automaticamente o rascunho exigido pelo flow antes de
  chamar `cadastrar_paciente`; não depende mais de a Sofia ter chamado
  `salvar_dados_cadastro` anteriormente.
