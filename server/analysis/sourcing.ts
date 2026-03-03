import { db } from '../db/index.js';
import { materials, refinishingPlans } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { parsePlanSteps, type RefinishingProduct } from './refinishing.js';
import { generateAllSearchUrls } from '../lib/search-urls.js';

export async function generateMaterialsFromPlan(planId: number, projectId?: number): Promise<number> {
  const plan = await db.select().from(refinishingPlans).where(eq(refinishingPlans.id, planId)).get();
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const steps = parsePlanSteps(plan.steps);
  if (steps.length === 0) {
    console.warn(`[sourcing] No steps found in plan ${planId}`);
    return 0;
  }

  // Collect all products from all steps, dedup by brand+name
  const seen = new Set<string>();
  const allProducts: (RefinishingProduct & { category: string })[] = [];

  for (const step of steps) {
    for (const product of step.products) {
      const key = `${product.brand.toLowerCase()}:${product.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Infer category from product name/step title
      const category = inferCategory(product.name, step.title);
      allProducts.push({ ...product, category });
    }
  }

  // Insert materials with search URLs
  let inserted = 0;
  for (const product of allProducts) {
    const urls = generateAllSearchUrls(product.brand, product.name);

    await db.insert(materials).values({
      refinishingPlanId: planId,
      projectId: projectId ?? null,
      category: product.category,
      productName: product.name,
      brand: product.brand,
      quantity: product.quantity,
      unit: product.unit,
      estimatedPrice: product.estimated_price,
      amazonSearchUrl: urls.amazon,
      homeDepotSearchUrl: urls.homeDepot,
      lowesSearchUrl: urls.lowes,
    });
    inserted++;
  }

  console.log(`[sourcing] Generated ${inserted} materials from plan ${planId}`);
  return inserted;
}

function inferCategory(productName: string, stepTitle: string): string {
  const name = productName.toLowerCase();
  const title = stepTitle.toLowerCase();

  if (name.includes('sandpaper') || name.includes('sanding') || name.includes('grit')) return 'sandpaper';
  if (name.includes('stain') || name.includes('dye')) return 'stain';
  if (name.includes('paint') || name.includes('chalk')) return 'paint';
  if (name.includes('primer')) return 'primer';
  if (name.includes('poly') || name.includes('finish') || name.includes('lacquer') || name.includes('varnish') || name.includes('wax') || name.includes('oil')) return 'finish';
  if (name.includes('stripper') || name.includes('remover')) return 'stripper';
  if (name.includes('knob') || name.includes('pull') || name.includes('handle') || name.includes('hinge') || name.includes('hardware')) return 'hardware';
  if (name.includes('brush') || name.includes('roller') || name.includes('sprayer') || name.includes('applicator')) return 'tool';
  if (name.includes('filler') || name.includes('putty') || name.includes('wood filler')) return 'repair';
  if (name.includes('conditioner') || name.includes('pre-stain')) return 'prep';
  if (name.includes('tack cloth') || name.includes('cleaner') || name.includes('degreaser')) return 'prep';
  if (title.includes('hardware')) return 'hardware';
  if (title.includes('sand')) return 'sandpaper';
  if (title.includes('strip')) return 'stripper';
  if (title.includes('stain') || title.includes('finish')) return 'finish';

  return 'other';
}

export async function getMaterialsForPlan(planId: number) {
  return db.select().from(materials).where(eq(materials.refinishingPlanId, planId));
}

export async function getMaterialsForProject(projectId: number) {
  return db.select().from(materials).where(eq(materials.projectId, projectId));
}
