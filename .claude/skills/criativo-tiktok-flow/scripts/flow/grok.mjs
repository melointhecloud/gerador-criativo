#!/usr/bin/env node
// Automação do Grok Imagine (grok.com/imagine) num Chrome com a conta já logada.
// Não gasta a cota do plano sem --sim. Guia: references/grok-script.md
//
//   node grok.mjs criativo <pasta> [--cenas 1-6] [--x 1] [--sim] [--baixar]
//   node grok.mjs enviar --prompt <txt> [--imagem quadro.png] [--imagem-fim quadro.png] [--mencoes Marina,Carla] [--duracao 8] [--dry-run]
//   node grok.mjs login
//   node grok.mjs saldo
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, delimiter, relative, dirname } from 'node:path';
import { parseArgs } from 'node:util';

const { positionals, values: a } = parseArgs({
  allowPositionals: true,
  options: {
    prompt: { type: 'string' },
    imagem: { type: 'string' },
    'imagem-fim': { type: 'string' },
    mencoes: { type: 'string' },
    duracao: { type: 'string' },
    resolucao: { type: 'string', default: '720p' },
    x: { type: 'string', default: '1' },
    'dry-run': { type: 'boolean', default: false },
    aguardar: { type: 'string', default: '300' },
    cenas: { type: 'string' },
    sim: { type: 'boolean', default: false },
    baixar: { type: 'boolean', default: false },
    cdp: { type: 'string', default: process.env.GROK_CDP || 'http://localhost:9334' },
    saida: { type: 'string', default: process.env.GROK_OUT || join(tmpdir(), 'grok-cli') },
  },
});
const cmd = positionals[0];
mkdirSync(a.saida, { recursive: true });

const log = (...m) => console.error('[grok]', ...m);
const fail = (msg, extra = {}) => {
  console.log(JSON.stringify({ ok: false, erro: msg, ...extra }));
  process.exit(1);
};
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const PERFIL = process.env.GROK_PERFIL || join(homedir(), '.chrome-grok');
const IMAGINE = 'https://grok.com/imagine';
const DURACOES = [6, 10, 15];

// A tela do Imagine só oferece 6s, 10s e 15s. Sobe para a opção que cobre o número pedido.
export function duracaoGrok(segundos) {
  const n = Number(segundos);
  if (!Number.isFinite(n) || n <= 0) return null;
  return DURACOES.find((d) => d >= n) ?? DURACOES.at(-1);
}

// ~2,5 palavras por segundo cabem numa fala natural. Até 2,8 ainda não soa acelerado.
// Passar disso escolhe a duração seguinte. Acima de 15s a cena precisa ser dividida.
const RITMO = 2.5;
const RITMO_MAX = 2.8;
const PALAVRAS_POR_TURNO = 2;

export function contarFala(fala) {
  const bruto = String(fala ?? '').trim();
  if (!bruto) return { palavras: 0, turnos: 0 };
  const rotulos = bruto.match(/(^|\s)[\p{Lu}]{2,}:/gu) || [];
  const semRotulo = bruto.replace(/(^|\s)[\p{Lu}]{2,}:/gu, ' ');
  const palavras = semRotulo.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length;
  return { palavras, turnos: palavras ? Math.max(1, rotulos.length) : 0 };
}

// Com fala, a duração é a menor opção em que a frase cabe sem pressa.
// Sem fala, vale o segundos do roteiro (cena de ação).
export function duracaoDaFala(fala, segundosRoteiro) {
  const { palavras, turnos } = contarFala(fala);
  if (!palavras) {
    const duracao = duracaoGrok(segundosRoteiro);
    return { duracao, palavras: 0, turnos: 0, ideal: duracao, apertado: false, pelaFala: false };
  }
  const carga = palavras + Math.max(0, turnos - 1) * PALAVRAS_POR_TURNO;
  const ideal = Math.round((carga / RITMO) * 10) / 10;
  const duracao = DURACOES.find((d) => carga / d <= RITMO_MAX) ?? DURACOES.at(-1);
  return { duracao, palavras, turnos, ideal, apertado: carga / duracao > RITMO_MAX, pelaFala: true };
}

