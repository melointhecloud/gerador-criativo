#!/usr/bin/env node
// Automação determinística do Google Flow, conectando num Chrome já logado (CDP).
// Um comando por criativo: lê o roteiro, gera as cenas, coleta os links e (opcional) baixa.
// Guia completo: references/flow-script.md
//
//   node flow.mjs criativo <pasta> --projeto <url> [--cenas 1-6] [--x 2] [--sim] [--baixar]
//   node flow.mjs enviar   --projeto <url> --prompt <txt> [--ref "Nome#1"]... [--dry-run]
//   node flow.mjs coletar  --projeto <url> --n 2
//   node flow.mjs saldo
//   node flow.mjs imagens  --projeto <url>   (lista as imagens do projeto, na ordem usada por --ref "Nome#K")
//   node flow.mjs login    (primeira vez: abre o Chrome do Flow e espera você entrar na conta Google)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, delimiter, relative } from 'node:path';
import { parseArgs } from 'node:util';

const { positionals, values: a } = parseArgs({
  allowPositionals: true,
  options: {
    projeto: { type: 'string' },
    prompt: { type: 'string' },
    ref: { type: 'string', multiple: true },
    duracao: { type: 'string', default: '8' },
    x: { type: 'string', default: '2' },
    modelo: { type: 'string', default: 'Omni 1.2 Flash' },
    'max-creditos': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    n: { type: 'string' },
    aguardar: { type: 'string', default: '300' },
    cenas: { type: 'string' },
    sim: { type: 'boolean', default: false },
    baixar: { type: 'boolean', default: false },
    cdp: { type: 'string', default: process.env.FLOW_CDP || 'http://localhost:9333' },
    saida: { type: 'string', default: process.env.FLOW_OUT || join(tmpdir(), 'flow-cli') },
  },
});
const cmd = positionals[0];
mkdirSync(a.saida, { recursive: true });

const log = (...m) => console.error('[flow]', ...m);
const fail = (msg, extra = {}) => {
  console.log(JSON.stringify({ ok: false, erro: msg, ...extra }));
  process.exit(1);
};
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const PERFIL = process.env.FLOW_PERFIL || join(homedir(), '.chrome-flow');

// ---------- conexão ----------

async function tentarConectar() {
  try { return await chromium.connectOverCDP(a.cdp); } catch { return null; }
}

// Procura o Chrome instalado (Windows, macOS ou Linux). FLOW_CHROME força um caminho.
function acharChrome() {
  if (process.env.FLOW_CHROME) return process.env.FLOW_CHROME;
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

// Se o Chrome do Flow não estiver aberto, abre sozinho (perfil dedicado, porta de depuração).
async function conectar() {
  let browser = await tentarConectar();
  if (!browser) {
    const porta = new URL(a.cdp).port || '9333';
    const chrome = acharChrome();
    if (!chrome) fail('Não achei o Google Chrome. Instale em https://www.google.com/chrome (ou defina FLOW_CHROME com o caminho do programa).');
    log(`Abrindo o Chrome do Flow (perfil ${PERFIL}, porta ${porta})...`);
    const filho = spawn(chrome, [`--remote-debugging-port=${porta}`, `--user-data-dir=${PERFIL}`, '--no-first-run', 'https://flow.google.com'], { detached: true, stdio: 'ignore' });
    filho.on('error', () => {});
    filho.unref();
    for (let i = 0; i < 40 && !browser; i++) { await dorme(1000); browser = await tentarConectar(); }
    if (!browser) fail(`Não consegui conectar ao Chrome em ${a.cdp}. Se já existe um Chrome aberto com o perfil "${PERFIL}", feche-o (todas as janelas) e rode de novo.`);
  }
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => p.url().startsWith('https://flow.google.com'));
  if (!page) { page = await ctx.newPage(); await page.goto('https://flow.google.com'); }
  return { browser, page };
}

