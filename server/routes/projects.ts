import fs from 'fs/promises';
import path from 'path';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { projects, listings, refinishingPlans, materials, projectPhotos, listingImages } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { generateRefinishingPlan, parsePlanSteps, type DifficultyContext } from '../analysis/refinishing.js';
import { validateUpload, UploadError } from '../lib/upload.js';
import { generateMaterialsFromPlanSync, getMaterialsForProject } from '../analysis/sourcing.js';
import { generateText } from '../lib/bedrock.js';
import { IMAGES_DIR, PROJECT_PHOTOS_DIR } from '../lib/paths.js';
import { getPrimaryImagePath } from '../lib/images.js';
import { createProjectSchema, updateProjectSchema, updateCostsSchema, updateMaterialSchema, generateListingTextSchema } from '../lib/validation.js';
import { tryIngestProject } from '../rag/ingest/projects.js';
import { parseId, getOwnedProject, getEditableListing } from './helpers.js';
import logger from '../lib/logger.js';

export const projectsRouter = new Hono();

// GET / — list all projects
projectsRouter.get('/', async (c) => {
  const user = c.get('user');
  const { status } = c.req.query();
  const conditions = [eq(projects.userId, user.id)];
  if (status) conditions.push(eq(projects.status, status as 'acquired' | 'refinishing' | 'listed' | 'sold' | 'abandoned'));

  const results = await db.select()
    .from(projects)
    .where(and(...conditions))
    .orderBy(desc(projects.createdAt));

  return c.json(results);
});

// GET /:id — single project with listing, plan, and materials
projectsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  const project = await getOwnedProject(id, user.id);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const listing = await db.select().from(listings).where(eq(listings.id, project.listingId)).then(r => r[0]);

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
  const user = c.get('user');
  const raw = await c.req.json();
  const parsed = createProjectSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }
  const { listingId, name, purchasePrice, purchaseDate, purchaseNotes } = parsed.data;

  // Verify the listing is accessible: user's own, or agent-discovered (shared)
  const listing = await getEditableListing(listingId, user.id);
  if (!listing) return c.json({ error: 'Listing not found' }, 404);

  const project = await db.transaction(async (tx) => {
    const [created] = await tx.insert(projects).values({
      listingId,
      name,
      purchasePrice,
      purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
      purchaseNotes,
      userId: user.id,
    }).returning();

    await tx.update(listings).set({ status: 'acquired' }).where(eq(listings.id, listingId));

    return created;
  });

  return c.json(project, 201);
});

// POST /from-concept — create project + generate plan from a concept option in one step
projectsRouter.post('/from-concept', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { listingId, difficulty, label, summary, estimatedHours, estimatedMaterialCost, estimatedResalePrice } = body;

  if (!listingId || !difficulty) {
    return c.json({ error: 'listingId and difficulty are required' }, 400);
  }

  const listing = await getEditableListing(listingId, user.id);
  if (!listing) return c.json({ error: 'Listing not found' }, 404);
  if (!listing.furnitureType) {
    return c.json({ error: 'Listing must be analyzed first' }, 422);
  }

  // Check if a project already exists for this listing
  let project = await db.select().from(projects)
    .where(and(eq(projects.listingId, listingId), eq(projects.userId, user.id)))
    .then(r => r[0]);

  if (!project) {
    // Create the project
    project = await db.transaction(async (tx) => {
      const [created] = await tx.insert(projects).values({
        listingId,
        name: listing.title,
        purchasePrice: listing.askingPrice ?? 0,
        purchaseDate: new Date(),
        userId: user.id,
      }).returning();
      await tx.update(listings).set({ status: 'acquired' }).where(eq(listings.id, listingId));
      return created;
    });
  }

  // Generate the plan seeded with the chosen concept option
  try {
    const difficultyCtx: DifficultyContext = {
      difficulty,
      label: label ?? difficulty,
      summary: summary ?? '',
      estimatedHours,
      estimatedMaterialCost,
      estimatedResalePrice,
    };

    const result = await generateRefinishingPlan(listing.id, project.id, difficultyCtx);
    if (!result) return c.json({ error: 'Failed to generate refinishing plan' }, 422);

    const storedPlans = await db.select()
      .from(refinishingPlans)
      .where(eq(refinishingPlans.projectId, project.id));
    const storedPlan = storedPlans[storedPlans.length - 1];

    if (storedPlan) {
      await generateMaterialsFromPlanSync(storedPlan.id, project.id);
    }

    await db.update(projects).set({
      status: 'refinishing',
      updatedAt: new Date(),
    }).where(eq(projects.id, project.id));

    return c.json({ project, planGenerated: true }, 201);
  } catch (err) {
    logger.error({ err, listingId, difficulty }, 'Error in from-concept flow');
    return c.json({ error: 'Failed to generate refinishing plan' }, 500);
  }
});

