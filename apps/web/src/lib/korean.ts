export type Particle = "을/를" | "은/는" | "이/가";

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;

/**
 * `word` followed by the form of `particle` its last syllable calls for: the
 * first form after a final consonant (국가장학금을), the second after a vowel
 * (국민취업지원제도를). A word that does not end in a Hangul syllable (a Latin
 * id, say) gets the first form.
 */
export function withParticle(word: string, particle: Particle): string {
  const [afterConsonant, afterVowel] = particle.split("/") as [string, string];
  const code = word.charCodeAt(word.length - 1);
  const hangul = code >= HANGUL_FIRST && code <= HANGUL_LAST;
  const vowelEnding = hangul && (code - HANGUL_FIRST) % 28 === 0;
  return `${word}${vowelEnding ? afterVowel : afterConsonant}`;
}
