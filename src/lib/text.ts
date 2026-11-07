// Garante que um texto (por exemplo, a mensagem de erro do provedor) termine em pontuação final,
// para que uma instrução colada depois dele não vire uma frase só.
const ENDS_SENTENCE = /[.!?…:;]["'”’»)\]]*$/;

export function endSentence(text: string): string {
  const t = text.trim();
  if (!t || ENDS_SENTENCE.test(t)) return t;
  return `${t}.`;
}