export function aplicarDuracaoNoPrompt(texto, duracao) {
  return String(texto).replace(/Duração:\s*\d+(?:[.,]\d+)?\s*segundos/gi, `Duração: ${duracao} segundos`);
}

const nn = (n) => String(n).padStart(2, '0');

// grokRef vira o chip @ no prompt. Imagem sem grokRef não serve: o retrato como primeiro quadro travaria a cena na foto de estúdio.
export function mencoesDaCena(personagens, ids) {
  const porId = new Map((personagens ?? []).map((p) => [p.id, p]));
  const refs = [];
  const problemas = [];
  for (const id of ids ?? []) {
    const p = porId.get(id);
    if (!p) { problemas.push(`personagem "${id}" não está no elenco`); continue; }
    if (p.grokRef) {
      const nome = String(p.grokRef).trim();
      if (nome && !refs.includes(nome)) refs.push(nome);
    } else if (p.imagem) {
      problemas.push(`${p.nome || id} tem imagem e não tem grokRef`);
    }
  }
  return { refs, problemas };
}

function intervalo(txt, todas) {
  if (!txt) return todas;
  const set = new Set();
  for (const parte of txt.split(',')) {
    const [de, ate] = parte.split('-').map(Number);
    for (let i = de; i <= (ate || de); i++) set.add(i);
  }
  return todas.filter((n) => set.has(n));
}

// ---------- conexão ----------

async function tentarConectar() {
  try { return await chromium.connectOverCDP(a.cdp); } catch { return null; }
}

function acharChrome() {
  if (process.env.GROK_CHROME || process.env.FLOW_CHROME) return process.env.GROK_CHROME || process.env.FLOW_CHROME;
  const so = process.platform;
  const candidatos =
    so === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : so === 'win32' ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map((d) => join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const c of candidatos) {
    if (c.includes('/') || c.includes('\\')) { if (existsSync(c)) return c; continue; }
    for (const d of (process.env.PATH || '').split(delimiter)) if (d && existsSync(join(d, c))) return join(d, c);
  }
  return null;
}

async function conectar() {
  let browser = await tentarConectar();
  if (!browser) {
    const porta = new URL(a.cdp).port || '9334';
    const chrome = acharChrome();
    if (!chrome) fail('Não achei o Google Chrome. Instale em https://www.google.com/chrome (ou defina GROK_CHROME).');
    log(`Abrindo o Chrome do Grok (perfil ${PERFIL}, porta ${porta})...`);
    const filho = spawn(chrome, [
      `--remote-debugging-port=${porta}`,
      `--user-data-dir=${PERFIL}`,
      '--no-first-run',
      '--disable-session-crashed-bubble',
      IMAGINE,
    ], { detached: true, stdio: 'ignore' });
    filho.on('error', () => {});
    filho.unref();
    for (let i = 0; i < 40 && !browser; i++) { await dorme(1000); browser = await tentarConectar(); }
    if (!browser) fail(`Não consegui conectar ao Chrome em ${a.cdp}. Se já existe um Chrome com o perfil "${PERFIL}", feche-o e rode de novo.`);
  }
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => p.url().includes('grok.com'));
  if (!page) page = ctx.pages()[0] || await ctx.newPage();
  return { browser, page };
}

