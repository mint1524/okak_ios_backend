import type { FastifyInstance } from 'fastify';

interface ModelEntry {
  id: string;
  label: string;
  description: string;
}

const OKAK_MODELS: ModelEntry[] = [
  { id: 'okak-mini', label: 'OKAK Mini', description: 'Быстрый и экономичный' },
  { id: 'okak-standard', label: 'OKAK Standard', description: 'Баланс качества и скорости' },
  { id: 'okak-pro', label: 'OKAK Pro', description: 'Максимальное качество' }
];

export function registerLLMRoutes(app: FastifyInstance): void {
  app.get('/llm/models', { preHandler: app.authenticate }, async () => {
    return {
      default: 'okak-standard',
      items: OKAK_MODELS
    };
  });
}
