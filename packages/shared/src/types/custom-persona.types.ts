// Custom Persona types — user-created personas for dispatch

export interface CustomPersona {
  id: string;
  userId: string;
  name: string;
  personaId: string;
  systemPrompt: string;
  modelTier: 'haiku' | 'sonnet';
  maxOutputTokens: number;
  toolPermissions: string[];
  isActive: boolean;
  description: string | null;
  icon: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomPersonaRequest {
  name: string;
  systemPrompt: string;
  modelTier?: 'haiku' | 'sonnet';
  maxOutputTokens?: number;
  toolPermissions?: string[];
  description?: string;
  icon?: string;
}

export interface UpdateCustomPersonaRequest {
  name?: string;
  systemPrompt?: string;
  modelTier?: 'haiku' | 'sonnet';
  maxOutputTokens?: number;
  toolPermissions?: string[];
  isActive?: boolean;
  description?: string;
  icon?: string;
}
