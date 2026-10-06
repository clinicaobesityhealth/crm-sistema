# v48.06 — Aviso de ambiente de testes

**Sem SQL.** É só subir o zip.

## O diagnóstico, fechado

A chave está correta. O código está correto. O que faltava era o endereço: a
credencial emitida no portal `developers.safrapay.com.br` vale **só em
homologação**, e o CRM estava apontando para produção. Daí o HTTP 401 em 44 ms
— recusa imediata, porque naquele ambiente a chave simplesmente não existe.

## O risco que aparece agora

Em homologação o link abre, a página do Banco Safra aparece, o paciente
preenche o cartão e vê "pagamento concluído". **E nenhum dinheiro é cobrado.**

É um erro pior do que o anterior, porque não dá sinal nenhum: a cobrança some
sem aviso, e a clínica só descobre quando o valor não cai na conta — dias
depois, com o paciente achando que já pagou.

Por isso a janela de cobrança no cartão agora mostra uma tarja âmbar enquanto o
ambiente estiver em homologação, dizendo em letras claras que nenhum valor é
cobrado de verdade. A secretária não consegue mais enviar uma cobrança de teste
para um paciente real sem ver o aviso.

A mensagem de erro do 401 também ficou específica: quando o ambiente é produção,
ela já diz que a chave do portal developers só vale em homologação. Se isso
acontecer de novo, a resposta vem junto com o erro.

## O que dá para fazer agora, e o que não dá

**Dá para testar tudo.** Link, escolha de parcelas, página do Safra, retorno
para o CRM, valores por bandeira. Vale treinar a secretária no fluxo completo —
em homologação ninguém é cobrado por engano.

**Não dá para cobrar de verdade** até a Safrapay liberar as credenciais de
produção.

## Para liberar a produção

É pedido a eles. Ao falar com a Safrapay, os termos que abrem a porta são
**"homologação da API de Link de Pagamentos"** e **"credenciais de produção"**.
A integração já está pronta e funcionando — é o que eles precisam verificar.

Quando as credenciais de produção chegarem: Configurações → Cobrança, cole o
novo Merchant Token, troque o Ambiente para Produção, **salve**, e clique em
Testar conexão antes de mandar qualquer cobrança. Se o teste passar, a tarja
âmbar desaparece sozinha — é o sinal de que passou a valer dinheiro de verdade.
