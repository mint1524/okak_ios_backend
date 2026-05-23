import type { FastifyInstance } from 'fastify';

interface ModelEntry {
  id: string;
  label: string;
  description: string;
  reasoning_levels: Array<{ id: string; label: string }>;
}

const OKAK_MODELS: ModelEntry[] = [
  {
    id: 'okak-mini',
    label: 'OKAK Mini',
    description: 'Быстрый режим без reasoning',
    reasoning_levels: [{ id: 'none', label: 'None' }]
  },
  {
    id: 'okak-standard',
    label: 'OKAK Standard',
    description: 'Баланс качества и скорости',
    reasoning_levels: [
      { id: 'none', label: 'None' },
      { id: 'thinking', label: 'Thinking' }
    ]
  },
  {
    id: 'okak-pro',
    label: 'OKAK Pro',
    description: 'Максимальное качество с fallback при лимитах API',
    reasoning_levels: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'medium-thinking', label: 'Medium Thinking' },
      { id: 'high-thinking', label: 'High Thinking' }
    ]
  }
];

export function registerLLMRoutes(app: FastifyInstance): void {
  app.get('/llm/models', { preHandler: app.authenticate }, async () => {
    return {
      default: 'okak-standard',
      items: OKAK_MODELS
    };
  });
}
