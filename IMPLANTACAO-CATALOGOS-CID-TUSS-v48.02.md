# v48.02 — Catálogos oficiais de CID-10 e TUSS no CRM

Os mesmos arquivos que você já usa no PausaMed passam a viver dentro do CRM:
**CID-10 do DATASUS (V2008, 12.451 códigos)** e **TUSS 22 da ANS (5.966
procedimentos, coleta de 26/08/2026)**.

A partir daqui, cadastrar uma cirurgia deixa de depender de digitar código de
cabeça. A secretária escreve *"hemorroidectomia"* e o 31004202 vem junto, com o
nome oficial que o convênio espera ler na guia.

## Ordem de implantação

**1.** Rode `20260914_cadastros_cirurgia_v48_01.sql` (se ainda não rodou).

**2.** Rode `20260914_catalogos_cid_tuss_v48_02.sql`.

**3.** Importe os dois CSV pelo **Table Editor** do Supabase:

- abra a tabela `cid_catalog` → *Insert* → *Import data from CSV* → `cid_catalog.csv`
- abra a tabela `tuss_catalog` → mesma coisa → `tuss_catalog.csv`

Os cabeçalhos dos arquivos já batem com os nomes das colunas, então o
mapeamento vem preenchido sozinho. Deixe `is_active` como está. São 18 mil
linhas no total — leva alguns minutos e é feito uma vez só.

*(Retirei a marca de codificação do começo dos arquivos originais. Com ela, o
importador do Supabase às vezes lê a primeira coluna como `﻿code` e não casa
com `code`. Use os CSV que mandei aqui, não os do zip original.)*

**4.** Suba o zip no EasyPanel.

## O que conferi nos códigos da planilha

Passei os treze TUSS e os doze CID da aba DADOS CARTAS contra os arquivos
oficiais, um por um.

**Os treze TUSS estão todos corretos.** O que mudou foi só o texto ao lado:
passa a ser o nome oficial do procedimento na tabela da ANS.

**Cinco CID estavam incompletos** — e este é o achado que importa. Estavam
gravados com três caracteres: `E66`, `K76`, `L05`, `K43`, `K60`. Nenhum desses
cinco existe como código faturável: quando a categoria tem subdivisões, a
CID-10 exige o quarto caractere, e o convênio devolve a guia que chega só com a
categoria.

Preenchi cada um com a opção mais provável, mas **a escolha é clínica e é sua**.
Estas são as alternativas oficiais:

| Cirurgia | Estava | Coloquei | Outras opções na CID-10 |
|---|---|---|---|
| BP / Sleeve | E66 | **E66.0** Obesidade devida a excesso de calorias | E66.1 induzida por drogas · E66.2 extrema com hipoventilação alveolar · E66.8 outra · E66.9 não especificada |
| Biópsia hepática | K76 | **K76.0** Degeneração gordurosa do fígado | K76.8 outras doenças especificadas · K76.9 sem outra especificação |
| Cisto sacro-coccígeo | L05 | **L05.9** Cisto pilonidal sem abscesso | L05.0 com abscesso |
| Herniorrafia epigástrica | K43 | **K43.9** Hérnia ventral sem obstrução ou gangrena | K43.0 com obstrução · K43.1 com gangrena |
| Hemorroidas | K60 | **K60.1** Fissura anal crônica | K60.0 aguda · K60.2 não especificada · K60.3 fístula anal |

Duas observações sobre esta tabela:

O **cisto pilonidal** está descrito na planilha como *"com fístula cutânea"*.
A CID-10 só oferece *com abscesso* (L05.0) e *sem abscesso* (L05.9) — fístula
não tem código próprio nesta categoria. Fiquei em L05.9; se o caso costuma vir
com abscesso, mude.

Em **hemorroidas**, a planilha traz dois diagnósticos (fissura anal e plicoma).
O I84.6 ficou como estava, correto. O K60 virou K60.1 porque a operação em
geral é de fissura crônica — se for aguda, é K60.0.

Nenhuma dessas correções precisa de mim: tudo é editável em
**Configurações → Cirurgias**, e agora com busca no catálogo oficial.

## Como fica a tela

Nos campos de TUSS e de CID, digitar três letras abre a lista do catálogo.
Clicar numa opção preenche código e descrição juntos.

A digitação livre continua funcionando. Se o catálogo ainda não foi importado,
ou se o código é de uma versão que não está nele, a tela avisa e deixa você
digitar à mão — nada trava.

O CID é gravado com ponto (K81.1), que é como aparece na guia e na carta,
mesmo que o arquivo do DATASUS traga sem (K811). A busca ignora o ponto dos
dois lados.