async function fecharAvisos(page) {
  for (const nome of ['Fechar anúncio', 'Fechar centro de preferências', 'Dismiss cookie notice']) {
    const b = page.getByRole('button', { name: nome }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
}

async function abrirImagine(page) {
  await page.goto(IMAGINE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await fecharAvisos(page);
  const entrar = page.getByRole('link', { name: 'Entrar' });
  if (/sign-in|accounts\.x\.ai/.test(page.url()) || await entrar.isVisible().catch(() => false)) {
    fail('O Chrome do Grok não está logado. Rode "login" e entre na conta nessa janela.');
  }
  await page.getByRole('button', { name: 'Vídeo', exact: true }).waitFor({ timeout: 30000 })
    .catch(() => fail('A tela do Imagine não carregou.', { url: page.url() }));
  await fecharAvisos(page);
}

async function ligado(botao) {
  const pressed = await botao.getAttribute('aria-pressed');
  const state = await botao.getAttribute('data-state');
  return pressed === 'true' || state === 'on' || state === 'open';
}

async function garantirVideo(page) {
  const video = page.getByRole('button', { name: 'Vídeo', exact: true });
  if (!(await ligado(video))) await video.click();
  if (!(await ligado(video))) fail('Não consegui mudar o Imagine para Vídeo.');
}

async function escolher(page, botao, item) {
  await page.getByRole('button', { name: botao }).click();
  const opcao = page.getByRole('menuitemradio', { name: item });
  try {
    await opcao.waitFor({ timeout: 5000 });
  } catch {
    const abertas = await page.getByRole('menuitemradio').allInnerTexts().catch(() => []);
    fail(`Não achei a opção "${item}" em "${botao}".`, { opcoes: abertas });
  }
  await opcao.click();
  await page.waitForTimeout(250);
}

// Deixa 9:16, a resolução pedida, a duração da tela e o áudio ligado. Não envia.
async function configurar(page, { duracao, resolucao }) {
  await garantirVideo(page);
  await escolher(page, 'Resolução do vídeo', resolucao);
  await escolher(page, 'Duração do vídeo', `${duracao}s`);
  await escolher(page, 'Aspecto de proporção', /9:16/);
  const audio = page.getByRole('button', { name: 'Áudio do vídeo' });
  if (!(await ligado(audio))) await audio.click();
  const ler = async (nome) => (await page.getByRole('button', { name: nome }).innerText()).replace(/\s+/g, ' ').trim();
  const chips = {
    resolucao: await ler('Resolução do vídeo'),
    duracao: await ler('Duração do vídeo'),
    aspecto: await ler('Aspecto de proporção'),
  };
  if (!chips.resolucao.includes(resolucao)) fail(`Resolução ficou "${chips.resolucao}", esperado ${resolucao}.`, chips);
  if (!chips.duracao.includes(`${duracao}s`)) fail(`Duração ficou "${chips.duracao}", esperado ${duracao}s.`, chips);
  if (!chips.aspecto.includes('9:16')) fail(`Proporção ficou "${chips.aspecto}", esperado 9:16.`, chips);
  if (!(await ligado(audio))) fail('O áudio do vídeo ficou desligado. A fala da cena precisa dele.');
  return chips;
}

async function anexarPrimeiro(page, caminho) {
  if (!existsSync(caminho)) fail(`Imagem não encontrada: ${caminho}`);
  await page.locator('input[type=file]').first().setInputFiles(caminho);
  await page.getByRole('button', { name: 'Remove image' }).first().waitFor({ timeout: 15000 })
    .catch(() => fail('A imagem não entrou como primeiro quadro.'));
  await page.waitForTimeout(400);
}

async function anexarUltimo(page, caminho) {
  if (!existsSync(caminho)) fail(`Imagem de fim não encontrada: ${caminho}`);
  const botao = page.getByRole('button', { name: 'Adicionar último quadro' });
  if (!(await botao.isVisible().catch(() => false))) fail('Não achei "Adicionar último quadro". Anexe o primeiro quadro antes.');
  const chooserP = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
  await botao.click();
  const chooser = await chooserP;
  if (chooser) await chooser.setFiles(caminho);
  else await page.locator('input[type=file]').first().setInputFiles(caminho);
  await page.waitForTimeout(600);
}

async function limparQuadros(page) {
  const remover = page.getByRole('button', { name: 'Remove image' });
  for (let i = 0; i < 4 && await remover.first().isVisible().catch(() => false); i++) {
    await remover.first().click();
    await dorme(200);
  }
}

async function mencionar(page, nome) {
  const seguro = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.keyboard.type('@');
  const itens = page.locator('button').filter({ hasText: new RegExp(`^${seguro}$`) });
  const limite = Date.now() + 5000;
  let alvo = null;
  while (Date.now() < limite && !alvo) {
    const n = await itens.count();
    for (let i = 0; i < n; i++) {
      if (await itens.nth(i).isVisible().catch(() => false)) { alvo = itens.nth(i); break; }
    }
    if (!alvo) await dorme(200);
  }
  if (!alvo) fail(`Não achei @${nome} nas referências do Imagine. Crie em Referências → Novidades, com esse título. Nada foi enviado.`);
  await alvo.click();
  await dorme(250);
}

async function digitarPrompt(page, texto, mencoes = []) {
  const caixa = page.locator('[contenteditable="true"]').first();
  await caixa.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await dorme(150);
  for (const nome of mencoes) await mencionar(page, nome);
  const resto = texto.replace(/\s*\n\s*/g, ' ').trim();
  if (mencoes.length && resto) await page.keyboard.type(' ');
  if (resto) await page.keyboard.insertText(resto);
  await dorme(200);
  const chips = (await caixa.locator('[data-mention-type="reference"]').allInnerTexts())
    .map((t) => t.replace(/\s+/g, ' ').trim());
  const faltando = mencoes.filter((nome) => !chips.includes(nome));
  if (faltando.length) fail(`A referência não entrou no prompt: ${faltando.map((n) => '@' + n).join(', ')}. Nada foi enviado.`, { chips });
  return chips;
}

const srcsVideo = (page) => page.locator('video').evaluateAll((vs) => vs.map((v) => v.currentSrc || v.src || '').filter(Boolean)).catch(() => []);

async function enviarUma(page, { texto, imagem, imagemFim, mencoes = [], duracao, resolucao, dryRun }) {
  await abrirImagine(page);
  const antes = await srcsVideo(page);
  const chips = await configurar(page, { duracao, resolucao });
  await limparQuadros(page);
  if (imagem) await anexarPrimeiro(page, imagem);
  if (imagemFim) await anexarUltimo(page, imagemFim);
  const mencoesNoPrompt = await digitarPrompt(page, texto, mencoes);
  if (!imagem && await page.getByRole('button', { name: 'Remove image' }).first().isVisible().catch(() => false)) {
    fail('Entrou um primeiro quadro sem keyframe. O retrato de referência não pode travar a cena. Nada foi enviado.');
  }
  const tela = join(a.saida, 'antes-de-enviar.png');
  await page.screenshot({ path: tela });
  if (dryRun) return { enviado: false, dryRun: true, ...chips, tela, imagem: imagem ?? null, imagemFim: imagemFim ?? null, mencoes: mencoesNoPrompt };

  await page.getByRole('button', { name: 'submeter' }).click();
  return { enviado: true, ...chips, enviadoEm: new Date().toISOString(), antes };
}

function ehVideoNovo(url, conhecidos) {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return false;
  const limpa = url.split('?')[0];
  if (conhecidos.has(url) || conhecidos.has(limpa)) return false;
  return /assets\.grok\.com\/users\/[^/]+\/generated\//i.test(limpa) && !/\.(png|jpe?g|webp|gif)$/i.test(limpa);
}

async function aguardarVideo(page, antes, seg) {
  const conhecidos = new Set(antes);
  const achados = [];
  const ouvir = (res) => {
    const tipo = (res.headers()['content-type'] || '').toLowerCase();
    const url = res.url();
    if (!res.ok() || !ehVideoNovo(url, conhecidos)) return;
    if (tipo.startsWith('video/') || tipo.includes('mpegurl') || /video|mp4/i.test(url)) achados.push(url.split('?')[0]);
  };
  page.on('response', ouvir);
  const limite = Date.now() + Number(seg) * 1000;
  try {
    while (Date.now() < limite) {
      const aviso = page.getByText(/limite|cota esgotada|rate limit|não foi possível gerar|upgrade your plan|atualize seu plano/i).first();
      if (await aviso.isVisible().catch(() => false)) {
        const t = (await aviso.innerText()).replace(/\s+/g, ' ').trim();
        fail(`O Grok recusou a geração: ${t}`);
      }
      if (achados.length) return achados[0];
      const srcs = [
        ...await srcsVideo(page),
        ...await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name)).catch(() => []),
      ];
      const novo = srcs.find((s) => ehVideoNovo(s, conhecidos));
      if (novo) return novo.split('?')[0];
      await dorme(4000);
    }
  } finally {
    page.off('response', ouvir);
  }
  const tela = join(a.saida, 'timeout.png');
  await page.screenshot({ path: tela }).catch(() => {});
  fail(`O vídeo não ficou pronto em ${seg}s. Nada foi reenviado.`, { tela });
}

async function baixarVideo(page, url, destino) {
  const res = await page.context().request.get(url);
  if (!res.ok()) fail(`Não baixei o vídeo (${res.status()}).`, { url });
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, Buffer.from(await res.body()));
  return destino;
}