// Avisos/novidades do Flow que cobrem a tela. "Começar" só habilita depois de rolar o texto até o fim.
async function fecharAvisos(page) {
  for (let i = 0; i < 4; i++) {
    const dlg = page.locator('[role=dialog]').first();
    if (!(await dlg.count())) return;
    await dlg.evaluate((el) => el.querySelectorAll('*').forEach((n) => { if (n.scrollHeight > n.clientHeight + 5) n.scrollTop = n.scrollHeight; })).catch(() => {});
    await page.waitForTimeout(400);
    const comecar = dlg.getByRole('button', { name: 'Começar' });
    if (await comecar.isEnabled().catch(() => false)) await comecar.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

const caixaPrompt = (page) => page.getByRole('textbox', { name: 'O que você quer criar?' });

async function abrirProjeto(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' }); // sempre recarrega: limpa popups e comando antigo
  if (/accounts\.google\.com/.test(page.url())) fail('O Chrome do Flow não está logado. Faça login no Google nessa janela uma vez e rode de novo.');
  await caixaPrompt(page).waitFor({ timeout: 30000 }).catch(() => fail('A tela do projeto não carregou (logado? URL do projeto certa?).', { url: page.url() }));
  await fecharAvisos(page);
}

// ---------- enviar uma cena ----------

const chipConfig = (page) => page.locator('button', { hasText: /x[1-4]\s*$/ }).last();

async function configurar(page, { duracao, x, modelo }) {
  await chipConfig(page).click();
  await page.getByRole('radio', { name: /Vídeo/ }).click();
  await page.getByRole('radio', { name: /Elementos/ }).click();
  await page.getByRole('radio', { name: /9:16/ }).click();
  await page.getByRole('radio', { name: /720p/ }).click();
  await page.getByRole('radio', { name: new RegExp(`^x${x}$`) }).click();

  const modeloAtual = (await page.locator('button', { hasText: /Omni|Veo/ }).last().innerText()).replace(/arrow_drop_down/, '').trim();
  if (modeloAtual !== modelo) fail(`Modelo selecionado é "${modeloAtual}", esperado "${modelo}". Troque no Flow e rode de novo.`);

  // Slider de duração: input range; o rótulo "Ns" mostra o valor real.
  const slider = page.locator('input[type=range][aria-label="Duração"]');
  const lerDur = async () => parseInt((await page.locator('text=/^\\d+s$/').first().innerText()).replace('s', ''), 10);
  await slider.focus();
  for (let i = 0; i < 16 && (await lerDur()) !== Number(duracao); i++) {
    await page.keyboard.press((await lerDur()) < Number(duracao) ? 'ArrowRight' : 'ArrowLeft');
  }
  const duracaoFinal = await lerDur();
  if (duracaoFinal !== Number(duracao)) fail(`Não consegui ajustar a duração para ${duracao}s (ficou ${duracaoFinal}s).`);

  const txt = await page.getByText(/A geração vai usar/).innerText();
  const creditos = parseInt(txt.match(/(\d+)\s*créditos/)?.[1] ?? '', 10);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return { creditos, duracao: duracaoFinal, modelo: modeloAtual };
}

async function anexarRef(page, ref, idx) {
  const [nome, pos] = ref.split('#');
  const n = Math.max(1, parseInt(pos ?? '1', 10)) - 1;
  await page.locator('button:has-text("add")').last().click();
  const busca = page.getByPlaceholder('Pesquisar recursos');
  await busca.waitFor({ timeout: 10000 });
  await page.getByText('Imagens', { exact: true }).last().click();
  await busca.fill(nome);
  await page.waitForTimeout(900);
  const itens = page.getByRole('option').filter({ hasText: nome }); // cada item é <button role=option>, mais recente primeiro
  const total = await itens.count();
  if (total <= n) fail(`Referência "${ref}" não encontrada (achei ${total} resultado(s)).`);
  await itens.nth(n).click();
  await page.waitForTimeout(700);
  const foto = `${a.saida}/ref-${idx + 1}.png`;
  await page.screenshot({ path: foto });
  // Clicar no item que já está ativo (o 1º) inclui direto; nos outros é preciso confirmar.
  const incluir = page.getByRole('button', { name: 'Incluir no comando' });
  if (await incluir.isVisible().catch(() => false)) await incluir.click();
  await busca.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => fail(`A referência "${ref}" não foi incluída (o seletor continua aberto).`));
  await page.waitForTimeout(400);
  return { ref, resultados: total, conferir: foto };
}

async function digitarPrompt(page, texto) {
  await caixaPrompt(page).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(texto.replace(/\s*\n\s*/g, ' ').trim());
}

// Assinatura das N primeiras miniaturas (src da imagem é único por mídia). Serve para saber o que é novo.
const assinaturas = (page, n) =>
  page.locator('.tile-row').first().locator('> *').evaluateAll((els, k) => els.slice(0, k).map((e) => e.querySelector('img')?.src ?? ''), n).catch(() => []);

async function enviarCena(page, { projeto, texto, refs, duracao, x, maxCreditos, dryRun }) {
  await abrirProjeto(page, projeto);
  const antes = await assinaturas(page, 2);
  const cfg = await configurar(page, { duracao, x, modelo: a.modelo });
  const esperado = 3 * Number(duracao) * Number(x);
  const teto = Number(maxCreditos ?? esperado);
  if (cfg.creditos !== esperado) fail(`Custo mostrado: ${cfg.creditos} créditos; esperado ${esperado}. Parei antes de enviar.`, cfg);
  if (cfg.creditos > teto) fail(`Custo ${cfg.creditos} acima do teto ${teto}.`, cfg);

  const refsOk = [];
  for (const [i, r] of refs.entries()) refsOk.push(await anexarRef(page, r, i));
  await digitarPrompt(page, texto);
  const tela = `${a.saida}/antes-de-enviar.png`;
  await page.screenshot({ path: tela });
  if (dryRun) return { enviado: false, dryRun: true, ...cfg, refs: refsOk, tela };

  await page.locator('button:has-text("arrow_forward")').last().click();
  await page.waitForTimeout(1500);
  return { enviado: true, ...cfg, refs: refsOk, enviadoEm: new Date().toISOString(), antes, tela };
}

// ---------- coletar / baixar ----------

const primeiras = (page) => page.locator('.tile-row').first().locator('> *');

async function recarregar(page, projeto) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await caixaPrompt(page).waitFor({ timeout: 30000 });
  await fecharAvisos(page);
}

