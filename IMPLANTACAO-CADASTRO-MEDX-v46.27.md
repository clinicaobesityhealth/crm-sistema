# Cadastro manual no MedX — v46.27

Correção específica para o erro “dados não encontrados no rascunho de cadastro”.

O botão do CRM agora executa automaticamente:

1. validação dos campos obrigatórios;
2. `tool-salvar-dados-cadastro` com todos os dados preenchidos;
3. confirmação de que o rascunho foi salvo;
4. `tool-cadastrar-paciente` com o `contact_id`;
5. gravação do identificador retornado pelo MedX no contato.

Também aceita respostas do n8n em objeto ou lista, mostra o erro da etapa exata e
permite retomar um contato que já tenha sido criado no CRM por uma tentativa anterior.
