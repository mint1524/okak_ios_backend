import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(10, 'Пароль должен быть длиной не менее 10 символов')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v), 'Пароль должен содержать буквы')
  .refine((v) => /[0-9]/.test(v), 'Пароль должен содержать цифры');

export const registerSchema = z.object({
  email: z.string().email('Введите корректный email'),
  password: passwordSchema,
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат даты YYYY-MM-DD'),
  accepted_terms: z.boolean()
});

export const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6).regex(/^\d{6}$/)
});

export const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(1)
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email()
});

export const passwordResetConfirmSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6).regex(/^\d{6}$/),
  password: passwordSchema
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(20)
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
