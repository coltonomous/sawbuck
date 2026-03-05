import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { projects, listings, refinishingPlans, materials, projectPhotos, listingImages } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { generateRefinishingPlan, parsePlanSteps } from '../analysis/refinishing.js';
import { generateMaterialsFromPlan, getMaterialsForProject } from '../analysis/sourcing.js';
import { generateText } from '../lib/claude.js';
import { IMAGES_DIR, PROJECT_PHOTOS_DIR } from '../lib/paths.js';
import { getPrimaryImagePath } from '../lib/images.js';
import { createProjectSchema, updateProjectSchema, updateCostsSchema, updateMaterialSchema, generateListingTextSchema } from '../lib/validation.js';

export const projectsRouter = new Hono();

// GET / — list all projects
projectsRouter.get('/', async (c) => {
  const { status } = c.req.query();
  const conditions = status ? eq(projects.status, status as 'acquired' | 'refinishing' | 'listed' | 'sold' | 'abandoned') : undefined;

  const results = await db.select()
    .from(projects)
    .where(conditions)
    .orderBy(desc(projects.createdAt));

  return c.json(results);
});

// GET /:id — single project with listing, plan, and materials
projectsRouter.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return c.json({ error: 'Not found' }, 404);

  const listing = await db.select().from(listings).where(eq(listings.id, project.listingId)).get();

  const plans = await db.select()
    .from(refinishingPlans)
    .where(eq(refinishingPlans.projectId, id));

  const plan = plans[0] ?? null;
  const planWithSteps = plan ? { ...plan, steps: parsePlanSteps(plan.steps) } : null;

  const mats = await getMaterialsForProject(id);
  const photos = await db.select().from(projectPhotos).where(eq(projectPhotos.projectId, id));
  const images = listing
    ? await db.select().from(listingImages).where(eq(listingImages.listingId, listing.id))
    : [];

  return c.json({ ...project, listing: listing ? { ...listing, images } : null, plan: planWithSteps, materials: mats, photos });
});

// POST / — create project from listing
projectsRouter.post('/', async (c) => {
  const raw = await c.req.json();
  const parsed = createProjectSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }
  const { listingId, name, purchasePrice, purchaseDate, purchaseNotes } = parsed.data;

  const [project] = await db.insert(projects).values({
    listingId,
    name,
    purchasePrice,
    purchaseDate: purchaseDate || new Date().toISOString().split('T')[0],
    purchaseNotes,
  }).returning();

  await db.update(listings).set({ status: 'acquired' }).where(eq(listings.id, listingId));

  return c.json(project, 201);
});

// PATCH /:id — update project
projectsRouter.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const raw = await c.req.json();
  const parsed = updateProjectSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  await db.update(projects).set({
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  }).where(eq(projects.id, id));

  await recalculateFinancials(id);

  const updated = await db.select().from(projects).where(eq(projects.id, id)).get();
  return c.json(updated);
});

// DELETE /:id — delete project and reset listing status
projectsRouter.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return c.json({ error: 'Not found' }, 404);

  const photos = await db.select().from(projectPhotos).where(eq(projectPhotos.projectId, id));
  for (const photo of photos) {
    const filePath = path.join(IMAGES_DIR, photo.localPath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await db.delete(projectPhotos).where(eq(projectPhotos.projectId, id));
  await db.delete(materials).where(eq(materials.projectId, id));
  await db.delete(refinishingPlans).where(eq(refinishingPlans.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));

  const listing = await db.select().from(listings).where(eq(listings.id, project.listingId)).get();
  if (listing) {
    const newStatus = listing.furnitureType ? 'analyzed' : 'new';
    await db.update(listings).set({ status: newStatus }).where(eq(listings.id, project.listingId));
  }

  return c.json({ ok: true });
});