async function contaVisivel(page) {
  await abrirImagine(page);
  const menu = page.getByRole('button', { name: /Menu da conta/ });
  if (!(await menu.isVisible().catch(() => false))) return null;
  return (await menu.getAttribute('aria-label')) || '';
}

// ---------- comandos ----------

function selfTest() {
  const casos = [[8, 10], [6, 6], [3, 6], [10, 10], [12, 15], [15, 15], [20, 15]];
  const erros = casos.filter(([de, para]) => duracaoGrok(de) !== para).map(([de, para]) => `${de}->${para}, veio ${duracaoGrok(de)}`);
  if (duracaoGrok(0) !== null) erros.push('0 deveria ser nulo');
  const curta = duracaoDaFala('Eu juro que tentei de tudo. Hoje a calça nem fecha mais.', 10);
  if (curta.palavras !== 12 || curta.duracao !== 6) erros.push(`fala curta deveria ser 6s, veio ${JSON.stringify(curta)}`);
  const duas = duracaoDaFala('CARLA: Mari, prova esse shake da Lumi. Eu tomo todo dia no café. MARINA: Mais uma dessas modinhas, Carla?', 10);
  if (duas.palavras !== 17 || duas.turnos !== 2 || duas.duracao !== 10) erros.push(`duas falas deveriam ser 10s, veio ${JSON.stringify(duas)}`);
  const depoimento = duracaoDaFala('Não é milagre, mas pela primeira vez eu consegui manter a rotina.', 10);
  if (depoimento.palavras !== 12 || depoimento.duracao !== 6) erros.push(`depoimento deveria ser 6s, veio ${JSON.stringify(depoimento)}`);
  const longa = duracaoDaFala(Array.from({ length: 45 }, (_, i) => `palavra${i}`).join(' '), 10);
  if (longa.duracao !== 15 || !longa.apertado) erros.push(`fala de 45 palavras deveria apertar em 15s, veio ${JSON.stringify(longa)}`);
  const muda = duracaoDaFala('', 8);
  if (muda.duracao !== 10 || muda.pelaFala) erros.push(`cena sem fala deveria seguir o roteiro, veio ${JSON.stringify(muda)}`);
  if (aplicarDuracaoNoPrompt('Duração: 10 segundos. O resto.', 6) !== 'Duração: 6 segundos. O resto.') erros.push('o prompt não trocou a duração');
  const elenco = [
    { id: 'marina', nome: 'Marina', grokRef: 'Marina', imagem: 'personagens/marina.jpg' },
    { id: 'carla', nome: 'Carla', imagem: 'personagens/carla.jpg' },
    { id: 'extra', nome: 'Extra' },
  ];
  const comRef = mencoesDaCena(elenco, ['marina', 'extra']);
  if (comRef.refs.join() !== 'Marina' || comRef.problemas.length) erros.push(`mencao esperada Marina, veio ${JSON.stringify(comRef)}`);
  const semRef = mencoesDaCena(elenco, ['carla']);
  if (semRef.refs.length || semRef.problemas.length !== 1) erros.push(`imagem sem grokRef deveria falhar, veio ${JSON.stringify(semRef)}`);
  const desconhecido = mencoesDaCena(elenco, ['ninguem']);
  if (desconhecido.problemas.length !== 1) erros.push('personagem fora do elenco deveria falhar');
  if (erros.length) fail('self-test da duração falhou.', { erros });
  console.log(JSON.stringify({ ok: true, selfTest: true, duracoes: DURACOES }));
}