// Espera as N saídas mais novas (diferentes de `antes`) terminarem de renderizar e devolve os links.
async function coletarSaidas(page, { projeto, n, aguardar, antes = [] }) {
  const limite = Date.now() + Number(aguardar) * 1000;
  await abrirProjeto(page, projeto);
  const prontas = async () => {
    const t = await primeiras(page).evaluateAll((els, k) => els.slice(0, k).map((e) => ({ txt: e.innerText, src: e.querySelector('img')?.src ?? '' })), n);
    return t.length >= n && t.every((s) => s.txt.includes('play_circle') && !/\d+\s*%/.test(s.txt) && s.src && !antes.includes(s.src));
  };
  while (!(await prontas())) {
    if (Date.now() > limite) fail(`Saídas ainda não terminaram depois de ${aguardar}s. Rode "coletar" de novo mais tarde.`);
    await dorme(8000);
    await recarregar(page, projeto);
  }
  const saidas = [];
  for (let i = 0; i < n; i++) {
    const tile = primeiras(page).nth(i);
    const titulo = await tile.locator('button').last().getAttribute('aria-label');
    await tile.click();
    await page.waitForURL(/\/edit\//, { timeout: 15000 });
    saidas.push({ saida: i + 1, titulo, link: page.url() });
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await caixaPrompt(page).waitFor({ timeout: 30000 });
    await fecharAvisos(page);
  }
  return saidas;
}

// Baixa a saída em 720p "Tamanho original" (gratuito). Nunca escolhe as opções "Aprimorada" (podem gastar créditos).
async function baixarSaida(page, link, destino) {
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Baixar mídia' }).click({ timeout: 30000 });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.getByText('Tamanho original').click()]);
  mkdirSync(join(destino, '..'), { recursive: true });
  await dl.saveAs(destino);
  return destino;
}

async function lerSaldo(page) {
  await page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded' }); // a página inicial sempre tem o avatar livre
  await fecharAvisos(page);
  await page.locator('[role=button][aria-label="Detalhes da conta"]').click({ timeout: 20000 });
  const t = await page.getByText(/créditos do Google Flow/).first().innerText({ timeout: 10000 });
  await page.keyboard.press('Escape');
  const n = parseInt(t.replace(/\D/g, ''), 10);
  if (Number.isNaN(n)) fail('Não consegui ler o saldo de créditos.', { texto: t });
  return n;
}

// ---------- comandos ----------

async function cmdEnviar() {
  if (!a.projeto || !a.prompt) fail('Faltam --projeto e --prompt.');
  const { browser, page } = await conectar();
  const r = await enviarCena(page, { projeto: a.projeto, texto: readFileSync(a.prompt, 'utf8'), refs: a.ref ?? [], duracao: a.duracao, x: a.x, maxCreditos: a['max-creditos'], dryRun: a['dry-run'] });
  console.log(JSON.stringify({ ok: true, ...r }));
  await browser.close();
}

async function cmdColetar() {
  if (!a.projeto) fail('Falta --projeto.');
  const { browser, page } = await conectar();
  const saidas = await coletarSaidas(page, { projeto: a.projeto, n: Number(a.n ?? a.x), aguardar: a.aguardar });
  console.log(JSON.stringify({ ok: true, saidas }));
  await browser.close();
}

async function cmdSaldo() {
  const { browser, page } = await conectar();
  const saldo = await lerSaldo(page);
  console.log(JSON.stringify({ ok: true, saldo }));
  await browser.close();
}

const nn = (n) => String(n).padStart(2, '0');

function intervalo(txt, todas) {
  if (!txt) return todas;
  const set = new Set();
  for (const parte of txt.split(',')) {
    const [de, ate] = parte.split('-').map(Number);
    for (let i = de; i <= (ate || de); i++) set.add(i);
  }
  return todas.filter((n) => set.has(n));
}

// Gera TODAS as cenas do roteiro em sequência, retomando de onde parou (flow-estado.json).
async function cmdCriativo() {
  const pasta = positionals[1];
  if (!pasta || !a.projeto) fail('Uso: criativo <pasta> --projeto <url> [--cenas 1-6] [--x 2] [--sim] [--baixar]');
  const roteiro = JSON.parse(readFileSync(join(pasta, 'roteiro.json'), 'utf8'));
  const arqEstado = join(pasta, 'flow-estado.json');
  const estado = existsSync(arqEstado) ? JSON.parse(readFileSync(arqEstado, 'utf8')) : { projeto: a.projeto, cenas: {} };
  const salvar = () => writeFileSync(arqEstado, JSON.stringify(estado, null, 2) + '\n');
  const x = Number(a.x);

  // 1) valida entradas ANTES de gastar qualquer crédito
  const alvo = intervalo(a.cenas, roteiro.cenas.map((c) => c.n));
  const cenas = roteiro.cenas.filter((c) => alvo.includes(c.n));
  const porId = Object.fromEntries(roteiro.personagens.map((p) => [p.id, p]));
  const problemas = [];
  for (const c of cenas) {
    if (!existsSync(join(pasta, 'prompts', `cena-${nn(c.n)}.txt`))) problemas.push(`prompts/cena-${nn(c.n)}.txt não existe`);
    for (const id of c.personagens ?? []) if (!porId[id]?.flowRef) problemas.push(`personagem "${id}" sem "flowRef" no roteiro.json (ex.: "Nome da imagem no Flow#1")`);
  }
  if (problemas.length) fail('Entradas incompletas; nada foi gasto.', { problemas: [...new Set(problemas)] });

  const pendentes = cenas.filter((c) => !estado.cenas[c.n]?.links);
  const custo = pendentes.reduce((s, c) => s + 3 * c.segundos * x, 0);
  const plano = { pasta, cenasPendentes: pendentes.map((c) => c.n), jaProntas: cenas.filter((c) => estado.cenas[c.n]?.links).map((c) => c.n), creditosNecessarios: custo, baixar: a.baixar };
  if (!pendentes.length) { console.log(JSON.stringify({ ok: true, nada: 'Todas as cenas pedidas já estão prontas.', ...plano })); return; }
  if (!a.sim) { console.log(JSON.stringify({ ok: true, plano: true, aviso: 'Nada foi enviado. Rode de novo com --sim para gastar os créditos.', ...plano })); return; }

  const { browser, page } = await conectar();
  await abrirProjeto(page, a.projeto);
  const saldo = await lerSaldo(page);
  if (saldo < custo) fail(`Saldo ${saldo} < ${custo} créditos necessários. Diminua --cenas ou espere a renovação.`, plano);
  log(`Saldo ${saldo}; vou gastar ${custo} em ${pendentes.length} cena(s).`);

  for (const c of pendentes) {
    const t0 = Date.now();
    try {
      log(`Cena ${nn(c.n)}: enviando...`);
      const texto = readFileSync(join(pasta, 'prompts', `cena-${nn(c.n)}.txt`), 'utf8');
      const refs = (c.personagens ?? []).map((id) => porId[id].flowRef);
      const env = await enviarCena(page, { projeto: a.projeto, texto, refs, duracao: c.segundos, x, maxCreditos: 3 * c.segundos * x });
      estado.cenas[c.n] = { enviadoEm: env.enviadoEm, creditos: env.creditos };
      salvar(); // grava logo: se algo falhar depois, não reenvia (e não gasta de novo) sem você mandar
      log(`Cena ${nn(c.n)}: enviada (${env.creditos} créditos). Aguardando renderizar...`);
      const saidas = await coletarSaidas(page, { projeto: a.projeto, n: x, aguardar: a.aguardar, antes: env.antes });
      estado.cenas[c.n].links = saidas.map((s) => s.link);
      estado.cenas[c.n].titulo = saidas[0]?.titulo;
      if (a.baixar) {
        estado.cenas[c.n].arquivos = [];
        for (const [i, s] of saidas.entries()) {
          const destino = i === 0 ? join(pasta, 'cenas', `cena-${nn(c.n)}.mp4`) : join(pasta, 'cenas', 'alternativas', `cena-${nn(c.n)}-${String.fromCharCode(97 + i)}.mp4`);
          estado.cenas[c.n].arquivos.push(relative(pasta, await baixarSaida(page, s.link, destino)).replaceAll('\\', '/'));
        }
      }
      salvar();
      appendFileSync(join(pasta, 'notas.md'), `\n- Cena ${nn(c.n)} (script, ${new Date().toISOString().slice(0, 16)}): ${env.creditos} créditos. ${saidas.map((s) => s.link).join(' | ')}\n`);
      log(`Cena ${nn(c.n)}: pronta em ${Math.round((Date.now() - t0) / 1000)}s.`);
    } catch (e) {
      salvar();
      fail(`Cena ${nn(c.n)} falhou: ${e.message.split('\n')[0]}. Estado salvo; rode de novo para retomar.`, { estado: arqEstado });
    }
  }
  await abrirProjeto(page, a.projeto);
  const saldoFinal = await lerSaldo(page);
  const resumo = Object.fromEntries(cenas.map((c) => [nn(c.n), estado.cenas[c.n]?.links ?? null]));
  console.log(JSON.stringify({ ok: true, saldoInicial: saldo, saldoFinal, gasto: saldo - saldoFinal, cenas: resumo, estado: arqEstado }));
  await browser.close();
}

async function cmdLogin() {
  const { browser, page } = await conectar();
  await page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded' });
  const avatar = page.locator('[role=button][aria-label="Detalhes da conta"]');
  if (!(await avatar.isVisible({ timeout: 6000 }).catch(() => false))) {
    log('Entre na sua conta Google na janela do Chrome que abriu (clique para entrar no Flow). Esperando até 10 minutos...');
    await avatar.waitFor({ timeout: 600000 }).catch(() => fail('Login não concluído em 10 minutos. Rode "login" de novo.'));
  }
  const saldo = await lerSaldo(page);
  console.log(JSON.stringify({ ok: true, logado: true, saldo, mensagem: 'Login salvo no perfil do Chrome do Flow. Você não precisa repetir.' }));
  await browser.close();
}

function cmdChrome() {
  const c = acharChrome();
  if (!c) fail('Chrome não encontrado. Instale em https://www.google.com/chrome');
  console.log(JSON.stringify({ ok: true, chrome: c, perfil: PERFIL, porta: a.cdp }));
}

// Lista as imagens do projeto na ordem em que o seletor de referências as mostra (mais recente primeiro).
async function cmdImagens() {
  if (!a.projeto) fail('Falta --projeto.');
  const { browser, page } = await conectar();
  await abrirProjeto(page, a.projeto);
  await page.locator('button:has-text("add")').last().click();
  await page.getByPlaceholder('Pesquisar recursos').waitFor({ timeout: 10000 });
  await page.getByText('Imagens', { exact: true }).last().click();
  await page.waitForTimeout(1200);
  const nomes = (await page.getByRole('option').allInnerTexts()).map((t) => t.trim().split('\n')[0]);
  const vistos = {};
  const imagens = nomes.map((nome) => { vistos[nome] = (vistos[nome] ?? 0) + 1; return { flowRef: `${nome}#${vistos[nome]}` }; });
  await page.keyboard.press('Escape');
  console.log(JSON.stringify({ ok: true, total: imagens.length, imagens }));
  await browser.close();
}

const comandos = { imagens: cmdImagens, chrome: cmdChrome, login: cmdLogin, criativo: cmdCriativo, enviar: cmdEnviar, coletar: cmdColetar, saldo: cmdSaldo };
if (!comandos[cmd]) fail('Comandos: chrome | login | imagens | criativo | enviar | coletar | saldo');
await comandos[cmd]();
