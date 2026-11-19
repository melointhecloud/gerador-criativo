# Modo assistido: Claude opera o Flow pelo Chrome

Usado e aprovado em 2026-11-19 (3 cenas de novelinha, fala pt-BR e lip sync ok). Só use quando o usuário pedir. A conta é a do próprio usuário, já logada no Chrome.

## Pré-requisitos

- Extensão **Claude in Chrome** conectada (`mcp__claude-in-chrome__*`). Carregue as ferramentas com UMA chamada de ToolSearch e comece por `tabs_context_mcp`.
- Usuário logado em https://flow.google.com, com saldo de créditos (avatar, canto superior direito).
- Um projeto do Flow para o criativo. Abra uma aba nova do grupo e navegue até o projeto; feche as abas que você abriu ao terminar.

## Regras

1. **Créditos só com autorização do usuário** para aquela geração ou lote ("gere a cena 1", "até a cena 3"). Imagens são grátis e podem ser geradas sem perguntar.
2. **Antes de cada envio de vídeo, abra o seletor de configuração e leia "A geração vai usar N créditos".** Se N for diferente do esperado (48 para 8s x2 em 720p), pare e avise.
3. **Confira modelo, duração, 720p, 9:16 e x2 em toda geração.** O seletor guarda o último valor (já ficou em Veo 3.1 Lite e 5s).
4. Digite o prompt em **uma linha só**: Enter envia o comando.
5. Não clique em "Ativar" (retenção), "Fazer upgrade", "Gerenciar assinatura" nem em nada que mude a conta.
6. **Download exige ok explícito** do usuário. Sem ok, entregue só os links.
7. Você vê só quadros parados: nunca declare que fala, voz ou lip sync estão bons. Quem avalia é o usuário.
8. Termine conferindo o saldo e registrando em `notas.md` do criativo: links, créditos gastos, saldo final.

## Sequência que funcionou

1. **Personagem (grátis).** Config: Imagem, 9:16, Nano Banana Pro, x2. Cole o prompt do personagem, envie, aguarde ~20 s, escolha a imagem frontal e neutra.
2. **Config de vídeo.** Botão de config da caixa de prompt (ex.: "Vídeo · 720p · 8s · x2") → Vídeo, Elementos, 9:16, Omni 1.2 Flash, 720p, duração (controle deslizante), x2.
3. **Referências.** Botão "+" → escolher a imagem do personagem → "Incluir no comando". Repita para cada personagem da cena. A lista é por recência e muda de ordem: **confira a prévia** antes de incluir.
4. **Prompt da cena** (`prompts/cena-NN.txt`, em uma linha) → conferir os créditos → enviar (seta).
5. **Aguardar ~1 minuto** (as 2 saídas ficam em % de progresso e depois viram miniaturas com o botão de play).
6. **Links:** clicar na miniatura abre `/edit/<id>`; a URL é o link da saída. Voltar (`navigate back`) e abrir a outra.
7. **Saldo:** avatar → "N créditos do Google Flow".

## Dicas de interface

- A tela mexe de posição quando o aviso azul de retenção some: tire screenshot antes de clicar por coordenada.
- Cliques logo após navegar podem cair antes da página carregar: espere alguns segundos.
- Cena com dois falantes: marque quem é quem pela roupa no prompt, porque as referências não têm nome.