async function cmdEnviar() {
  if (!a.prompt) fail('Falta --prompt.');
  const pedida = Number(a.duracao || 6);
  const duracao = duracaoGrok(pedida);
  if (!duracao) fail('Duração inválida.');
  const { browser, page } = await conectar();
  const r = await enviarUma(page, {
    texto: readFileSync(a.prompt, 'utf8'),
    imagem: a.imagem,
    imagemFim: a['imagem-fim'],
    mencoes: (a.mencoes || '').split(',').map((s) => s.trim()).filter(Boolean),
    duracao,
    resolucao: a.resolucao,
    dryRun: a['dry-run'] || !a.sim,
  });
  console.log(JSON.stringify({
    ok: true,
    ...r,
    duracaoPedida: pedida,
    duracao,
    ajustado: duracao !== pedida,
    aviso: r.enviado ? undefined : 'Nada foi enviado. Para gastar a cota, rode com --sim (sem --dry-run).',
  }));
  await browser.close();
}

async function cmdLogin() {
  const { browser, page } = await conectar();
  await page.goto(IMAGINE, { waitUntil: 'domcontentloaded' });
  await fecharAvisos(page);
  let menu = page.getByRole('button', { name: /Menu da conta/ });
  if (!(await menu.isVisible({ timeout: 6000 }).catch(() => false))) {
    log('Entre na sua conta do Grok na janela do Chrome que abriu. Esperando até 10 minutos...');
    await menu.waitFor({ timeout: 600000 }).catch(() => fail('Login não concluído em 10 minutos. Rode "login" de novo.'));
  }
  const conta = await menu.getAttribute('aria-label');
  console.log(JSON.stringify({ ok: true, logado: true, conta, mensagem: 'Login salvo no perfil do Chrome do Grok. Você não precisa repetir.' }));
  await browser.close();
}

