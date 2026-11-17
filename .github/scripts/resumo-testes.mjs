// Lê os resultados JSON do Vitest e publica a contagem como anotação do GitHub Actions.
import { readFileSync } from "node:fs";

const arquivos = [
  ["Testes de lógica", "unit-results.json"],
  ["Testes das regras", "rules-results.json"],
];

for (const [nome, arq] of arquivos) {
  try {
    const r = JSON.parse(readFileSync(arq, "utf8"));
    const nivel = r.numFailedTests > 0 ? "error" : "notice";
    console.log(`::${nivel} title=${nome}::${r.numPassedTests} passaram, ${r.numFailedTests} falharam (total ${r.numTotalTests})`);
  } catch {
    console.log(`::warning title=${nome}::sem resultado (o passo não chegou a rodar)`);
  }
}
