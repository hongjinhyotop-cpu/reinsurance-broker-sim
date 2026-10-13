// 설정 값 격자 탐색: node tests/balance/grid.mjs <난이도> <시나리오> <시드수> '{"경로":[값,...], ...}'
// 모든 조합을 돌려 등급 분포·평균 확정 수를 한 줄씩 보여 준다. 튜닝할 때 방향을 잡는 용도다.
import { boot, playYear, applyOverrides } from './sim.mjs';

const [diff = 'normal', scen = 'expert', nArg = '20', gridArg = '{}'] = process.argv.slice(2);
const n = Number(nArg);
const grid = JSON.parse(gridArg);
const keys = Object.keys(grid);
const base = await boot();
const combos = keys.reduce((acc, k) => acc.flatMap((c) => grid[k].map((v) => ({ ...c, [k]: v }))), [{}]);
for (const combo of combos) {
  const data = applyOverrides(base, combo);
  const g = {}; let placed = 0, score = 0;
  for (let seed = 1; seed <= n; seed++) {
    const r = playYear(data, { seed, difficulty: diff, scenario: scen });
    const k = r.kind === 'fired' ? '해고' : r.grade; g[k] = (g[k] ?? 0) + 1; placed += r.placed; score += r.score;
  }
  console.log(JSON.stringify(combo), 'placed', (placed / n).toFixed(2), 'score', (score / n).toFixed(1), JSON.stringify(g));
}