async function cmdSaldo() {
  const { browser, page } = await conectar();
  const conta = await contaVisivel(page);
  console.log(JSON.stringify({
    ok: true,
    logado: Boolean(conta),
    conta,
    saldo: null,
    aviso: 'O Imagine não mostra um saldo de créditos. Cada vídeo gasta a cota do plano da conta logada. Confira o plano antes de rodar com --sim.',
  }));
  await browser.close();
}

function cmdChrome() {
  const c = acharChrome();
  if (!c) fail('Chrome não encontrado. Instale em https://www.google.com/chrome');
  console.log(JSON.stringify({ ok: true, chrome: c, perfil: PERFIL, porta: a.cdp }));
}

function planoCena(pasta, cena) {
  const tempo = duracaoDaFala(cena.fala, cena.segundos);
  const inicio = cena.keyframeInicio ? join(pasta, cena.keyframeInicio) : null;
  const fim = cena.keyframeFim ? join(pasta, cena.keyframeFim) : null;
  return {
    n: cena.n,
    segundosRoteiro: cena.segundos,
    segundosGrok: tempo.duracao,
    segundosFala: tempo.ideal,
    palavras: tempo.palavras,
    turnos: tempo.turnos,
    apertado: tempo.apertado,
    ajustado: tempo.duracao !== Number(cena.segundos),
    primeiroQuadro: inicio,
    ultimoQuadro: fim,
  };
}