// PATCH /:id — update project
projectsRouter.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  const raw = await c.req.json();
  const parsed = updateProjectSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const existing = await getOwnedProject(id, user.id);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  // Auto-set soldDate when marking as sold (if not already set)
  const updates: Record<string, unknown> = {
    ...parsed.data,
    updatedAt: new Date(),
  };
  if (parsed.data.purchaseDate) updates.purchaseDate = new Date(parsed.data.purchaseDate);
  if (parsed.data.status === 'sold' && !existing.soldDate) {
    updates.soldDate = new Date();
  }

  await db.update(projects).set(updates).where(eq(projects.id, id));

  await recalculateFinancials(id);

  const updated = await db.select().from(projects).where(eq(projects.id, id)).then(r => r[0]);
  if (!updated) return c.json({ error: 'Not found' }, 404);

  // Auto-ingest into RAG knowledge base when project is sold
  if (updated.status === 'sold' && updated.soldPrice) {
    tryIngestProject(id).catch(() => {});
  }

  return c.json(updated);
});

// DELETE /:id — delete project and reset listing status
projectsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  const project = await getOwnedProject(id, user.id);
  if (!project) return c.json({ error: 'Not found' }, 404);

  // Collect photo paths before deleting DB records
  const photos = await db.select().from(projectPhotos).where(eq(projectPhotos.projectId, id));

  // Delete all DB records atomically first — if this fails, no files are lost
  await db.transaction(async (tx) => {
    await tx.delete(projectPhotos).where(eq(projectPhotos.projectId, id));
    await tx.delete(materials).where(eq(materials.projectId, id));
    await tx.delete(refinishingPlans).where(eq(refinishingPlans.projectId, id));
    await tx.delete(projects).where(eq(projects.id, id));

    const [listing] = await tx.select().from(listings).where(eq(listings.id, project.listingId));
    if (listing) {
      const newStatus: 'analyzed' | 'new' = listing.furnitureType ? 'analyzed' : 'new';
      await tx.update(listings).set({ status: newStatus }).where(eq(listings.id, project.listingId));
    }
  });

  // Clean up photo files after DB commit — orphaned files are harmless and will
  // be caught by the scheduled image cleanup if these deletes fail
  for (const photo of photos) {
    const filePath = path.join(IMAGES_DIR, photo.localPath);
    await fs.unlink(filePath).catch(() => {});
  }

  return c.json({ ok: true });
});

