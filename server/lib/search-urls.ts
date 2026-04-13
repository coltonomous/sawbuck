const RETAILERS: Record<string, (query: string) => string> = {
  amazon: (q) => `https://www.amazon.com/s?k=${q}`,
  homeDepot: (q) => `https://www.homedepot.com/s/${q}`,
  lowes: (q) => `https://www.lowes.com/search?searchTerm=${q}`,
};

export function generateAllSearchUrls(brand: string, product: string) {
  const query = encodeURIComponent(`${brand} ${product}`.trim());
  return Object.fromEntries(
    Object.entries(RETAILERS).map(([name, fn]) => [name, fn(query)]),
  ) as Record<'amazon' | 'homeDepot' | 'lowes', string>;
}
