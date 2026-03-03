export function amazonSearchUrl(brand: string, product: string): string {
  const query = encodeURIComponent(`${brand} ${product}`.trim());
  return `https://www.amazon.com/s?k=${query}`;
}

export function homeDepotSearchUrl(brand: string, product: string): string {
  const query = encodeURIComponent(`${brand} ${product}`.trim());
  return `https://www.homedepot.com/s/${query}`;
}

export function lowesSearchUrl(brand: string, product: string): string {
  const query = encodeURIComponent(`${brand} ${product}`.trim());
  return `https://www.lowes.com/search?searchTerm=${query}`;
}

export function generateAllSearchUrls(brand: string, product: string) {
  return {
    amazon: amazonSearchUrl(brand, product),
    homeDepot: homeDepotSearchUrl(brand, product),
    lowes: lowesSearchUrl(brand, product),
  };
}