// POST /:id/refinish — generate refinishing plan
projectsRouter.post('/:id/refinish', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  const project = await getOwnedProject(id, user.id);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  // Check if the listing has been analyzed first
  const listing = await db.select().from(listings).where(eq(listings.id, project.listingId)).then(r => r[0]);
  if (listing && !listing.furnitureType) {
    return c.json({ error: 'Analyze the listing first — the refinishing plan needs furniture type, condition, and wood data to be useful.' }, 422);
  }

  // Accept optional difficulty context from concept option selection
  const body = await c.req.json().catch(() => ({}));
  const difficultyCtx: DifficultyContext | undefined = body.difficulty ? {
    difficulty: body.difficulty,
    label: body.label ?? body.difficulty,
    summary: body.summary ?? '',
    estimatedHours: body.estimatedHours,
    estimatedMaterialCost: body.estimatedMaterialCost,
    estimatedResalePrice: body.estimatedResalePrice,
  } : undefined;

  try {
    const result = await generateRefinishingPlan(project.listingId, id, difficultyCtx);
    if (!result) return c.json({ error: 'Failed to generate refinishing plan' }, 422);

    // Generate materials + update project status atomically
    const storedPlans = await db.select()
      .from(refinishingPlans)
      .where(eq(refinishingPlans.projectId, id));
    const storedPlan = storedPlans[storedPlans.length - 1];

    if (storedPlan) {
      await generateMaterialsFromPlanSync(storedPlan.id, id);
    }

    await db.update(projects).set({
      status: 'refinishing',
      updatedAt: new Date(),
    }).where(eq(projects.id, id));

    return c.json({
      plan: result.plan,
      ragSourcesUsed: result.ragSourcesUsed,
      ragSourceTitles: result.ragSourceTitles,
      ragSources: result.ragSources,
      materials: storedPlan ? await getMaterialsForProject(id) : [],
    });
  } catch (err: unknown) {
    logger.error({ err, projectId: id }, 'Error generating refinishing plan');
    const message = process.env.NODE_ENV === 'production' ? 'Failed to generate refinishing plan' : (err instanceof Error ? err.message : 'Unknown error');
    return c.json({ error: message }, 500);
  }
});

