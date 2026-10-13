// Seeded random numbers for every simulation. mulberry32 (T. Ettinger) passes the usual
// statistical batteries; a plain 32-bit LCG feeding Box–Muller with consecutive outputs leaves
// correlations that bias sums of many deviates (seen as a 4 % error in Monte-Carlo variances).
export function uniform(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
}
// Uniform, standard normal (Box–Muller) and Poisson deviates from one seeded stream.
export function makeRng(seed) {
  const u = uniform(seed);
  const g = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const poisson = (mu) => {
    if (mu <= 0) return 0;
    if (mu > 30) return Math.max(0, Math.round(mu + Math.sqrt(mu) * g()));
    const L = Math.exp(-mu);
    let k = 0, p = 1;
    do { k++; p *= u(); } while (p > L);
    return k - 1;
  };
  return { u, g, poisson };
}