async function cmdCriativo() {
  const pasta = positionals[1];
  if (!pasta) fail('Uso: criativo <pasta> [--cenas 1-6] [--x 1] [--sim] [--baixar]');
  const roteiro = JSON.parse(readFileSync(join(pasta, 'roteiro.json'), 'utf8'));
  const arqEstado = join(pasta, 'grok-estado.json');
  const estado = existsSync(arqEstado) ? JSON.parse(readFileSync(arqEstado, 'utf8')) : { provedor: 'grok', cenas: {} };
  estado.provedor = 'grok';
  estado.cenas ??= {};
  const salvar = () => writeFileSync(arqEstado, JSON.stringify(estado, null, 2) + '\n');
  const x = Number(a.x);
  if (!Number.isInteger(x) || x < 1 || x > 2) fail('--x é 1 (padrão) ou 2. Cada variação é um envio novo e gasta cota de novo.');

  const alvo = intervalo(a.cenas, roteiro.cenas.map((c) => c.n));
  const cenas = roteiro.cenas.filter((c) => alvo.includes(c.n));
  const problemas = [];
  const planos = [];
  for (const c of cenas) {
    if (!existsSync(join(pasta, 'prompts', `cena-${nn(c.n)}.txt`))) problemas.push(`prompts/cena-${nn(c.n)}.txt não existe`);
    const p = planoCena(pasta, c);
    const mencoes = mencoesDaCena(roteiro.personagens, c.personagens);
    p.referencias = mencoes.refs;
    problemas.push(...mencoes.problemas.map((m) => `cena ${nn(c.n)}: ${m}`));
    if (!p.segundosGrok) problemas.push(`cena ${nn(c.n)} sem duração válida`);
    if (p.apertado) problemas.push(`cena ${nn(c.n)} tem ${p.palavras} palavras e não cabe em 15s sem a fala acelerar. Divida a cena.`);
    if (p.primeiroQuadro && !existsSync(p.primeiroQuadro)) problemas.push(`${c.keyframeInicio} não existe`);
    if (p.ultimoQuadro && !existsSync(p.ultimoQuadro)) problemas.push(`${c.keyframeFim} não existe`);
    planos.push(p);
  }
  for (const p of roteiro.personagens ?? []) {
    if (p.imagem && !existsSync(join(pasta, p.imagem))) problemas.push(`${p.imagem} não existe`);
  }
  if (problemas.length) fail('Entradas incompletas; nada foi gasto.', { problemas: [...new Set(problemas)] });

  const pronta = (n) => (estado.cenas[n]?.links?.length ?? 0) >= x;
  const pendentes = cenas.filter((c) => !pronta(c.n));
  const bloqueadas = pendentes.filter((c) => estado.cenas[c.n]?.enviadoEm && !(estado.cenas[c.n]?.links?.length));
  const plano = {
    pasta,
    provedor: 'grok',
    resolucao: a.resolucao,
    aspecto: '9:16',
    variacoes: x,
    cenas: planos.filter((p) => pendentes.some((c) => c.n === p.n)).map((p) => ({
      n: p.n,
      segundosRoteiro: p.segundosRoteiro,
      segundosGrok: p.segundosGrok,
      segundosFala: p.segundosFala,
      palavras: p.palavras,
      ajustado: p.ajustado,
      apertado: p.apertado,
      primeiroQuadro: Boolean(p.primeiroQuadro && existsSync(p.primeiroQuadro)),
      ultimoQuadro: Boolean(p.ultimoQuadro && existsSync(p.ultimoQuadro)),
      referencias: p.referencias,
    })),
    jaProntas: cenas.filter((c) => pronta(c.n)).map((c) => c.n),
    envios: pendentes.reduce((s, c) => s + (x - (estado.cenas[c.n]?.links?.length ?? 0)), 0),
    baixar: a.baixar,
    aviso: 'O Imagine não mostra saldo. Cada envio gasta a cota do plano. Nada foi enviado. Rode de novo com --sim para gerar.',
  };
  if (bloqueadas.length) {
    fail(`Cena(s) ${bloqueadas.map((c) => nn(c.n)).join(', ')} já foram enviadas e não têm link. Apague a entrada delas em grok-estado.json para refazer (senão gasta de novo sem querer).`, plano);
  }
  if (!pendentes.length) { console.log(JSON.stringify({ ok: true, nada: 'Todas as cenas pedidas já estão prontas.', ...plano })); return; }
  if (!a.sim) { console.log(JSON.stringify({ ok: true, plano: true, ...plano })); return; }

  const { browser, page } = await conectar();
  log(`Vou enviar ${plano.envios} vídeo(s) em ${a.resolucao}, 9:16.`);
  for (const c of pendentes) {
    const t0 = Date.now();
    const p = planos.find((item) => item.n === c.n);
    const texto = aplicarDuracaoNoPrompt(readFileSync(join(pasta, 'prompts', `cena-${nn(c.n)}.txt`), 'utf8'), p.segundosGrok);
    estado.cenas[c.n] ??= {};
    const links = estado.cenas[c.n].links ?? [];
    try {
      while (links.length < x) {
        log(`Cena ${nn(c.n)}: variação ${links.length + 1}/${x}, ${p.segundosGrok}s...`);
        const env = await enviarUma(page, {
          texto, imagem: p.primeiroQuadro, imagemFim: p.ultimoQuadro, mencoes: p.referencias,
          duracao: p.segundosGrok, resolucao: a.resolucao, dryRun: false,
        });
        estado.cenas[c.n].enviadoEm = env.enviadoEm;
        estado.cenas[c.n].duracao = p.segundosGrok;
        estado.cenas[c.n].resolucao = a.resolucao;
        estado.cenas[c.n].referencias = p.referencias;
        salvar();
        const url = await aguardarVideo(page, env.antes, a.aguardar);
        links.push(url);
        estado.cenas[c.n].links = links;
        if (a.baixar) {
          const i = links.length - 1;
          const destino = i === 0
            ? join(pasta, 'cenas', `cena-${nn(c.n)}.mp4`)
            : join(pasta, 'cenas', 'alternativas', `cena-${nn(c.n)}-${String.fromCharCode(97 + i)}.mp4`);
          estado.cenas[c.n].arquivos ??= [];
          estado.cenas[c.n].arquivos.push(relative(pasta, await baixarVideo(page, url, destino)).replaceAll('\\', '/'));
        }
        salvar();
      }
      const refsNota = p.referencias.length ? p.referencias.map((nome) => '@' + nome).join(' ') : 'sem referência';
      appendFileSync(join(pasta, 'notas.md'), `\n- Cena ${nn(c.n)} (grok, ${new Date().toISOString().slice(0, 16)}): ${p.segundosGrok}s ${a.resolucao} 9:16 x${x}. ${refsNota}. ${links.join(' | ')}\n`);
      log(`Cena ${nn(c.n)}: pronta em ${Math.round((Date.now() - t0) / 1000)}s.`);
    } catch (e) {
      salvar();
      if (e && typeof e.message === 'string' && !process.exitCode) {
        fail(`Cena ${nn(c.n)} falhou: ${e.message.split('\n')[0]}. Estado salvo; rode de novo para retomar.`, { estado: arqEstado });
      }
      throw e;
    }
  }
  const resumo = Object.fromEntries(cenas.map((c) => [nn(c.n), estado.cenas[c.n]?.links ?? null]));
  console.log(JSON.stringify({ ok: true, provedor: 'grok', cenas: resumo, estado: arqEstado }));
  await browser.close();
}

if (cmd === 'self-test') selfTest();
else {
  const comandos = { chrome: cmdChrome, login: cmdLogin, saldo: cmdSaldo, enviar: cmdEnviar, criativo: cmdCriativo };
  if (!comandos[cmd]) fail('Comandos: chrome | login | saldo | criativo | enviar | self-test');
  await comandos[cmd]();
}