// POST /:id/refinish — generate refinishing plan
projectsRouter.post('/:id/refinish', async (c) => {
  const id = parseInt(c.req.param('id'));
  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  try {
    const plan = await generateRefinishingPlan(project.listingId, id);
    if (!plan) return c.json({ error: 'Failed to generate refinishing plan' }, 422);

    const storedPlans = await db.select()
      .from(refinishingPlans)
      .where(eq(refinishingPlans.projectId, id));
    const storedPlan = storedPlans[storedPlans.length - 1];

    if (storedPlan) {
      await generateMaterialsFromPlan(storedPlan.id, id);
    }

    await db.update(projects).set({
      status: 'refinishing',
      updatedAt: new Date().toISOString(),
    }).where(eq(projects.id, id));

    return c.json({
      plan,
      materials: storedPlan ? await getMaterialsForProject(id) : [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[projects] Error generating plan for project ${id}:`, err);
    return c.json({ error: message }, 500);
  }
});

// POST /:id/listing-text — generate marketplace listing copy via Claude (cached)
projectsRouter.post('/:id/listing-text', async (c) => {
  const id = parseInt(c.req.param('id'));
  const raw = await c.req.json().catch(() => ({}));
  const parsed = generateListingTextSchema.safeParse(raw);
  const regenerate = parsed.success ? parsed.data.regenerate : false;

  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  if (project.listingText && !regenerate) {
    return c.json({ text: project.listingText });
  }

  const listing = await db.select().from(listings).where(eq(listings.id, project.listingId)).get();
  const plans = await db.select().from(refinishingPlans).where(eq(refinishingPlans.projectId, id));
  const plan = plans[plans.length - 1] ?? null;
  const mats = await getMaterialsForProject(id);

  const context: string[] = [];
  context.push(`Product name: ${project.name}`);
  if (listing?.furnitureType) context.push(`Type: ${listing.furnitureType}`);
  if (listing?.furnitureStyle) context.push(`Style: ${listing.furnitureStyle}`);
  if (listing?.woodSpecies) context.push(`Wood: ${listing.woodSpecies}`);
  if (listing?.conditionNotes) context.push(`Original condition notes: ${listing.conditionNotes}`);
  if (listing?.description) context.push(`Original listing description: ${listing.description}`);
  if (plan?.description) context.push(`Refinishing plan summary: ${plan.description}`);
  if (plan?.steps) {
    const steps = typeof plan.steps === 'string' ? JSON.parse(plan.steps) : plan.steps;
    if (Array.isArray(steps)) {
      context.push(`Refinishing work done: ${steps.map((s: { name?: string; title?: string }) => s.name || s.title || '').filter(Boolean).join(', ')}`);
    }
  }
  if (mats.length > 0) {
    const matNames = mats.map((m) => m.productName).filter(Boolean);
    if (matNames.length > 0) context.push(`Materials used: ${matNames.join(', ')}`);
  }
  if (project.listedPrice) context.push(`Asking price: $${project.listedPrice}`);

  const prompt = `Write a short, casual marketplace listing for this refinished furniture piece.

${context.join('\n')}

Rules:
- 2-3 short paragraphs, like a real Facebook Marketplace or Craigslist post
- Casual, friendly tone — not a magazine ad. Write like a person, not a brand
- Mention what it is, the style/wood if known, and that it's been refinished
- Keep it factual and brief — no flowery language or over-selling
- Do NOT include a title line, price, or dimensions
- Do NOT invent a reason for selling or mention pickup/shipping logistics
- Do NOT use words like "stunning", "gorgeous", "exquisite", "timeless", or "elevate"`;

  try {
    const text = await generateText(prompt, 'You write furniture listings the way a normal person posts on Facebook Marketplace — friendly, brief, and honest. No copywriting voice.', 400, 'claude-haiku-4-5-20251001');
    await db.update(projects).set({ listingText: text }).where(eq(projects.id, id));
    return c.json({ text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[projects] Error generating listing text for project ${id}:`, err);
    return c.json({ error: message }, 500);
  }
});

// GET /:id/refinish — get existing refinishing plan
projectsRouter.get('/:id/refinish', async (c) => {
  const id = parseInt(c.req.param('id'));
  const plans = await db.select()
    .from(refinishingPlans)
    .where(eq(refinishingPlans.projectId, id));

  if (plans.length === 0) return c.json({ error: 'No plan found' }, 404);

  const plan = plans[plans.length - 1];
  return c.json({ ...plan, steps: parsePlanSteps(plan.steps) });
});

// GET /:id/materials — get materials for project
projectsRouter.get('/:id/materials', async (c) => {
  const id = parseInt(c.req.param('id'));
  const mats = await getMaterialsForProject(id);
  return c.json(mats);
});

// PATCH /:id/materials/:materialId — update material (actual price, purchased)
projectsRouter.patch('/:id/materials/:materialId', async (c) => {
  const projectId = parseInt(c.req.param('id'));
  const materialId = parseInt(c.req.param('materialId'));
  const raw = await c.req.json();
  const parsed = updateMaterialSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  await db.update(materials).set(parsed.data).where(eq(materials.id, materialId));

  await recalculateFinancials(projectId);

  const updated = await db.select().from(materials).where(eq(materials.id, materialId)).get();
  return c.json(updated);
});

// PATCH /:id/costs — update cost-related fields
projectsRouter.patch('/:id/costs', async (c) => {
  const id = parseInt(c.req.param('id'));
  const raw = await c.req.json();
  const parsed = updateCostsSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const updates = parsed.data;
  if (Object.keys(updates).length > 0) {
    await db.update(projects).set({
      ...updates,
      updatedAt: new Date().toISOString(),
    }).where(eq(projects.id, id));
    await recalculateFinancials(id);
  }

  const updated = await db.select().from(projects).where(eq(projects.id, id)).get();
  return c.json(updated);
});

async function recalculateFinancials(projectId: number) {
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return;

  const mats = await getMaterialsForProject(projectId);
  const purchased = mats.filter((m) => m.purchased);
  const totalMaterialCost = purchased.length > 0
    ? purchased.reduce((sum, m) => sum + (m.actualPrice ?? m.estimatedPrice ?? 0), 0)
    : mats.reduce((sum, m) => sum + (m.estimatedPrice ?? 0), 0);

  const laborCost = (project.hoursInvested ?? 0) * (project.hourlyRate ?? 25);
  const totalCost = project.purchasePrice + totalMaterialCost + laborCost + (project.sellingFees ?? 0) + (project.shippingCost ?? 0);
  const profit = (project.soldPrice ?? 0) - totalCost;
  const roi = totalCost > 0 ? Math.round((profit / totalCost) * 10000) / 100 : 0;

  await db.update(projects).set({
    totalMaterialCost: Math.round(totalMaterialCost * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    profit: project.soldPrice ? Math.round(profit * 100) / 100 : null,
    roiPercentage: project.soldPrice ? roi : null,
  }).where(eq(projects.id, projectId));
}

// ============================================================
// Photos
// ============================================================

projectsRouter.get('/:id/photos', async (c) => {
  const id = parseInt(c.req.param('id'));
  const photos = await db.select().from(projectPhotos).where(eq(projectPhotos.projectId, id));
  return c.json(photos);
});

projectsRouter.post('/:id/photos', async (c) => {
  const id = parseInt(c.req.param('id'));
  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const formData = await c.req.formData();
  const file = formData.get('photo') as File | null;
  const photoType = (formData.get('type') as string) || 'during';
  const caption = (formData.get('caption') as string) || '';

  if (!file) return c.json({ error: 'No photo file provided' }, 400);

  const validTypes = ['before', 'during', 'after'] as const;
  if (!(validTypes as readonly string[]).includes(photoType)) {
    return c.json({ error: 'type must be before, during, or after' }, 400);
  }

  const projectDir = path.join(PROJECT_PHOTOS_DIR, String(id));
  fs.mkdirSync(projectDir, { recursive: true });

  const ext = path.extname(file.name) || '.jpg';
  const timestamp = Date.now();
  const filename = `${photoType}-${timestamp}${ext}`;
  const filePath = path.join(projectDir, filename);
  const relativePath = path.join('projects', String(id), filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  const [photo] = await db.insert(projectPhotos).values({
    projectId: id,
    photoType: photoType as 'before' | 'during' | 'after',
    localPath: relativePath,
    caption: caption || null,
  }).returning();

  return c.json(photo, 201);
});

projectsRouter.delete('/:id/photos/:photoId', async (c) => {
  const photoId = parseInt(c.req.param('photoId'));
  const photo = await db.select().from(projectPhotos).where(eq(projectPhotos.id, photoId)).get();

  if (photo) {
    const filePath = path.join(IMAGES_DIR, photo.localPath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await db.delete(projectPhotos).where(eq(projectPhotos.id, photoId));
  }

  return c.json({ ok: true });
});

// GET /pipeline — projects with listing primary image for kanban cards
projectsRouter.get('/pipeline/all', async (c) => {
  const allProjects = await db.select()
    .from(projects)
    .orderBy(desc(projects.updatedAt));

  const enriched = await Promise.all(allProjects.map(async (project) => {
    const [primaryImagePath, listing] = await Promise.all([
      getPrimaryImagePath(project.listingId),
      db.select().from(listings).where(eq(listings.id, project.listingId)).get(),
    ]);

    return {
      ...project,
      primaryImagePath,
      furnitureType: listing?.furnitureType || null,
      furnitureStyle: listing?.furnitureStyle || null,
    };
  }));

  return c.json(enriched);
});