// POST /:id/listing-text — generate marketplace listing copy (cached)
projectsRouter.post('/:id/listing-text', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = generateListingTextSchema.safeParse(raw);
  const regenerate = parsed.success ? parsed.data.regenerate : false;

  const project = await getOwnedProject(id, user.id);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  if (project.listingText && !regenerate) {
    return c.json({ text: project.listingText });
  }

  const listing = await db.select().from(listings).where(eq(listings.id, project.listingId)).then(r => r[0]);
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
- Casual, friendly tone. Write like a person, not a brand or a copywriter
- Mention what it is, the style/wood if known, and that it's been refinished
- Keep it factual and brief. No flowery language or over-selling
- Use commas instead of em dashes. Never use the — character
- Do NOT include a title line, price, or dimensions
- Do NOT invent a reason for selling or mention pickup/shipping logistics
- Do NOT use words like "stunning", "gorgeous", "exquisite", "timeless", "elevate", "boasts", "showcases", or "perfect for"
- Avoid starting sentences with "This" repeatedly
- Sound like something a real person typed on their phone, not AI-generated marketing copy`;

  try {
    const text = await generateText(prompt, 'You write furniture listings the way a normal person posts on Facebook Marketplace. Short, direct, no filler. You never use em dashes, never use marketing language. You sound like someone selling furniture out of their garage.', 400);
    await db.update(projects).set({ listingText: text }).where(eq(projects.id, id));
    return c.json({ text });
  } catch (err: unknown) {
    logger.error({ err, projectId: id }, 'Error generating listing text');
    const message = process.env.NODE_ENV === 'production' ? 'Failed to generate listing text' : (err instanceof Error ? err.message : 'Unknown error');
    return c.json({ error: message }, 500);
  }
});

// GET /:id/refinish — get existing refinishing plan
projectsRouter.get('/:id/refinish', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const project = await getOwnedProject(id, user.id);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const plans = await db.select()
    .from(refinishingPlans)
    .where(eq(refinishingPlans.projectId, id));

  if (plans.length === 0) return c.json({ error: 'No plan found' }, 404);

  const plan = plans[plans.length - 1];
  return c.json({ ...plan, steps: parsePlanSteps(plan.steps) });
});

// GET /:id/materials — get materials for project
projectsRouter.get('/:id/materials', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const project = await getOwnedProject(id, user.id);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const mats = await getMaterialsForProject(id);
  return c.json(mats);
});

// PATCH /:id/materials/:materialId — update material (actual price, purchased)
projectsRouter.patch('/:id/materials/:materialId', async (c) => {
  const user = c.get('user');
  const projectId = parseId(c);
  const materialId = parseId(c, 'materialId');
  if (isNaN(projectId) || isNaN(materialId)) return c.json({ error: 'Invalid ID' }, 400);
  const raw = await c.req.json();
  const parsed = updateMaterialSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const project = await getOwnedProject(projectId, user.id);
  if (!project) return c.json({ error: 'Not found' }, 404);

  await db.update(materials).set(parsed.data).where(eq(materials.id, materialId));

  await recalculateFinancials(projectId);

  const updated = await db.select().from(materials).where(eq(materials.id, materialId)).then(r => r[0]);
  return c.json(updated);
});

// PATCH /:id/costs — update cost-related fields
projectsRouter.patch('/:id/costs', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  const raw = await c.req.json();
  const parsed = updateCostsSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const existing = await getOwnedProject(id, user.id);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const updates: Record<string, unknown> = { ...parsed.data };
  // Convert date strings from client to Date objects
  if (updates.soldDate) updates.soldDate = new Date(updates.soldDate as string);
  if (updates.listedDate) updates.listedDate = new Date(updates.listedDate as string);
  // Auto-set soldDate when soldPrice is provided (if not already set)
  if (updates.soldPrice && !updates.soldDate && !existing.soldDate) {
    updates.soldDate = new Date();
  }
  if (Object.keys(updates).length > 0) {
    await db.update(projects).set({
      ...updates,
      updatedAt: new Date(),
    }).where(eq(projects.id, id));
    await recalculateFinancials(id);
  }

  const updated = await db.select().from(projects).where(eq(projects.id, id)).then(r => r[0]);

  // Auto-ingest when sold price is set and project is marked sold
  if (updated?.status === 'sold' && updated.soldPrice) {
    tryIngestProject(id).catch(() => {});
  }

  return c.json(updated);
});

async function recalculateFinancials(projectId: number) {
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).then(r => r[0]);
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
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const project = await getOwnedProject(id, user.id);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const photos = await db.select().from(projectPhotos).where(eq(projectPhotos.projectId, id));
  return c.json(photos);
});

projectsRouter.post('/:id/photos', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
  const project = await getOwnedProject(id, user.id);
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

  let validated;
  try {
    validated = await validateUpload(file);
  } catch (err) {
    if (err instanceof UploadError) return c.json({ error: err.message }, 400);
    throw err;
  }

  const projectDir = path.join(PROJECT_PHOTOS_DIR, String(id));
  await fs.mkdir(projectDir, { recursive: true });

  const timestamp = Date.now();
  const filename = `${photoType}-${timestamp}${validated.ext}`;
  const filePath = path.join(projectDir, filename);
  const relativePath = path.join('projects', String(id), filename);

  await fs.writeFile(filePath, validated.buffer);

  const [photo] = await db.insert(projectPhotos).values({
    projectId: id,
    photoType: photoType as 'before' | 'during' | 'after',
    localPath: relativePath,
    caption: caption || null,
  }).returning();

  return c.json(photo, 201);
});

projectsRouter.delete('/:id/photos/:photoId', async (c) => {
  const user = c.get('user');
  const id = parseId(c);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const project = await getOwnedProject(id, user.id);
  if (!project) return c.json({ error: 'Not found' }, 404);

  const photoId = parseId(c, 'photoId');
  if (isNaN(photoId)) return c.json({ error: 'Invalid ID' }, 400);
  const photo = await db.select().from(projectPhotos).where(eq(projectPhotos.id, photoId)).then(r => r[0]);

  if (photo) {
    const filePath = path.join(IMAGES_DIR, photo.localPath);
    await fs.unlink(filePath).catch(() => {});
    await db.delete(projectPhotos).where(eq(projectPhotos.id, photoId));
  }

  return c.json({ ok: true });
});

// GET /pipeline — projects with listing primary image for kanban cards
projectsRouter.get('/pipeline/all', async (c) => {
  const user = c.get('user');
  const allProjects = await db.select()
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.updatedAt));

  const enriched = await Promise.all(allProjects.map(async (project) => {
    const [primaryImagePath, listing] = await Promise.all([
      getPrimaryImagePath(project.listingId),
      db.select().from(listings).where(eq(listings.id, project.listingId)).then(r => r[0]),
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
