export interface EmbeddingResult {
  memoryId: string;
  dimensions: number;
  model: string;
  generatedAt: Date;
}

export interface BackfillStatus {
  processed: number;
  total: number;
  remaining: number;
}
