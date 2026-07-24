import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const categoryEnum = z.enum([
  'anxiety',
  'depression',
  'addiction-recovery',
  'trauma',
  'relationships',
  'stress-burnout',
  'adhd',
]);

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: categoryEnum,
    subcategory: z.string().optional(),
    tags: z.array(z.string()).default([]),
    author: z.string(),
    reviewedBy: z.string().optional(),
    publishDate: z.date(),
    draft: z.boolean().default(false),
  }),
});

const worksheets = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/worksheets' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tier: z.enum(['free', 'paid']),
    category: z.enum([
      'anxiety', 'depression', 'addiction-recovery', 'trauma',
      'relationships', 'stress-burnout', 'adhd', 'general',
    ]).default('general'),
    age: z.array(z.enum(['children', 'adults'])).default(['adults']),
    fileUrl: z.string().optional(),
    order: z.number().default(0),
    draft: z.boolean().default(false),
  }),
});

const assessments = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/assessments' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum([
      'anxiety', 'depression', 'addiction-recovery', 'trauma',
      'relationships', 'stress-burnout', 'adhd', 'general',
    ]).default('general'),
    age: z.array(z.enum(['children', 'adults'])).default(['adults']),
    pdfUrl: z.string(),
    scoringSummary: z.string(),
    sourceNote: z.string().optional(),
    order: z.number().default(0),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles, worksheets, assessments };
