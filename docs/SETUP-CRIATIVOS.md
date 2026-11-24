# Setup do gerador de criativos (passo a passo)

Para quem acabou de receber o link do repositório. **Siga na ordem.** Leva de 20 a 30 minutos na primeira vez; depois, criar um criativo é só pedir ao Claude.

## O que isto faz

Você escreve (ou cola) a copy e o Claude monta o roteiro em cenas, escreve os prompts, **gera as cenas de vídeo no Google Flow** e entrega os arquivos MP4 verticais (9:16) na pasta `criativos/`. Funciona para **novelinha** (história com personagens) e **UGC** (pessoa falando para a câmera).

Duas coisas custam dinheiro/limite, e o Claude **sempre mostra o custo e pede o seu ok antes de gastar**:
- **Créditos do Flow:** vídeo de 8 s em x2 (2 versões para você escolher) = **48 créditos**. Imagens (personagens) são grátis.
- **Limite do Claude:** o modo script (padrão) gasta pouquíssimo. Detalhes em `docs/CUSTOS-CLAUDE-CODE.md`.

## 1. O que você precisa ter

- [ ] **Computador** com Windows 10/11, macOS ou Linux.
- [ ] **O link do repositório** (por enquanto ele é público: não precisa de conta no GitHub nem de convite).
- [ ] **Claude**, em um destes formatos (qualquer um serve):
  - **Claude Desktop**, na aba **Code** (https://claude.com/download), ou
  - **VS Code** com a extensão **Claude Code**, ou
  - **Claude Code** no terminal.
  Precisa de uma assinatura do Claude que inclua o Claude Code (Pro ou Max).
- [ ] **Conta Google com plano do Flow** e créditos (https://flow.google.com; o saldo aparece ao clicar no seu avatar, canto superior direito). Esta é a conta que vai gastar os créditos.
- [ ] **Google Chrome** (https://www.google.com/chrome). O script usa o Chrome; outros navegadores não servem.

## 2. Instalar os programas

Você precisa de **Git**, **Node.js**, **ffmpeg** e **jq**. Escolha o seu sistema.

### Windows

Abra o **PowerShell** (menu Iniciar, digite "PowerShell") e cole:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Gyan.FFmpeg -e
winget install --id jqlang.jq -e
```

Depois **feche e abra o PowerShell/VS Code/Claude de novo** (para o Windows enxergar os programas novos). O Claude Code no Windows usa o Git Bash, que vem junto com o Git: não precisa fazer nada além de instalar o Git.

### macOS

Abra o **Terminal** e cole (se não tiver o Homebrew, instale em https://brew.sh primeiro):

```bash
brew install git node ffmpeg jq
```

### Linux (Ubuntu/Debian)

```bash
sudo apt update && sudo apt install -y git nodejs npm ffmpeg jq bsdmainutils
```

(O Node precisa ser versão 18 ou maior: confira com `node -v`.)

## 3. Baixar o projeto

No terminal (PowerShell no Windows), vá para a pasta onde quer guardar o projeto e rode:

```bash
git clone https://github.com/melointhecloud/gerador-criativo.git
cd gerador-criativo
```

Não precisa entrar no GitHub. Se aparecer "repository not found", o Lucas pode ter voltado o repositório para privado: peça a ele o acesso.

## 4. Abrir no Claude

Abra a **pasta `gerador-criativo`** (não a pasta de cima):
- **Claude Desktop:** aba **Code** → escolha a pasta.
- **VS Code:** *File → Open Folder* → abra o Claude Code (ícone do Claude na barra lateral).
- **Terminal:** `claude` dentro da pasta.

## 5. Rodar o setup guiado

No Claude, digite:

```
/setup-criativos
```

Ele confere o seu computador, instala o que faltar **(pergunta antes)**, abre o Chrome para você entrar no Flow, faz uma demonstração sem custo e te explica o resto. **Se esse comando não aparecer** (alguns apps não listam comandos de projeto), cole este texto no Claude:

> Configure este repositório para eu usar o gerador de criativos. Rode `.claude/skills/criativo-tiktok-flow/scripts/doctor.sh`, me ajude a corrigir tudo que falhar (inclusive `npm install` em `.claude/skills/criativo-tiktok-flow/scripts/flow`), me guie no login do Flow com `node .claude/skills/criativo-tiktok-flow/scripts/flow/flow.mjs login`, mostre a estimativa de créditos do criativo de exemplo e me explique como criar meu primeiro criativo. Não gaste créditos nesta etapa.

O que o setup faz, caso queira fazer na mão:

1. `bash .claude/skills/criativo-tiktok-flow/scripts/doctor.sh` — confere ferramentas e arquivos. Tem que terminar com "tudo certo".
2. `cd .claude/skills/criativo-tiktok-flow/scripts/flow && npm install` — instala o script (uma vez).
3. `node .claude/skills/criativo-tiktok-flow/scripts/flow/flow.mjs login` — **abre uma janela do Chrome**. Entre com a conta Google do Flow (a que tem os créditos), aceite os termos do Flow se pedir e espere o terminal mostrar o seu saldo. **O login fica salvo; não precisa repetir.** Essa janela é um Chrome separado do seu Chrome normal (perfil `~/.chrome-flow`).

## 6. Criar o projeto no Flow

Cada criativo usa um **projeto** no Flow:

1. Na janela do Chrome do script, abra https://flow.google.com e clique em **Novo projeto**.
2. Copie a **URL da barra de endereço** (`https://flow.google.com/project/...`). O Claude vai pedir esse link.

## 7. Criar o primeiro criativo

Peça ao Claude, em português:

> Criar um criativo de novelinha com esta copy: (cole a copy)

O fluxo, com **a sua aprovação em cada etapa**:

1. **Briefing:** copy, modo (novelinha ou UGC), duração, saldo de créditos.
2. **Personagens** (novelinha): o Claude escreve o prompt de cada personagem. Você cola no Flow (modo **Imagem**, 9:16, **Nano Banana Pro**, x2), escolhe a imagem frontal e neutra, e avisa o Claude. Imagens são **grátis**.
3. **Roteiro** em cenas: você ajusta em linguagem natural até aprovar.
4. **Prompts e custo:** o Claude mostra quantos créditos o criativo vai gastar.
5. **Geração:** você dá o ok e o Claude roda **um comando que gera todas as cenas sozinho** (leva ~1 a 2 minutos por cena; não precisa fazer nada). No fim ele entrega os links das 2 versões de cada cena e, se você autorizar, baixa os arquivos em `criativos/<oferta>-<data>/cenas/` (versão 1) e `cenas/alternativas/` (versão 2).
6. **Checagem:** o Claude confere formato, áudio e duração de cada cena.

**Dicas importantes**
- **Comece com 1 a 3 cenas** antes de gerar um criativo inteiro.
- Um criativo de 3 minutos (~23 cenas) custa **~1.100 créditos**: confira o seu plano antes (`.claude/skills/criativo-tiktok-flow/references/flow.md` tem a tabela).
- Gere em **lotes de até 6 cenas** (o Claude já faz assim): se algo falhar, ele retoma de onde parou **sem gastar duas vezes**.
- **Baixe as cenas aprovadas no mesmo dia**: o Flow apaga criações antigas.
- A edição final (legenda, trilha, montagem) ainda **não** está integrada: por enquanto o resultado são as cenas separadas.

## Regras do time

- O repositório está **público por enquanto** (o Lucas decide quando voltar a privado). Por isso **nunca** coloque no Git chaves, senhas, o `.env`, vídeos, links de projetos do Flow nem dados de clientes ou ofertas reais (o `.gitignore` já cobre vídeos e o estado do script). Não passe o link para quem não é do time.
- Não rode nada em massa e não gere vários criativos ao mesmo tempo na mesma conta: o ritmo normal (uma cena por vez) é o que o script faz.
- O Claude nunca gasta créditos sem mostrar o valor e receber o seu ok. Se ele pedir para gastar mais do que você esperava, **recuse e pergunte**.
- Depois de baixar o projeto, puxe as novidades de tempos em tempos com `git pull` (o Lucas melhora a ferramenta).

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `/setup-criativos` não aparece | Cole o prompt do passo 5. |
| Doctor diz "FALTA node/ffmpeg/jq" | Refaça o passo 2 e **feche e abra o terminal/app** de novo. |
| `command not found: bash` no Windows | Instale o Git (passo 2) e reabra o Claude: ele traz o Git Bash. |
| "Não consegui conectar ao Chrome" / Chrome abre e fecha | Feche **todas** as janelas do Chrome do script (o perfil `~/.chrome-flow`) e rode de novo. Se persistir, reinicie o computador. |
| "O Chrome do Flow não está logado" | Rode o `login` do passo 5 de novo. |
| "Modelo selecionado é ..., esperado Omni 1.2 Flash" | No Flow, troque o modelo de vídeo para **Omni 1.2 Flash** (Elementos, 9:16, 720p, x2) e rode de novo. |
| "Custo mostrado: N créditos; esperado 48" | O Flow mudou o preço. **Pare**, avise o Lucas e confira `references/flow.md`. O script não envia nesse caso. |
| "Saldo X < Y créditos necessários" | Faça menos cenas (`--cenas 1-3`) ou espere a renovação do plano. |
| Uma cena falhou no meio | Peça ao Claude para rodar o mesmo comando de novo: ele pula as cenas prontas. |
| "Referência não encontrada" / personagem errado na cena | Peça ao Claude para listar as imagens do projeto (`flow.mjs imagens`) e conferir o `flowRef` de cada personagem. |
| O script quebrou depois de o Flow mudar a tela | Peça ao Claude para usar o **modo assistido** (ele opera o Flow pelo Chrome; precisa da extensão Claude in Chrome) e avise o Lucas. |
| O Google pediu verificação / bloqueou o login | Faça a verificação na janela do Chrome do script, no seu ritmo, e tente de novo. Não insista várias vezes seguidas. |

## Onde está cada coisa

- `.claude/skills/criativo-tiktok-flow/SKILL.md`: as regras e o fluxo que o Claude segue.
- `.claude/skills/criativo-tiktok-flow/references/flow-script.md`: como funciona o modo script.
- `.claude/skills/criativo-tiktok-flow/references/flow.md`: tabela de custos e passo a passo do Flow.
- `.claude/skills/criativo-tiktok-flow/references/flow-assistido.md`: modo assistido (Claude operando o Chrome).
- `docs/CUSTOS-CLAUDE-CODE.md`: quanto do limite do Claude cada modo consome.
- `criativos/emagrecimento-teste-20261119/`: um criativo de exemplo completo (briefing, roteiro, prompts, notas).
